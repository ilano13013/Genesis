/**
 * Pré-rendu du terrain sur un canvas hors écran.
 *
 * Le fond est peint une seule fois au chargement : la boucle d'animation ne
 * fait plus qu'un `drawImage`. La technique est en deux temps :
 *   1. une image basse résolution (une cellule = un pixel) agrandie avec
 *      lissage, ce qui donne des dégradés de biomes organiques ;
 *   2. une passe de décors vectoriels (arbres, rochers, dunes, écume) qui
 *      rend la texture crédible de près.
 */
import { BIOME, BIOME_INFO } from '../world/terrain.js';
import { Rng } from '../core/rng.js';
import { lerp, clamp01, TAU } from '../core/utils.js';

/** Sous-échantillonnage de la couche de couleur (par cellule). */
const SUB = 3;

/**
 * @param {import('../world/terrain.js').Terrain} terrain
 * @param {number} scale pixels par unité monde
 * @returns {{canvas: HTMLCanvasElement, waterPoints: Float32Array}}
 */
export function paintTerrain(terrain, scale = 1) {
  const { cols, rows, cellSize } = terrain;
  const W = Math.round(terrain.width * scale);
  const H = Math.round(terrain.height * scale);
  const px = cellSize * scale;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const grain = makeGrainTile(terrain.seed);
  const grainPattern = ctx.createPattern(grain, 'repeat');

  /**
   * Peint un rectangle de cellules : couche de couleur suréchantillonnée,
   * décors, puis grain. C'est la brique unique du rendu du sol — la carte
   * entière au chargement, un bloc de 3×3 quand une cellule se transforme.
   */
  function paintBlock(cx0, cy0, cw, ch) {
    const x0 = Math.max(0, cx0), y0 = Math.max(0, cy0);
    const x1 = Math.min(cols, cx0 + cw), y1 = Math.min(rows, cy0 + ch);
    if (x1 <= x0 || y1 <= y0) return;

    const img = buildColorImage(terrain, x0, y0, x1 - x0, y1 - y0);
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    tmp.getContext('2d').putImageData(img, 0, 0);

    const dx = x0 * px, dy = y0 * px;
    const dw = (x1 - x0) * px, dh = (y1 - y0) * px;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.clearRect(dx, dy, dw, dh);
    ctx.drawImage(tmp, dx, dy, dw, dh);

    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) drawCellDecor(ctx, terrain, cx, cy, px);
    }

    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grainPattern;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  }

  paintBlock(0, 0, cols, rows);

  return {
    canvas,
    scale,
    waterPoints: collectWaterPoints(terrain),
    /**
     * Repeint une cellule et sa couronne : les décors débordent de leur
     * case, un repeint trop serré laisserait des moitiés d'arbres.
     */
    repaintCell(cx, cy) {
      paintBlock(cx - 1, cy - 1, 3, 3);
    },
  };
}

/**
 * Couche de couleur d'un rectangle de cellules, échantillonnée trois fois
 * plus finement que la grille. Classer les biomes sur ce maillage à partir
 * d'un relief interpolé supprime l'aspect « escalier » des côtes et des
 * lisières : les frontières deviennent des courbes.
 */
function buildColorImage(terrain, cx0, cy0, cw, ch) {
  const { cols, rows } = terrain;
  const lw = cw * SUB, lh = ch * SUB;
  const img = new ImageData(lw, lh);
  const data = img.data;
  const isWater = new Uint8Array(lw * lh);

  const sample = (grid, fx, fy) => {
    const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const a = lerp(grid[y0 * cols + x0], grid[y0 * cols + x1], tx);
    const b = lerp(grid[y1 * cols + x0], grid[y1 * cols + x1], tx);
    return lerp(a, b, ty);
  };

  for (let sy = 0; sy < lh; sy++) {
    const fy = cy0 + (sy + 0.5) / SUB - 0.5;
    for (let sx = 0; sx < lw; sx++) {
      const fx = cx0 + (sx + 0.5) / SUB - 0.5;
      const e = sample(terrain.elevation, fx, fy);
      const m = sample(terrain.moisture, fx, fy);
      const d = sample(terrain.detail, fx, fy);
      const shade = sample(terrain.shade, fx, fy);
      const b = terrain._classify(e, m);
      const info = BIOME_INFO[b];

      let r = lerp(info.color2[0], info.color[0], d);
      let g = lerp(info.color2[1], info.color[1], d);
      let bl = lerp(info.color2[2], info.color[2], d);

      if (b <= BIOME.WATER) {
        // Assombrit avec la profondeur : lecture immédiate des hauts-fonds.
        const depth = clamp01((0.36 - e) / 0.36);
        r *= 1 - depth * 0.45;
        g *= 1 - depth * 0.4;
        bl *= 1 - depth * 0.18;
        isWater[sy * lw + sx] = 1;
      } else {
        const light = 0.78 + shade * 0.44;
        r *= light; g *= light; bl *= light;
        if (e > 0.7) {
          const t = (e - 0.7) * 1.6;
          r = lerp(r, 236, t * 0.35);
          g = lerp(g, 240, t * 0.35);
          bl = lerp(bl, 248, t * 0.35);
        }
      }

      const o = (sy * lw + sx) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = bl; data[o + 3] = 255;
    }
  }

  // Écume : les pixels d'eau bordant la terre sont éclaircis. Traitée dans
  // l'image plutôt qu'au trait, elle suit exactement la côte.
  for (let sy = 1; sy < lh - 1; sy++) {
    for (let sx = 1; sx < lw - 1; sx++) {
      const i = sy * lw + sx;
      if (!isWater[i]) continue;
      if (isWater[i - 1] && isWater[i + 1] && isWater[i - lw] && isWater[i + lw]) continue;
      const o = i * 4;
      data[o] = lerp(data[o], 236, 0.34);
      data[o + 1] = lerp(data[o + 1], 248, 0.34);
      data[o + 2] = lerp(data[o + 2], 255, 0.34);
    }
  }
  return img;
}

/**
 * Décors d'une cellule. Le générateur aléatoire est dérivé des coordonnées :
 * une cellule redessinée dix ans plus tard retrouve exactement ses arbres.
 */
function drawCellDecor(ctx, terrain, cx, cy, px) {
  const i = cy * terrain.cols + cx;
  const b = terrain.biome[i];
  if (b <= BIOME.WATER) return;

  const rng = new Rng((terrain.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 0);
  const x0 = cx * px, y0 = cy * px;
  const shade = 0.75 + terrain.shade[i] * 0.4;

  switch (b) {
    case BIOME.FOREST: {
      const n = rng.next() < 0.3 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        drawTree(ctx, x0 + rng.range(1, px - 1), y0 + rng.range(1, px - 1),
          px * rng.range(0.28, 0.44), rng, shade, terrain.moisture[i]);
      }
      break;
    }
    case BIOME.GRASSLAND:
      if (rng.next() < 0.07) {
        drawTree(ctx, x0 + rng.range(2, px - 2), y0 + rng.range(2, px - 2),
          px * rng.range(0.24, 0.36), rng, shade, terrain.moisture[i]);
      } else if (rng.next() < 0.5) {
        drawTuft(ctx, x0 + rng.range(2, px - 2), y0 + rng.range(2, px - 2), px * 0.3, rng, shade);
      }
      break;
    case BIOME.DESERT:
      if (rng.next() < 0.22) drawDune(ctx, x0, y0, px, rng);
      else if (rng.next() < 0.05) drawCactus(ctx, x0 + px * 0.5, y0 + px * 0.5, px * 0.4, rng);
      break;
    case BIOME.ROCK:
      if (rng.next() < 0.4) drawRock(ctx, x0 + rng.range(2, px - 2), y0 + rng.range(2, px - 2), px * rng.range(0.2, 0.42), rng, shade);
      break;
    case BIOME.SNOW:
      if (rng.next() < 0.3) drawSnowMound(ctx, x0 + rng.range(2, px - 2), y0 + rng.range(2, px - 2), px * rng.range(0.2, 0.4), rng);
      break;
    case BIOME.BEACH:
      if (rng.next() < 0.16) drawPebble(ctx, x0 + rng.range(2, px - 2), y0 + rng.range(2, px - 2), px * 0.1, rng);
      break;
  }
}

function drawTree(ctx, x, y, r, rng, shade, moisture) {
  const hue = 96 + (moisture - 0.5) * 40 + rng.range(-8, 8);
  const light = 26 + shade * 12;
  // Ombre portée
  ctx.fillStyle = 'rgba(12, 24, 16, 0.28)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y + r * 0.42, r * 0.85, r * 0.5, 0, 0, TAU);
  ctx.fill();
  // Tronc
  ctx.strokeStyle = `hsl(${28 + rng.range(-6, 6)} 32% ${18 + shade * 8}%)`;
  ctx.lineWidth = Math.max(1, r * 0.24);
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.55);
  ctx.lineTo(x, y - r * 0.1);
  ctx.stroke();
  // Frondaison : trois lobes
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k - 1) * 0.9;
    const rr = r * (0.62 + rng.range(-0.1, 0.12));
    ctx.fillStyle = `hsl(${hue} ${38 + rng.range(0, 14)}% ${light + k * 3}%)`;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.32, y + Math.sin(a) * r * 0.34 - r * 0.2, rr, 0, TAU);
    ctx.fill();
  }
  // Reflet
  ctx.fillStyle = `hsla(${hue + 14} 55% ${light + 20}% / 0.55)`;
  ctx.beginPath();
  ctx.arc(x - r * 0.24, y - r * 0.5, r * 0.3, 0, TAU);
  ctx.fill();
}

function drawTuft(ctx, x, y, r, rng, shade) {
  ctx.strokeStyle = `hsla(${92 + rng.range(-10, 14)} 42% ${30 + shade * 10}% / 0.75)`;
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(x + k * r * 0.28, y + r * 0.3);
    ctx.quadraticCurveTo(x + k * r * 0.4, y, x + k * r * 0.55 + rng.range(-1, 1), y - r * 0.5);
  }
  ctx.stroke();
}

function drawDune(ctx, x0, y0, px, rng) {
  ctx.strokeStyle = `rgba(255, 236, 190, ${rng.range(0.12, 0.3).toFixed(2)})`;
  ctx.lineWidth = Math.max(1, px * 0.09);
  ctx.beginPath();
  const y = y0 + rng.range(px * 0.2, px * 0.8);
  ctx.moveTo(x0, y);
  ctx.quadraticCurveTo(x0 + px * 0.5, y - px * rng.range(0.15, 0.4), x0 + px, y);
  ctx.stroke();
}

function drawCactus(ctx, x, y, r, rng) {
  ctx.fillStyle = 'rgba(18, 24, 16, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y + r * 0.5, r * 0.6, r * 0.28, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = `hsl(${132 + rng.range(-8, 8)} 34% 32%)`;
  ctx.lineWidth = Math.max(1.4, r * 0.34);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.5);
  ctx.lineTo(x, y - r * 0.6);
  ctx.moveTo(x, y);
  ctx.lineTo(x + r * 0.5, y - r * 0.3);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawRock(ctx, x, y, r, rng, shade) {
  const l = 34 + shade * 16;
  ctx.fillStyle = 'rgba(10, 12, 16, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y + r * 0.35, r * 0.9, r * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `hsl(${rng.range(200, 230)} 6% ${l}%)`;
  ctx.beginPath();
  const n = 5 + rng.int(3);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    const rr = r * rng.range(0.7, 1.15);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.75;
    k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `hsla(210 10% ${l + 22}% / 0.6)`;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.25, y - r * 0.3, r * 0.4, r * 0.24, -0.5, 0, TAU);
  ctx.fill();
}

function drawSnowMound(ctx, x, y, r, rng) {
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.62, rng.range(0, TAU), 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(190, 212, 240, 0.45)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.2, y + r * 0.24, r * 0.6, r * 0.3, 0, 0, TAU);
  ctx.fill();
}

function drawPebble(ctx, x, y, r, rng) {
  ctx.fillStyle = `hsla(${rng.range(28, 48)} 20% ${rng.range(46, 66)}% / 0.7)`;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.4, r, rng.range(0, TAU), 0, TAU);
  ctx.fill();
}

/** Tuile de bruit monochrome, appliquée en `overlay` sur le sol. */
function makeGrainTile(seed) {
  const tileSize = 128;
  const tile = document.createElement('canvas');
  tile.width = tile.height = tileSize;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(tileSize, tileSize);
  const rng = new Rng(seed ^ 0x1234abcd);
  for (let i = 0; i < tileSize * tileSize; i++) {
    const v = 118 + rng.range(-26, 26);
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = 34;
  }
  tctx.putImageData(img, 0, 0);
  return tile;
}

/** Échantillonne des points d'eau pour les scintillements animés. */
function collectWaterPoints(terrain) {
  const pts = [];
  const { cols, rows, cellSize } = terrain;
  const rng = new Rng(terrain.seed ^ 0xa5a5);
  for (let cy = 1; cy < rows - 1; cy += 2) {
    for (let cx = 1; cx < cols - 1; cx += 2) {
      const i = cy * cols + cx;
      if (terrain.biome[i] > BIOME.WATER) continue;
      if (rng.next() > 0.34) continue;
      pts.push((cx + rng.range(0.1, 0.9)) * cellSize, (cy + rng.range(0.1, 0.9)) * cellSize, rng.range(0, TAU));
    }
  }
  return new Float32Array(pts);
}
