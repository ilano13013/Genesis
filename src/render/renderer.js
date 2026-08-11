/**
 * Rendu de la simulation sur canvas 2D.
 *
 * Couches, du fond vers l'avant :
 *   terrain pré-rendu → végétation → reflets d'eau → cadavres → créatures
 *   → particules → ombres de nuages → météo → cycle jour/nuit → vignette
 *   → minicarte.
 *
 * Le coût par image est dominé par le nombre de créatures visibles : le
 * niveau de détail est réduit automatiquement quand le zoom est faible.
 */
import { TAU, clamp, clamp01, lerp, mixRgb } from '../core/utils.js';
import { BIOME } from '../world/terrain.js';
import { paintTerrain } from './terrainpainter.js';
import { Particles, PK } from './particles.js';
import { STATE } from '../sim/creature.js';
import { drawAnatomy, LOD } from './anatomy.js';
import { KIND, STRUCTURE_INFO } from '../sim/structures.js';

const SEASON_LUSH = [
  [104, 190, 92], [76, 170, 66], [196, 134, 54], [152, 182, 176],
];
const SEASON_DRY = [
  [156, 146, 92], [178, 158, 88], [148, 112, 60], [196, 202, 212],
];

export class Renderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.particles = new Particles(1500);
    this.time = 0;
    this.selected = null;
    this.hovered = null;

    this.options = {
      vegetation: true,
      particles: true,
      weather: true,
      dayNight: true,
      vision: false,
      labels: true,
      minimap: true,
      cloudShadows: true,
      ...options,
    };

    this.rain = null;
    this.snow = null;
    this.clouds = [];
    // Marges occupées par l'interface : la minicarte s'y adosse au lieu de
    // se retrouver cachée sous un panneau ou sous le dock.
    this.insets = { left: 0, bottom: 0 };
    this._vegTimer = 0;
    this._fireflyTimer = 0;
    this.flash = 0;
  }

  /** (Re)lie le moteur : repeint le terrain et prépare les couches. */
  attach(ecosystem) {
    this.eco = ecosystem;
    const t = ecosystem.terrain;
    const painted = paintTerrain(t, 1);
    this.terrainCanvas = painted.canvas;
    this.waterPoints = painted.waterPoints;
    this.repaintCell = painted.repaintCell;
    this._minimapStale = false;
    this._minimapTimer = 0;

    this.vegCanvas = document.createElement('canvas');
    this.vegCanvas.width = t.cols;
    this.vegCanvas.height = t.rows;
    this.vegCtx = this.vegCanvas.getContext('2d');
    this.vegImage = this.vegCtx.createImageData(t.cols, t.rows);
    this._vegTimer = 99;

    this._buildMinimap();
    this._buildClouds();
    this.particles.clear();
  }

  _buildMinimap() {
    const t = this.eco.terrain;
    const w = 190, h = Math.round((190 * t.height) / t.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.drawImage(this.terrainCanvas, 0, 0, w, h);
    this.minimapCanvas = c;
    this.minimapW = w;
    this.minimapH = h;
  }

  _buildClouds() {
    this.clouds = [];
    // Sprite d'ombre pré-calculé : un `drawImage` par nuage au lieu d'un
    // dégradé radial reconstruit à chaque image.
    if (!this.cloudSprite) {
      const s = document.createElement('canvas');
      s.width = s.height = 128;
      const sc = s.getContext('2d');
      const grd = sc.createRadialGradient(64, 64, 8, 64, 64, 64);
      grd.addColorStop(0, 'rgba(96, 108, 132, 1)');
      grd.addColorStop(0.55, 'rgba(150, 162, 186, 0.55)');
      grd.addColorStop(1, 'rgba(255, 255, 255, 0)');
      sc.fillStyle = grd;
      sc.fillRect(0, 0, 128, 128);
      this.cloudSprite = s;
    }
    const t = this.eco.terrain;
    for (let i = 0; i < 9; i++) {
      this.clouds.push({
        x: Math.random() * t.width,
        y: Math.random() * t.height,
        r: 180 + Math.random() * 420,
        s: 0.6 + Math.random() * 0.8,
      });
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.vignette = null;
      this.rain = null;
      this.snow = null;
    }
    this.width = rect.width;
    this.height = rect.height;
    // Sur écran étroit, la minicarte occuperait la moitié de la largeur.
    this.minimapScale = rect.width < 660 ? 0.66 : 1;
    return { width: rect.width, height: rect.height };
  }

  // ------------------------------------------------------------------ rendu

  /**
   * @param {import('./camera.js').Camera} camera
   * @param {number} dt temps réel écoulé (s)
   */
  render(camera, dt) {
    const ctx = this.ctx;
    const eco = this.eco;
    if (!eco) return;
    this.time += dt;

    const climate = eco.climate;
    const bounds = camera.visibleBounds();

    this._repaintChangedCells();
    this._consumeEvents(camera);
    if (this.options.particles) {
      this.particles.update(dt);
      this._ambientParticles(dt, camera, bounds);
    }

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.width, this.height);

    // Fond : couleur d'eau profonde (visible hors des limites du monde).
    ctx.fillStyle = '#0b1c33';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    camera.apply(ctx);

    ctx.imageSmoothingEnabled = camera.zoom < 1.4;
    ctx.drawImage(this.terrainCanvas, 0, 0);

    if (this.options.vegetation) this._drawVegetation(ctx, dt, climate);
    this._drawWater(ctx, bounds, camera);
    this._drawTerritories(ctx, bounds, camera);
    this._drawStructures(ctx, bounds, camera);
    this._drawCorpses(ctx, bounds, camera);
    this._drawCreatures(ctx, bounds, camera, climate);
    if (this.options.particles) this.particles.draw(ctx, bounds);
    if (this.options.cloudShadows) this._drawCloudShadows(ctx, dt, climate, bounds);

    ctx.restore();

    // --- couches plein écran
    if (this.options.dayNight) this._drawDayNight(ctx, climate);
    if (this.options.weather) this._drawWeather(ctx, climate, dt, camera);
    this._drawVignette(ctx);
    this._drawSettlementLabels(ctx, camera);
    if (this.options.minimap) this._drawMinimap(ctx, camera);
    this._drawSelectionOverlay(ctx, camera);

    ctx.restore();
  }

  // ---------------------------------------------------------------- couches

  _drawVegetation(ctx, dt, climate) {
    this._vegTimer += dt;
    // 12 rafraîchissements/s suffisent : la végétation évolue lentement.
    if (this._vegTimer > 0.08) {
      this._vegTimer = 0;
      this._updateVegetationImage(climate);
    }
    const t = this.eco.terrain;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.vegCanvas, 0, 0, t.width, t.height);
    ctx.restore();
  }

  _updateVegetationImage(climate) {
    const t = this.eco.terrain;
    const plants = this.eco.food.plants;
    const data = this.vegImage.data;

    const si = climate.seasonIndex;
    const blend = clamp01((climate.seasonProgress - 0.62) / 0.38);
    const ni = (si + 1) % 4;
    const lush = mixRgb(SEASON_LUSH[si], SEASON_LUSH[ni], blend);
    const dry = mixRgb(SEASON_DRY[si], SEASON_DRY[ni], blend);

    for (let i = 0; i < t.count; i++) {
      const fert = t.fertility[i];
      const o = i * 4;
      if (fert < 0.05) { data[o + 3] = 0; continue; }
      const rel = clamp01(plants[i] / Math.max(0.12, fert));
      let c, a;
      if (rel > 0.34) {
        c = lush;
        a = (rel - 0.34) * 0.72 * (0.5 + fert * 0.7);
      } else {
        // Sol appauvri : la terre nue transparaît.
        c = dry;
        a = (0.34 - rel) * 0.72 * (0.35 + fert * 0.5);
      }
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = (a * 255) | 0;
    }
    this.vegCtx.putImageData(this.vegImage, 0, 0);
  }

  _drawWater(ctx, bounds, camera) {
    const pts = this.waterPoints;
    if (!pts || camera.zoom < 0.22) return;
    const t = this.time;
    ctx.save();
    ctx.strokeStyle = 'rgba(226, 244, 255, 0.55)';
    ctx.lineWidth = Math.max(0.8, 1.4 / camera.zoom);
    ctx.beginPath();
    let drawn = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1];
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
      const phase = pts[i + 2];
      const s = Math.sin(t * 1.6 + phase);
      if (s < 0.55) continue;
      const len = 3 + s * 5;
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      if (++drawn > 700) break;
    }
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Repeint les cellules dont le biome a changé (érosion, culture, remblai).
   * Le budget par image est volontairement bas : la carte se transforme
   * lentement, et une image ne doit jamais être retardée par le sol.
   */
  _repaintChangedCells() {
    if (!this.repaintCell) return;
    const cells = this.eco.soil.drainDirty(24);
    if (!cells) return;
    const cols = this.eco.terrain.cols;
    for (let k = 0; k < cells.length; k++) {
      this.repaintCell(cells[k] % cols, (cells[k] / cols) | 0);
    }
    this._minimapStale = true;
  }

  /**
   * Territoires et routes commerciales. Dessinés sous les bâtiments : une
   * cité doit se lire comme une tache d'influence sur la carte, pas comme un
   * amas d'icônes.
   */
  _drawTerritories(ctx, bounds, camera) {
    const civ = this.eco.civ;
    if (!civ || !civ.list.length) return;
    const zoom = camera.zoom;
    ctx.save();

    // Routes commerciales
    ctx.lineWidth = Math.max(0.8, 1.6 / zoom);
    ctx.setLineDash([7, 6]);
    for (const a of civ.list) {
      if (a.abandoned) continue;
      for (const [id, strength] of a.routes) {
        if (id <= a.id) continue;
        const b = civ.byId.get(id);
        if (!b || b.abandoned) continue;
        ctx.strokeStyle = `hsla(${a.hue} 60% 70% / ${(0.12 + strength * 0.35).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Territoires
    for (const s of civ.list) {
      if (s.x < bounds.minX - s.radius || s.x > bounds.maxX + s.radius) continue;
      if (s.y < bounds.minY - s.radius || s.y > bounds.maxY + s.radius) continue;
      const ruined = s.abandoned;
      const hue = ruined ? 220 : s.hue;
      const grd = ctx.createRadialGradient(s.x, s.y, s.radius * 0.2, s.x, s.y, s.radius);
      grd.addColorStop(0, `hsla(${hue} ${ruined ? 8 : 62}% 60% / ${ruined ? 0.05 : 0.11})`);
      grd.addColorStop(1, 'hsla(0 0% 0% / 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = `hsla(${hue} ${ruined ? 10 : 65}% 68% / ${ruined ? 0.18 : 0.4})`;
      ctx.lineWidth = Math.max(0.7, 1.4 / zoom);
      ctx.setLineDash(ruined ? [3, 7] : [10, 7]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** Noms et rangs des cités, en espace écran pour rester lisibles. */
  _drawSettlementLabels(ctx, camera) {
    const civ = this.eco.civ;
    if (!civ || !civ.list.length || camera.zoom < 0.32) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of civ.list) {
      if (s.abandoned && camera.zoom < 0.7) continue;
      const p = camera.worldToScreen(s.x, s.y);
      if (p.x < -80 || p.x > this.width + 80 || p.y < -40 || p.y > this.height + 40) continue;
      const y = p.y - Math.max(16, s.radius * camera.zoom * 0.55);

      const label = s.abandoned ? `${s.name} · ruines` : s.name;
      ctx.font = `600 ${s.tier >= 3 ? 13 : 11}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8, 12, 20, 0.62)';
      roundRect(ctx, p.x - w / 2 - 7, y - 10, w + 14, 20, 6);
      ctx.fill();
      ctx.fillStyle = s.abandoned ? 'rgba(180,190,205,0.7)' : `hsl(${s.hue} 70% 78%)`;
      ctx.fillText(label, p.x, y);

      if (!s.abandoned && camera.zoom > 0.55) {
        ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200, 212, 228, 0.66)';
        ctx.fillText(`${s.tierInfo.name} · ${s.population} hab · ${s.techs.size} savoirs`, p.x, y + 15);
      }
    }
    ctx.restore();
  }

  _drawStructures(ctx, bounds, camera) {
    const list = this.eco.structures.list;
    if (!list.length) return;
    const cs = this.eco.terrain.cellSize;
    const zoom = camera.zoom;
    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.x < bounds.minX || s.x > bounds.maxX || s.y < bounds.minY || s.y > bounds.maxY) continue;
      const info = STRUCTURE_INFO[s.kind];
      const ruin = s.ruin > 0 ? Math.max(0.25, 1 - s.ruin / 280) : 1;

      if (!s.done) {
        // Chantier : emprise au sol et jauge d'avancement.
        const p = s.invested / s.cost;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = `hsl(${s.hue} 45% 62%)`;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = Math.max(0.6, 1.2 / zoom);
        ctx.strokeRect(s.cx * cs + 1, s.cy * cs + 1, cs - 2, cs - 2);
        ctx.setLineDash([]);
        ctx.fillStyle = `hsl(${s.hue} 55% 60%)`;
        ctx.fillRect(s.cx * cs + 2, s.cy * cs + cs - 4, (cs - 4) * p, 2);
        ctx.globalAlpha = 1;
        continue;
      }

      ctx.globalAlpha = ruin;
      switch (s.kind) {
        case KIND.FIELD: {
          // Parcelle cultivée : une tache franche, lisible même de loin,
          // avec des sillons qui n'apparaissent qu'en approchant.
          const fx = s.cx * cs, fy = s.cy * cs;
          ctx.fillStyle = `rgba(${info.color[0]},${info.color[1]},${info.color[2]},0.46)`;
          ctx.fillRect(fx, fy, cs, cs);
          ctx.strokeStyle = 'rgba(96, 78, 42, 0.5)';
          ctx.lineWidth = Math.max(0.5, 1 / zoom);
          ctx.strokeRect(fx + 0.5, fy + 0.5, cs - 1, cs - 1);
          if (zoom > 1.2) {
            ctx.strokeStyle = 'rgba(104, 82, 40, 0.45)';
            ctx.lineWidth = Math.max(0.6, 1.1 / zoom);
            ctx.beginPath();
            for (let k = 1; k < 4; k++) {
              const y = fy + (k / 4) * cs;
              ctx.moveTo(fx + 2, y);
              ctx.lineTo(fx + cs - 2, y);
            }
            ctx.stroke();
          }
          break;
        }
        case KIND.DIKE: {
          // Muret de pierres.
          ctx.fillStyle = 'rgba(150, 146, 138, 0.85)';
          ctx.fillRect(s.cx * cs + 1, s.cy * cs + 1, cs - 2, cs - 2);
          if (zoom > 0.5) {
            ctx.fillStyle = 'rgba(196, 192, 184, 0.7)';
            for (let k = 0; k < 3; k++) {
              ctx.fillRect(s.cx * cs + 2 + (k % 2) * 5, s.cy * cs + 3 + k * 4, 6, 3);
            }
          }
          break;
        }
        case KIND.ROAD: {
          ctx.fillStyle = 'rgba(186, 172, 148, 0.55)';
          ctx.fillRect(s.cx * cs + 2, s.cy * cs + 2, cs - 4, cs - 4);
          break;
        }
        case KIND.WALL: {
          ctx.fillStyle = 'rgba(158, 158, 166, 0.92)';
          ctx.fillRect(s.cx * cs + 1, s.cy * cs + 1, cs - 2, cs - 2);
          ctx.fillStyle = 'rgba(96, 96, 104, 0.9)';
          ctx.fillRect(s.cx * cs + 1, s.cy * cs + cs * 0.55, cs - 2, 2);
          break;
        }
        case KIND.HUT:
        case KIND.GRANARY:
        case KIND.WORKSHOP:
        case KIND.MARKET:
        case KIND.TEMPLE:
        case KIND.PORT:
        case KIND.MINE: {
          // Bâti : une empreinte au sol, un toit teinté du peuple, une ombre.
          const col = info.color;
          const bx = s.cx * cs, by = s.cy * cs;
          ctx.fillStyle = 'rgba(10, 14, 20, 0.3)';
          ctx.fillRect(bx + 4, by + 5, cs - 5, cs - 6);
          ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          ctx.fillRect(bx + 2, by + 3, cs - 5, cs - 6);
          ctx.fillStyle = `hsl(${s.hue} 45% 52%)`;
          ctx.beginPath();
          ctx.moveTo(bx + 1, by + 5);
          ctx.lineTo(bx + cs * 0.5, by + 1);
          ctx.lineTo(bx + cs - 3, by + 5);
          ctx.closePath();
          ctx.fill();
          if (zoom > 1.1 && s.capacity > 0 && s.store > 1) {
            const fill = Math.min(1, s.store / s.capacity);
            ctx.fillStyle = `rgba(255, 214, 120, 0.8)`;
            ctx.fillRect(bx + 2, by + cs - 3, (cs - 5) * fill, 1.6);
          }
          break;
        }
        case KIND.NEST: {
          const cxp = s.x, cyp = s.y;
          const rad = cs * 0.62;
          ctx.fillStyle = 'rgba(10, 14, 20, 0.32)';
          ctx.beginPath();
          ctx.ellipse(cxp + 2, cyp + 3, rad, rad * 0.62, 0, 0, TAU);
          ctx.fill();
          // Dôme tressé, teinté de l'espèce
          ctx.fillStyle = `hsl(${s.hue} 34% 46%)`;
          ctx.beginPath();
          ctx.ellipse(cxp, cyp, rad, rad * 0.78, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = `hsl(${s.hue} 40% 62%)`;
          ctx.beginPath();
          ctx.ellipse(cxp - rad * 0.2, cyp - rad * 0.22, rad * 0.52, rad * 0.36, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(18, 12, 10, 0.75)';
          ctx.beginPath();
          ctx.ellipse(cxp, cyp + rad * 0.22, rad * 0.26, rad * 0.2, 0, 0, TAU);
          ctx.fill();
          // Anneau de réserve : un grenier plein se voit de loin.
          if (s.capacity > 0 && s.store > 1) {
            const fill = Math.min(1, s.store / s.capacity);
            ctx.strokeStyle = `rgba(255, 214, 120, ${0.35 + fill * 0.5})`;
            ctx.lineWidth = Math.max(0.8, 1.6 / zoom);
            ctx.beginPath();
            ctx.arc(cxp, cyp, rad * 1.35, -Math.PI / 2, -Math.PI / 2 + fill * TAU);
            ctx.stroke();
          }
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawCorpses(ctx, bounds, camera) {
    const corpses = this.eco.corpses;
    if (!corpses.length) return;
    ctx.save();
    for (let i = 0; i < corpses.length; i++) {
      const c = corpses[i];
      if (c.x < bounds.minX || c.x > bounds.maxX || c.y < bounds.minY || c.y > bounds.maxY) continue;
      const t = 1 - c.age / c.life;
      const r = (3 + c.size * 4.5) * (0.55 + t * 0.45);
      ctx.globalAlpha = 0.28 + t * 0.42;
      ctx.fillStyle = `hsl(${c.hue.toFixed(0)} 14% ${(28 + t * 12).toFixed(0)}%)`;
      ctx.beginPath();
      // La teinte sert aussi d'angle : chaque dépouille tombe différemment.
      ctx.ellipse(c.x, c.y, r * 1.25, r * 0.72, c.hue * 0.017, 0, TAU);
      ctx.fill();
      if (camera.zoom > 0.7) {
        ctx.globalAlpha = 0.4 * t;
        ctx.strokeStyle = 'rgba(30,20,18,0.8)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _drawCreatures(ctx, bounds, camera, climate) {
    const creatures = this.eco.creatures;
    const zoom = camera.zoom;
    // Niveaux de détail : au-delà de quelques pixels par créature, on passe
    // au dessin complet ; en dessous, un simple disque.
    const detail = zoom > 0.55 ? 2 : zoom > 0.28 ? 1 : 0;

    ctx.save();
    ctx.lineJoin = 'round';

    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.x < bounds.minX || c.x > bounds.maxX || c.y < bounds.minY || c.y > bounds.maxY) continue;
      this._drawCreature(ctx, c, detail, zoom);
    }

    ctx.restore();
  }

  _drawCreature(ctx, c, detail, zoom) {
    const g = c.genome;
    const growth = 0.42 + 0.58 * clamp01(c.age / c.maturity);
    const r = c.radius * growth;
    const energyRatio = clamp01(c.energy / c.maxEnergy);
    const ageRatio = clamp01(c.age / c.lifespan);

    const hue = g.hue | 0;
    const sat = (40 + g.carnivory * 32 + energyRatio * 18 - ageRatio * 12) | 0;
    const light = (34 + energyRatio * 22 - ageRatio * 8) | 0;
    const body = `hsl(${hue} ${sat}% ${light}%)`;

    if (detail === 0) {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1.2, r * 0.9), 0, TAU);
      ctx.fill();
      return;
    }

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.heading);

    // Toute la morphologie est déléguée : le monde et les portraits de
    // l'interface dessinent le même animal à partir du même génome.
    drawAnatomy(ctx, g, r, c.phase, {
      detail: detail === 2 ? LOD.FULL : LOD.SIMPLE,
      fine: zoom > 0.9,
      hue, sat, light,
    });

    // Halo d'état
    if (c.state === STATE.HUNT) {
      ctx.strokeStyle = 'rgba(255, 96, 72, 0.5)';
      ctx.lineWidth = Math.max(0.6, r * 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, TAU);
      ctx.stroke();
    } else if (c.state === STATE.MATE) {
      ctx.strokeStyle = 'rgba(255, 150, 220, 0.55)';
      ctx.lineWidth = Math.max(0.6, r * 0.13);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45, 0, TAU);
      ctx.stroke();
    }

    // Impact (morsure) : flash blanc
    if (c.flash > 0.01) {
      ctx.globalAlpha = c.flash * 0.7;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      // L'emprise du flash suit l'élancement du corps réellement dessiné.
      ctx.ellipse(0, 0, r * g.elongation * 1.1, r * 0.9, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Marqueurs de sélection (hors rotation)
    if (c === this.selected || c === this.hovered) {
      const t = this.time * 2.4;
      ctx.save();
      ctx.strokeStyle = c === this.selected ? '#7ef0d0' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(0.8, 1.6 / zoom);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 2.1 + Math.sin(t) * 1.5, 0, TAU);
      ctx.stroke();
      if (this.options.vision || c === this.selected) {
        ctx.globalAlpha = 0.22;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.senseRadius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Barre d'énergie
      ctx.globalAlpha = 0.9;
      const w = r * 3, h = Math.max(1.4, 2.4 / zoom);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(c.x - w / 2, c.y - r * 2.8, w, h);
      ctx.fillStyle = energyRatio > 0.4 ? '#7ef0a0' : energyRatio > 0.2 ? '#f2c14e' : '#ef6461';
      ctx.fillRect(c.x - w / 2, c.y - r * 2.8, w * energyRatio, h);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  _drawCloudShadows(ctx, dt, climate, bounds) {
    const cover = climate.weather.key === 'clear' ? 0.12
      : climate.weather.key === 'cloudy' ? 0.42
      : climate.weather.key === 'fog' ? 0.2 : 0.55;
    if (cover < 0.15) return;
    const wind = climate.windAngle;
    const speed = 12 + climate.windSpeed * 40;
    const t = this.eco.terrain;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (const cl of this.clouds) {
      cl.x += Math.cos(wind) * speed * cl.s * dt;
      cl.y += Math.sin(wind) * speed * cl.s * dt;
      if (cl.x < -cl.r) cl.x = t.width + cl.r;
      if (cl.x > t.width + cl.r) cl.x = -cl.r;
      if (cl.y < -cl.r) cl.y = t.height + cl.r;
      if (cl.y > t.height + cl.r) cl.y = -cl.r;
      if (cl.x + cl.r < bounds.minX || cl.x - cl.r > bounds.maxX) continue;
      if (cl.y + cl.r < bounds.minY || cl.y - cl.r > bounds.maxY) continue;
      ctx.globalAlpha = cover * 0.62;
      ctx.drawImage(this.cloudSprite, cl.x - cl.r, cl.y - cl.r, cl.r * 2, cl.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawDayNight(ctx, climate) {
    const light = climate.sunlight;
    const night = 1 - light;
    ctx.save();
    if (night > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      const strength = Math.pow(night, 1.25) * 0.88;
      const r = lerp(255, 46, strength);
      const g = lerp(255, 62, strength);
      const b = lerp(255, 122, strength);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    // Chaleur de l'aube et du crépuscule
    const golden = Math.exp(-Math.pow((light - 0.3) / 0.16, 2));
    if (golden > 0.02) {
      ctx.globalCompositeOperation = 'overlay';
      const grd = ctx.createLinearGradient(0, 0, 0, this.height);
      grd.addColorStop(0, `rgba(255, 168, 92, ${golden * 0.5})`);
      grd.addColorStop(1, `rgba(255, 108, 140, ${golden * 0.18})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    // Voile froid des hivers rigoureux
    const cold = clamp01(0.35 - climate.temperature) * 2;
    if (cold > 0.02) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(150, 200, 255, ${cold * 0.5})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
  }

  _drawWeather(ctx, climate, dt, camera) {
    const key = climate.weather.key;
    const inten = climate.intensity;

    if (key === 'fog') this._drawFog(ctx, inten);
    if (key === 'rain' || key === 'storm') this._drawRain(ctx, climate, dt, key === 'storm' ? 1 : inten);
    if (key === 'snow') this._drawSnow(ctx, climate, dt, inten);

    // Éclairs
    if (climate.lightning > 0.01) {
      this.flash = Math.max(this.flash, climate.lightning);
      camera.addShake(climate.lightning * 0.25);
    }
    if (this.flash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(200, 220, 255, ${this.flash * 0.35})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      this.flash *= 0.86;
    }
  }

  _drawRain(ctx, climate, dt, intensity) {
    const target = Math.round(220 + intensity * 520);
    if (!this.rain || this.rain.length !== target * 3) {
      this.rain = new Float32Array(target * 3);
      for (let i = 0; i < target; i++) {
        this.rain[i * 3] = Math.random() * this.width;
        this.rain[i * 3 + 1] = Math.random() * this.height;
        this.rain[i * 3 + 2] = 0.7 + Math.random() * 0.6;
      }
    }
    const wind = Math.cos(climate.windAngle) * climate.windSpeed;
    const vx = wind * 260;
    const vy = 900 + intensity * 500;
    ctx.save();
    ctx.strokeStyle = `rgba(174, 208, 255, ${0.28 + intensity * 0.22})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.rain.length; i += 3) {
      const s = this.rain[i + 2];
      let x = this.rain[i] + vx * s * dt;
      let y = this.rain[i + 1] + vy * s * dt;
      if (y > this.height) { y -= this.height; x = Math.random() * this.width; }
      if (x > this.width) x -= this.width;
      else if (x < 0) x += this.width;
      this.rain[i] = x;
      this.rain[i + 1] = y;
      ctx.moveTo(x, y);
      ctx.lineTo(x - vx * s * 0.012, y - vy * s * 0.012);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawSnow(ctx, climate, dt, intensity) {
    const target = Math.round(160 + intensity * 340);
    if (!this.snow || this.snow.length !== target * 4) {
      this.snow = new Float32Array(target * 4);
      for (let i = 0; i < target; i++) {
        this.snow[i * 4] = Math.random() * this.width;
        this.snow[i * 4 + 1] = Math.random() * this.height;
        this.snow[i * 4 + 2] = 0.5 + Math.random() * 1.1;
        this.snow[i * 4 + 3] = Math.random() * TAU;
      }
    }
    const wind = Math.cos(climate.windAngle) * climate.windSpeed;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < this.snow.length; i += 4) {
      const s = this.snow[i + 2];
      this.snow[i + 3] += dt * 1.6;
      let x = this.snow[i] + (wind * 90 + Math.sin(this.snow[i + 3]) * 26) * s * dt;
      let y = this.snow[i + 1] + (34 + s * 46) * dt;
      if (y > this.height) { y -= this.height; x = Math.random() * this.width; }
      if (x > this.width) x -= this.width;
      else if (x < 0) x += this.width;
      this.snow[i] = x;
      this.snow[i + 1] = y;
      ctx.globalAlpha = 0.35 + s * 0.4;
      ctx.beginPath();
      ctx.arc(x, y, s * 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _drawFog(ctx, intensity) {
    const t = this.time * 0.06;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const ox = ((t * (0.4 + i * 0.25)) % 1.4 - 0.2) * this.width;
      const grd = ctx.createRadialGradient(
        ox, this.height * (0.3 + i * 0.24), 10,
        ox, this.height * (0.3 + i * 0.24), this.width * 0.6
      );
      grd.addColorStop(0, `rgba(210, 224, 236, ${0.16 * intensity})`);
      grd.addColorStop(1, 'rgba(210, 224, 236, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
  }

  _drawVignette(ctx) {
    if (!this.vignette || this.vignette.w !== this.width) {
      const grd = ctx.createRadialGradient(
        this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.34,
        this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.78
      );
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(4, 8, 16, 0.55)');
      this.vignette = { grd, w: this.width };
    }
    ctx.fillStyle = this.vignette.grd;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Rectangle occupé par la minicarte : sous le bandeau, à droite du panneau
   * de gauche. C'est la seule zone libre quel que soit l'état de l'interface.
   */
  _minimapRect() {
    const k = this.minimapScale || 1;
    return {
      x: 18 + this.insets.left,
      y: 80,
      w: this.minimapW * k,
      h: this.minimapH * k,
    };
  }

  _drawMinimap(ctx, camera) {
    const { x, y, w, h } = this._minimapRect();
    const t = this.eco.terrain;
    // La minicarte suit les transformations du sol, sans être redessinée à
    // chaque cellule modifiée.
    if (this._minimapStale) {
      this._minimapTimer = (this._minimapTimer || 0) + 1;
      if (this._minimapTimer > 30) {
        this._buildMinimap();
        this._minimapStale = false;
        this._minimapTimer = 0;
      }
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(10, 16, 26, 0.85)';
    roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 10);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.minimapCanvas, x, y, w, h);
    ctx.globalAlpha = 1;

    // Créatures : un point sur trois suffit à lire la répartition.
    const sx = w / t.width, sy = h / t.height;
    const creatures = this.eco.creatures;
    const step = creatures.length > 400 ? 3 : 1;
    for (let i = 0; i < creatures.length; i += step) {
      const c = creatures[i];
      ctx.fillStyle = c.genome.carnivory > 0.55
        ? 'rgba(255, 108, 96, 0.95)'
        : c.genome.carnivory > 0.3 ? 'rgba(255, 208, 110, 0.9)' : 'rgba(126, 240, 160, 0.9)';
      ctx.fillRect(x + c.x * sx - 1, y + c.y * sy - 1, 2, 2);
    }

    // Cadre de la vue courante
    const b = camera.visibleBounds(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      x + clamp(b.minX, 0, t.width) * sx,
      y + clamp(b.minY, 0, t.height) * sy,
      clamp(b.maxX - b.minX, 0, t.width) * sx,
      clamp(b.maxY - b.minY, 0, t.height) * sy
    );
    ctx.restore();
  }

  _drawSelectionOverlay(ctx, camera) {
    const c = this.selected;
    if (!c || !c.alive) return;
    const p = camera.worldToScreen(c.x, c.y);
    if (p.x > 0 && p.x < this.width && p.y > 0 && p.y < this.height) return;
    // Flèche vers la créature suivie quand elle sort du cadre.
    const cx = this.width / 2, cy = this.height / 2;
    const a = Math.atan2(p.y - cy, p.x - cx);
    const rx = Math.min(this.width, this.height) * 0.42;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * rx, cy + Math.sin(a) * rx);
    ctx.rotate(a);
    ctx.fillStyle = '#7ef0d0';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------- particules

  _consumeEvents(camera) {
    const events = this.eco.drainEvents();
    if (!this.options.particles) return;
    const bounds = camera.visibleBounds(120);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      // Hors champ : inutile de dépenser des particules.
      if (e.x < bounds.minX || e.x > bounds.maxX || e.y < bounds.minY || e.y > bounds.maxY) continue;
      switch (e.type) {
        case 'birth': this.particles.birth(e.x, e.y, e.hue); break;
        case 'death': this.particles.death(e.x, e.y, e.hue, e.size); break;
        case 'bite': this.particles.bite(e.x, e.y); break;
        case 'graze': this.particles.graze(e.x, e.y); break;
        case 'speciation':
          this.particles.speciation(e.x, e.y, e.hue);
          camera.addShake(0.15);
          break;
      }
    }
  }

  /** Lucioles nocturnes et poussière diurne, dans le champ visible. */
  _ambientParticles(dt, camera, bounds) {
    this._fireflyTimer -= dt;
    if (this._fireflyTimer > 0) return;
    this._fireflyTimer = 0.09;
    const climate = this.eco.climate;
    const t = this.eco.terrain;
    const night = climate.sunlight < 0.3;
    const tries = 4;
    for (let k = 0; k < tries; k++) {
      const x = lerp(bounds.minX, bounds.maxX, Math.random());
      const y = lerp(bounds.minY, bounds.maxY, Math.random());
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
      const b = t.biomeAt(x, y);
      if (night) {
        if (b === BIOME.FOREST || b === BIOME.GRASSLAND) this.particles.firefly(x, y);
      } else if (b === BIOME.DESERT && Math.random() < 0.35) {
        this.particles.dust(x, y, 42);
      }
    }
  }

  /** Coordonnées minicarte -> monde (retourne null hors zone). */
  minimapToWorld(sx, sy) {
    if (!this.minimapCanvas || !this.options.minimap) return null;
    const { x, y, w, h } = this._minimapRect();
    if (sx < x || sx > x + w || sy < y || sy > y + h) return null;
    const t = this.eco.terrain;
    return { x: ((sx - x) / w) * t.width, y: ((sy - y) / h) * t.height };
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
