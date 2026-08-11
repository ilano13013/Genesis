/**
 * Ouvrages : du nid animal au port d'une cité.
 *
 * Deux régimes cohabitent, et c'est voulu — la civilisation ne remplace pas
 * la biologie, elle pousse dessus :
 *
 *  - une espèce **bâtisseuse mais non consciente** ne connaît que trois
 *    ouvrages (nid, champ, digue) et les place elle-même, au jugé ;
 *  - un peuple **conscient** laisse sa cité décider *quoi* construire selon
 *    ses manques, et l'ouvrier ne fait qu'exécuter. Le geste reste le même :
 *    une créature dépense son énergie sur un chantier jusqu'à l'achèvement.
 *
 * Aucun bâtiment n'apparaît par décret : il faut une technique qui l'autorise,
 * des matériaux, un emplacement valide et quelqu'un pour le bâtir.
 */
import { BIOME } from '../world/terrain.js';

export const KIND = {
  NEST: 0, FIELD: 1, DIKE: 2, HUT: 3, GRANARY: 4, WORKSHOP: 5,
  MARKET: 6, ROAD: 7, WALL: 8, TEMPLE: 9, PORT: 10, MINE: 11,
};

export const STRUCTURE_INFO = [
  { key: 'nest', name: 'Foyer', icon: '🏠', cost: 90, color: [214, 178, 116], store: 300 },
  { key: 'field', name: 'Champ', icon: '🌾', cost: 46, color: [186, 196, 108] },
  { key: 'dike', name: 'Digue', icon: '🧱', cost: 128, color: [176, 172, 164] },
  { key: 'hut', name: 'Habitation', icon: '🛖', cost: 58, color: [198, 160, 112] },
  { key: 'granary', name: 'Grenier', icon: '🏚️', cost: 86, color: [222, 196, 130], store: 420 },
  { key: 'workshop', name: 'Atelier', icon: '⚒️', cost: 100, color: [166, 148, 132] },
  { key: 'market', name: 'Marché', icon: '⚖️', cost: 138, color: [226, 170, 96] },
  { key: 'road', name: 'Route', icon: '🛣️', cost: 34, color: [172, 156, 132] },
  { key: 'wall', name: 'Muraille', icon: '🧱', cost: 116, color: [150, 150, 156] },
  { key: 'temple', name: 'Temple', icon: '🏛️', cost: 210, color: [226, 220, 240] },
  { key: 'port', name: 'Port', icon: '⚓', cost: 158, color: [140, 176, 200] },
  { key: 'mine', name: 'Mine', icon: '⛏️', cost: 124, color: [120, 116, 118] },
];

/** Rayon cultivé autour d'un nid animal, en cellules. */
const COLONY_CELLS = 9;
/** Distance de rattachement d'un bâtisseur à un nid existant, en cellules. */
const COLONY_REACH = 30;
/** Durée de ruine d'un ouvrage sans peuple pour l'entretenir (secondes). */
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
    this.byCell = new Map();
    this.nests = [];
    this.built = Object.create(null);
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

    const info = STRUCTURE_INFO[kind];
    const s = {
      kind,
      cx, cy, idx,
      x: (cx + 0.5) * cellSize,
      y: (cy + 0.5) * cellSize,
      speciesId: species.id,
      hue: species.hue,
      invested: 0,
      cost: info.cost,
      store: 0,
      capacity: info.store || 0,
      done: false,
      ruined: false,
      settlementId: null,
      bornAt: time,
      ruin: 0,
    };
    this.list.push(s);
    this.byCell.set(idx, s);
    if (kind === KIND.NEST) this.nests.push(s);
    return s;
  }

  /**
   * Grenier : les habitants rapportent leur surplus et y puisent quand ils
   * ont faim. C'est ce qui donne un intérêt *vital* à bâtir — traverser les
   * disettes et les hivers que les espèces sans réserve ne passent pas.
   * @returns {number} énergie transférée (positive = la créature reçoit)
   */
  trade(nest, creature, dt) {
    if (!nest.done || nest.capacity <= 0) return 0;

    // Transmission : autour d'un foyer, on apprend où trouver, quand semer,
    // ce qui se mange. Le gain est proportionnel à l'intelligence — c'est la
    // rétroaction qui fait décoller ce gène *là où des colonies existent*,
    // et nulle part ailleurs. Sans elle, un cerveau coûteux ne rembourse
    // jamais son entretien et la conscience n'émerge pas.
    const taught = creature.genome.intellect * 0.55 * dt;
    creature.energy = Math.min(creature.maxEnergy, creature.energy + taught);

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

  /** Apporte de l'énergie à un chantier. Retourne true s'il s'achève. */
  invest(structure, amount, time) {
    if (structure.done) return false;
    structure.invested += amount;
    if (structure.invested < structure.cost) return false;
    structure.done = true;
    structure.doneAt = time;
    this._applyEffect(structure);
    const key = STRUCTURE_INFO[structure.kind].key;
    this.built[key] = (this.built[key] || 0) + 1;
    return true;
  }

  _applyEffect(s) {
    switch (s.kind) {
      case KIND.FIELD:
        this.soil.enrichArea(s.cx, s.cy, 0.3, 1);
        break;
      case KIND.DIKE:
        this.soil.reclaim(s.idx);
        break;
      case KIND.NEST:
        this.soil.enrichArea(s.cx, s.cy, 0.06, 1);
        break;
      case KIND.ROAD:
        // Une route est une modification durable du terrain : on y circule
        // plus vite, et les caravanes suivront d'elles-mêmes ces tracés.
        this.terrain.road[s.idx] = 1;
        break;
      case KIND.PORT:
        this.soil.enrichArea(s.cx, s.cy, 0.08, 1);
        break;
    }
  }

  // ------------------------------------------------- choix d'un emplacement

  /**
   * Cherche un chantier pour une créature bâtisseuse.
   * @param {object} civ couche civilisationnelle (null si l'espèce n'est pas consciente)
   */
  findSite(creature, species, rng, time, civ = null) {
    const t = this.terrain;
    const cx = t.cellX(creature.x);
    const cy = t.cellY(creature.y);

    // 1. Un chantier en cours du même peuple, à portée : on va y aider.
    const pending = this._nearestPending(creature, 6);
    if (pending) return pending;

    const nest = this.nearestNest(creature.x, creature.y, creature.speciesId, COLONY_REACH * t.cellSize);

    // 2. Pas de foyer à portée : on en fonde un. C'est le seul acte commun
    //    aux animaux bâtisseurs et aux peuples conscients.
    if (!nest) {
      const spot = this._scanFor(cx, cy, 3, (i) => this._nestScore(i), rng);
      return spot === null ? null : this.found(KIND.NEST, spot.cx, spot.cy, species, time);
    }

    // 3. Peuple conscient : la cité a décidé de quoi elle manque.
    const settlement = civ && nest.settlementId ? civ.byId.get(nest.settlementId) : null;
    if (settlement && !settlement.abandoned && settlement.plan !== null && settlement.plan !== undefined) {
      const spot = this._placeFor(settlement.plan, settlement, rng);
      if (spot) {
        const built = this.found(settlement.plan, spot.cx, spot.cy, species, time);
        if (built) {
          built.settlementId = settlement.id;
          settlement.materials -= STRUCTURE_INFO[settlement.plan].cost * 0.25;
          return built;
        }
      }
      return null;
    }

    // 4. Espèce bâtisseuse ordinaire : champ, ou digue si l'eau est proche.
    const ncx = nest.cx, ncy = nest.cy;
    if (creature.genome.builder > 0.75 && rng.chance(0.35)) {
      const dike = this._scanFor(ncx, ncy, COLONY_CELLS, (i) => this._dikeScore(i), rng);
      if (dike) return this.found(KIND.DIKE, dike.cx, dike.cy, species, time);
    }
    const field = this._scanFor(ncx, ncy, COLONY_CELLS, (i) => this._fieldScore(i), rng);
    if (field) return this.found(KIND.FIELD, field.cx, field.cy, species, time);
    return null;
  }

  /** Emplacement adapté au type de bâtiment voulu par une cité. */
  _placeFor(kind, s, rng) {
    const r = s.radiusCells;
    const near = Math.max(2, Math.round(r * 0.45));
    switch (kind) {
      case KIND.FIELD:
        return this._scanFor(s.cx, s.cy, r, (i) => this._fieldScore(i), rng);
      case KIND.HUT:
      case KIND.GRANARY:
      case KIND.WORKSHOP:
      case KIND.MARKET:
      case KIND.TEMPLE:
        // Le cœur bâti reste compact : une cité se lit comme un centre dense.
        return this._scanFor(s.cx, s.cy, near, (i) => this._urbanScore(i), rng);
      case KIND.MINE:
        return this._scanFor(s.cx, s.cy, r, (i) => this._mineScore(i), rng);
      case KIND.PORT:
        return this._scanFor(s.cx, s.cy, r, (i) => this._dikeScore(i), rng);
      case KIND.WALL:
        return this._scanFor(s.cx, s.cy, near + 2, (i, x, y) => this._wallScore(i, x, y, s), rng);
      case KIND.ROAD:
        return this._roadSpot(s, rng);
      default:
        return null;
    }
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
    return 0.4 + this.terrain.fertility[i];
  }

  _fieldScore(i) {
    const b = this.terrain.biome[i];
    if (b <= BIOME.WATER || b === BIOME.ROCK || b === BIOME.SNOW) return 0;
    // On cultive d'abord ce qui est pauvre : c'est là que le gain est réel.
    const room = 0.95 - this.terrain.fertility[i];
    return room > 0.08 ? room : 0;
  }

  _urbanScore(i) {
    const b = this.terrain.biome[i];
    if (b <= BIOME.WATER || b === BIOME.SNOW) return 0;
    // On bâtit volontiers sur la roche et le sable : la bonne terre se cultive.
    return b === BIOME.ROCK || b === BIOME.DESERT || b === BIOME.BEACH ? 1.1 : 0.6;
  }

  _mineScore(i) {
    const b = this.terrain.biome[i];
    return b === BIOME.ROCK ? 1.2 : b === BIOME.SNOW ? 0.5 : 0;
  }

  _wallScore(i, x, y, s) {
    const b = this.terrain.biome[i];
    if (b <= BIOME.WATER) return 0;
    // Sur l'anneau extérieur du cœur bâti.
    const d = Math.max(Math.abs(x - s.cx), Math.abs(y - s.cy));
    const want = Math.max(3, Math.round(s.radiusCells * 0.45));
    return d === want ? 1 : 0;
  }

  _dikeScore(i) {
    const t = this.terrain;
    if (t.biome[i] !== BIOME.WATER) return 0;   // hauts-fonds uniquement
    const cols = t.cols;
    let land = 0;
    for (const j of [i - 1, i + 1, i - cols, i + cols]) {
      if (j >= 0 && j < t.count && t.biome[j] > BIOME.WATER) land++;
    }
    return land > 0 ? 0.5 + land * 0.25 : 0;
  }

  /**
   * Une route se pose vers un partenaire commercial : le tracé émerge des
   * échanges, il n'est pas dessiné à l'avance.
   */
  _roadSpot(s, rng) {
    const t = this.terrain;
    let target = null;
    for (const [id, strength] of s.routes) {
      if (strength > 0.15) { target = id; break; }
    }
    const civ = s._civ;
    const other = target && civ ? civ.byId.get(target) : null;
    const dirX = other ? Math.sign(other.cx - s.cx) : (rng.chance(0.5) ? 1 : -1);
    const dirY = other ? Math.sign(other.cy - s.cy) : (rng.chance(0.5) ? 1 : -1);

    for (let step = 1; step <= s.radiusCells; step++) {
      const x = s.cx + dirX * step;
      const y = s.cy + dirY * Math.round(step * (other ? Math.abs(other.cy - s.cy) / Math.max(1, Math.abs(other.cx - s.cx)) : 1) * 0.4);
      const i = t.index(x, y);
      if (i < 0 || this.byCell.has(i)) continue;
      if (t.biome[i] <= BIOME.WATER) continue;
      return { cx: x, cy: y };
    }
    return null;
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
   * Confort de nidification en un point : 1 au pied d'un foyer de son espèce,
   * 0 au-delà de sa portée. Allège la pression de densité.
   */
  nestComfort(x, y, speciesId) {
    const reach = 3 * this.terrain.cellSize * 2.4;
    const nest = this.nearestNest(x, y, speciesId, reach);
    if (!nest) return 0;
    const d = Math.hypot(nest.x - x, nest.y - y);
    return Math.max(0, 1 - d / reach);
  }

  // ---------------------------------------------------------------- entretien

  /**
   * Les ouvrages d'un peuple disparu tombent en ruine puis s'effacent.
   * Ce que le sol a gagné, lui, reste : la carte garde la trace du passage.
   */
  update(dt, speciesRegistry) {
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      const sp = speciesRegistry.get(s.speciesId);
      if (!sp || sp.count === 0 || s.ruined) {
        s.ruin += dt;
        if (s.ruin > RUIN_TIME) {
          this.byCell.delete(s.idx);
          if (s.kind === KIND.ROAD) this.terrain.road[s.idx] = 0;
          continue;
        }
      } else if (s.ruin > 0) {
        s.ruin = Math.max(0, s.ruin - dt * 2);
      }
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
    const out = { chantiers: 0, ruines: 0 };
    for (const info of STRUCTURE_INFO) out[info.key] = 0;
    for (const s of this.list) {
      if (!s.done) { out.chantiers++; continue; }
      if (s.ruined) { out.ruines++; continue; }
      out[STRUCTURE_INFO[s.kind].key]++;
    }
    return out;
  }

  countForSpecies(speciesId) {
    let n = 0;
    for (const s of this.list) if (s.speciesId === speciesId && s.done) n++;
    return n;
  }

  serialize() {
    return this.list.map((s) => [
      s.kind, s.cx, s.cy, s.speciesId, Math.round(s.invested),
      s.done ? 1 : 0, Math.round(s.hue), Math.round(s.store),
      s.settlementId || 0, s.ruined ? 1 : 0,
    ]);
  }

  deserialize(rows, time = 0) {
    this.list.length = 0;
    this.byCell.clear();
    this.nests.length = 0;
    this.built = Object.create(null);
    for (const row of rows || []) {
      const [kind, cx, cy, speciesId, invested, done, hue, store, settlementId, ruined] = row;
      const s = this.found(kind, cx, cy, { id: speciesId, hue }, time);
      if (!s) continue;
      s.invested = invested;
      s.store = store || 0;
      s.settlementId = settlementId || null;
      s.ruined = !!ruined;
      if (done) {
        s.done = true;
        // Digues et routes doivent être rejouées : le terrain n'est pas
        // sérialisé cellule par cellule.
        if (kind === KIND.DIKE) this.soil.reclaim(s.idx);
        if (kind === KIND.ROAD) this.terrain.road[s.idx] = 1;
        const key = STRUCTURE_INFO[kind].key;
        this.built[key] = (this.built[key] || 0) + 1;
      }
    }
  }
}
