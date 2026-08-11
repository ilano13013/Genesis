/**
 * Ouvrages des espèces bâtisseuses.
 *
 * Une créature dont le gène « bâtisseur » dépasse le seuil consacre une part
 * de son énergie à ériger des ouvrages qui modifient durablement le monde :
 *
 *   - **Nid** — cœur de colonie. Autour de lui, les congénères se reproduisent
 *     malgré l'encombrement : c'est ce qui permet à une espèce bâtisseuse de
 *     vivre dense là où les autres se dispersent.
 *   - **Champ** — enrichit le sol de la parcelle et de ses voisines. Répétés,
 *     les champs font remonter un désert vers la prairie puis la forêt.
 *   - **Digue** — remblaie une cellule d'eau peu profonde : le trait de côte
 *     recule, la carte gagne des terres.
 *
 * Champs et digues sont bâtis dans le rayon d'un nid : les colonies dessinent
 * donc des taches cultivées reconnaissables, pas un semis aléatoire.
 */
import { BIOME } from '../world/terrain.js';

export const KIND = { NEST: 0, FIELD: 1, DIKE: 2 };

export const STRUCTURE_INFO = [
  { key: 'nest',  name: 'Nid',   icon: '🏠', cost: 90,  radius: 3, color: [214, 178, 116] },
  { key: 'field', name: 'Champ', icon: '🌾', cost: 46,  radius: 1, color: [186, 196, 108] },
  { key: 'dike',  name: 'Digue', icon: '🧱', cost: 128, radius: 1, color: [176, 172, 164] },
];

/** Rayon cultivé autour d'un nid, en cellules. */
const COLONY_CELLS = 9;
/**
 * Distance à laquelle un bâtisseur se rattache à un nid existant. Trop
 * courte, chacun fonde le sien dès qu'il s'écarte du groupe et la carte se
 * couvre de hameaux ; assez large, une colonie unique s'étend et se cultive.
 */
const COLONY_REACH = 30;
/** Durée de ruine d'un ouvrage dont l'espèce a disparu (secondes). */
const RUIN_TIME = 280;

export class Structures {
  /**
   * @param {import('../world/terrain.js').Terrain} terrain
   * @param {import('../world/soil.js').Soil} soil
   */
  constructor(terrain, soil) {
    this.terrain = terrain;
    this.soil = soil;
    this.list = [];
    this.byCell = new Map();     // index de cellule -> ouvrage
    this.nests = [];             // sous-ensemble, pour les recherches de colonie
    this.built = { nest: 0, field: 0, dike: 0 };
  }

  get count() {
    return this.list.length;
  }

  cellIndex(cx, cy) {
    return cy * this.terrain.cols + cx;
  }

  at(cx, cy) {
    return this.byCell.get(this.cellIndex(cx, cy));
  }

  // ------------------------------------------------------------- fondation

  /** Pose un chantier. Retourne l'ouvrage, ou null si la cellule est prise. */
  found(kind, cx, cy, species, time) {
    const { cols, rows, cellSize } = this.terrain;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;
    const idx = this.cellIndex(cx, cy);
    if (this.byCell.has(idx)) return null;

    const s = {
      kind,
      cx, cy, idx,
      x: (cx + 0.5) * cellSize,
      y: (cy + 0.5) * cellSize,
      speciesId: species.id,
      hue: species.hue,
      invested: 0,
      cost: STRUCTURE_INFO[kind].cost,
      store: 0,                       // réserve du grenier (nids)
      capacity: kind === KIND.NEST ? 300 : 0,
      done: false,
      bornAt: time,
      ruin: 0,
    };
    this.list.push(s);
    this.byCell.set(idx, s);
    if (kind === KIND.NEST) this.nests.push(s);
    return s;
  }

  /**
   * Grenier : les colons rapportent quand ils ont du surplus et puisent
   * quand ils ont faim. C'est ce qui donne un intérêt *vital* au nid — bâtir
   * ne sert pas seulement à se reproduire, mais à traverser les disettes et
   * les hivers que les espèces sans réserve ne passent pas.
   *
   * @returns {number} énergie transférée (positive = la créature reçoit)
   */
  trade(nest, creature, dt) {
    if (!nest.done) return 0;
    const ratio = creature.energy / creature.maxEnergy;
    if (ratio > 0.78 && nest.store < nest.capacity) {
      const give = Math.min(4 * dt, creature.energy * 0.05, nest.capacity - nest.store);
      creature.energy -= give;
      nest.store += give * 0.85;      // une part se perd à la manutention
      return -give;
    }
    if (ratio < 0.32 && nest.store > 0) {
      const take = Math.min(7 * dt, nest.store, creature.maxEnergy - creature.energy);
      nest.store -= take;
      creature.energy += take;
      return take;
    }
    return 0;
  }

  /** Nombre de nids (achevés ou en chantier) pour une espèce. */
  nestCountFor(speciesId) {
    let n = 0;
    for (const s of this.nests) if (s.speciesId === speciesId) n++;
    return n;
  }

  /** Retire un chantier qui n'aurait pas dû être ouvert. */
  abandon(structure) {
    const i = this.list.indexOf(structure);
    if (i >= 0) this.list.splice(i, 1);
    this.byCell.delete(structure.idx);
    const n = this.nests.indexOf(structure);
    if (n >= 0) this.nests.splice(n, 1);
  }

  /**
   * Apporte de l'énergie à un chantier. Retourne true si l'ouvrage s'achève.
   */
  invest(structure, amount, time) {
    if (structure.done) return false;
    structure.invested += amount;
    if (structure.invested < structure.cost) return false;
    structure.done = true;
    structure.doneAt = time;
    this._applyEffect(structure);
    this.built[STRUCTURE_INFO[structure.kind].key]++;
    return true;
  }

  _applyEffect(s) {
    switch (s.kind) {
      case KIND.FIELD:
        // Le champ enrichit sa parcelle et déborde sur ses voisines.
        this.soil.enrichArea(s.cx, s.cy, 0.3, 1);
        break;
      case KIND.DIKE:
        this.soil.reclaim(s.idx);
        break;
      case KIND.NEST:
        this.soil.enrichArea(s.cx, s.cy, 0.06, 1);
        break;
    }
  }

  // ------------------------------------------------- choix d'un emplacement

  /**
   * Cherche un chantier pour une créature bâtisseuse : soit un chantier déjà
   * ouvert à proximité (on aide les siens), soit un nouvel emplacement.
   * @returns {object|null}
   */
  findSite(creature, species, rng, time) {
    const t = this.terrain;
    const cx = t.cellX(creature.x);
    const cy = t.cellY(creature.y);

    // 1. Un chantier en cours du même peuple, à portée : on y va.
    const pending = this._nearestPending(creature, 5);
    if (pending) return pending;

    // 2. Sans nid à proximité, on en fonde un.
    const nest = this.nearestNest(creature.x, creature.y, creature.speciesId, COLONY_REACH * t.cellSize);
    if (!nest) {
      const spot = this._scanFor(cx, cy, 3, (i, bx, by) => this._nestScore(i), rng);
      return spot === null ? null : this.found(KIND.NEST, spot.cx, spot.cy, species, time);
    }

    // 3. Dans la colonie : digue si le gène est fort et l'eau proche,
    //    champ sinon.
    const ncx = nest.cx, ncy = nest.cy;
    if (creature.genome.builder > 0.75 && rng.chance(0.35)) {
      const dike = this._scanFor(ncx, ncy, COLONY_CELLS, (i) => this._dikeScore(i), rng);
      if (dike) return this.found(KIND.DIKE, dike.cx, dike.cy, species, time);
    }
    const field = this._scanFor(ncx, ncy, COLONY_CELLS, (i) => this._fieldScore(i), rng);
    if (field) return this.found(KIND.FIELD, field.cx, field.cy, species, time);
    return null;
  }

  _nearestPending(creature, cells) {
    const t = this.terrain;
    const r = cells * t.cellSize;
    const r2 = r * r;
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s.done || s.speciesId !== creature.speciesId) continue;
      const dx = s.x - creature.x, dy = s.y - creature.y;
      const d = dx * dx + dy * dy;
      if (d < r2 && d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Balayage d'un carré de cellules ; retient le meilleur score positif. */
  _scanFor(cx, cy, radius, score, rng) {
    const t = this.terrain;
    let best = null, bestScore = 0;
    const jitter = rng ? rng.next() : 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= t.rows) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= t.cols) continue;
        const i = y * t.cols + x;
        if (this.byCell.has(i)) continue;
        let v = score(i, x, y);
        if (v <= 0) continue;
        // Léger bruit : deux bâtisseurs voisins ne convergent pas sur la
        // même case, et les colonies ne poussent pas en damier parfait.
        v *= 0.85 + ((i * 2654435761 % 1000) / 1000 + jitter) % 1 * 0.3;
        if (v > bestScore) { bestScore = v; best = { cx: x, cy: y }; }
      }
    }
    return best;
  }

  _nestScore(i) {
    const b = this.terrain.biome[i];
    if (b <= BIOME.WATER || b === BIOME.SNOW) return 0;
    // Un nid veut un sol vivable et un peu de ressource autour.
    return 0.4 + this.terrain.fertility[i];
  }

  _fieldScore(i) {
    const b = this.terrain.biome[i];
    if (b <= BIOME.WATER || b === BIOME.ROCK || b === BIOME.SNOW) return 0;
    // On cultive d'abord ce qui est pauvre : c'est là que le gain est réel.
    const room = 0.95 - this.terrain.fertility[i];
    return room > 0.08 ? room : 0;
  }

  _dikeScore(i) {
    const t = this.terrain;
    if (t.biome[i] !== BIOME.WATER) return 0;   // hauts-fonds uniquement
    // Il faut un appui : au moins une cellule de terre adjacente.
    const cols = t.cols;
    let land = 0;
    for (const j of [i - 1, i + 1, i - cols, i + cols]) {
      if (j >= 0 && j < t.count && t.biome[j] > BIOME.WATER) land++;
    }
    return land > 0 ? 0.5 + land * 0.25 : 0;
  }

  /** Nid le plus proche appartenant à une espèce donnée. */
  nearestNest(x, y, speciesId, maxDist = Infinity) {
    let best = null, bestD = maxDist * maxDist;
    for (let i = 0; i < this.nests.length; i++) {
      const n = this.nests[i];
      if (!n.done || n.speciesId !== speciesId) continue;
      const dx = n.x - x, dy = n.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /**
   * Confort de nidification en un point : 1 quand on est au pied d'un nid de
   * son espèce, 0 au-delà de sa portée. Sert à alléger la pression de densité.
   */
  nestComfort(x, y, speciesId) {
    const reach = STRUCTURE_INFO[KIND.NEST].radius * this.terrain.cellSize * 2.4;
    const nest = this.nearestNest(x, y, speciesId, reach);
    if (!nest) return 0;
    const d = Math.hypot(nest.x - x, nest.y - y);
    return Math.max(0, 1 - d / reach);
  }

  // ---------------------------------------------------------------- entretien

  /**
   * Les ouvrages d'une espèce éteinte tombent en ruine et disparaissent.
   * Ce que le sol a gagné, lui, reste : la carte garde la trace du passage.
   */
  update(dt, speciesRegistry) {
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      const sp = speciesRegistry.get(s.speciesId);
      if (!sp || sp.count === 0) {
        s.ruin += dt;
        if (s.ruin > RUIN_TIME) {
          this.byCell.delete(s.idx);
          continue;
        }
      } else if (s.ruin > 0) {
        s.ruin = Math.max(0, s.ruin - dt * 2);
      }
      // Les vivres se gâtent : un grenier ne remplace pas un territoire.
      if (s.store > 0) s.store = Math.max(0, s.store - dt * 0.5);
      this.list[w++] = s;
    }
    this.list.length = w;

    let nw = 0;
    for (let i = 0; i < this.nests.length; i++) {
      if (this.byCell.get(this.nests[i].idx) === this.nests[i]) this.nests[nw++] = this.nests[i];
    }
    this.nests.length = nw;
  }

  countByKind() {
    const out = { nest: 0, field: 0, dike: 0, chantiers: 0 };
    for (const s of this.list) {
      if (!s.done) { out.chantiers++; continue; }
      out[STRUCTURE_INFO[s.kind].key]++;
    }
    return out;
  }

  /** Ouvrages d'une espèce, pour l'interface. */
  countForSpecies(speciesId) {
    let n = 0;
    for (const s of this.list) if (s.speciesId === speciesId && s.done) n++;
    return n;
  }

  serialize() {
    return this.list.map((s) => [
      s.kind, s.cx, s.cy, s.speciesId, Math.round(s.invested),
      s.done ? 1 : 0, Math.round(s.hue), Math.round(s.store),
    ]);
  }

  /** Recharge et réapplique les effets sur le terrain. */
  deserialize(rows, time = 0) {
    this.list.length = 0;
    this.byCell.clear();
    this.nests.length = 0;
    this.built = { nest: 0, field: 0, dike: 0 };
    for (const [kind, cx, cy, speciesId, invested, done, hue, store] of rows || []) {
      const s = this.found(kind, cx, cy, { id: speciesId, hue }, time);
      if (!s) continue;
      s.invested = invested;
      s.store = store || 0;
      if (done) {
        s.done = true;
        // Les digues doivent être rejouées : le relief n'est pas sérialisé.
        if (kind === KIND.DIKE) this.soil.reclaim(s.idx);
        this.built[STRUCTURE_INFO[kind].key]++;
      }
    }
  }
}
