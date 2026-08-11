/**
 * Sol vivant : la couche qui rend la carte modifiable.
 *
 * Le terrain de départ est figé (relief, humidité de référence). Le sol, lui,
 * porte un *écart* d'humidité par cellule, que la vie fait bouger dans les
 * deux sens :
 *
 *   - **appauvrissement** — une parcelle broutée jusqu'à la terre nue pendant
 *     longtemps perd sa richesse ; la prairie devient désert ;
 *   - **enrichissement** — les champs des bâtisseurs, les cadavres qui se
 *     décomposent et les jachères la reconstituent ; le désert reverdit.
 *
 * Le biome est alors reclassé avec le classificateur d'origine : les mêmes
 * seuils qui ont dessiné le monde continuent de le redessiner. Les cellules
 * dont le biome change sont signalées « sales » pour que le rendu repeigne
 * uniquement ce qui a bougé.
 *
 * Dégrader est rapide, reconstituer est lent — c'est ce qui donne du poids
 * aux décisions de l'écosystème.
 */
import { clamp, clamp01 } from '../core/utils.js';
import { BIOME } from './terrain.js';

/** Le sol est balayé par tranches, comme la végétation. */
const SOIL_SLICES = 8;

export const SOIL = {
  // Bornes volontairement resserrées côté sec : une prairie peut devenir
  // désert, mais le monde entier ne peut pas basculer en terre morte.
  min: -0.26,
  max: 0.45,
  degradeRate: 0.00035,  // par seconde de surpâturage
  regenRate: 0.0005,     // par seconde de jachère — reconstituer va plus vite
  starvedBelow: 0.12,    // part de la capacité sous laquelle on s'appauvrit
  restedAbove: 0.7,      // et au-dessus de laquelle on se reconstitue
  // Seul un sol qui a quelque chose à perdre s'appauvrit. Sans ce garde-fou,
  // un désert continue de se dégrader faute de végétation — et la boucle
  // s'emballe jusqu'à stériliser la carte entière.
  erodibleAbove: 0.24,
};

export class Soil {
  /** @param {import('./terrain.js').Terrain} terrain */
  constructor(terrain) {
    this.terrain = terrain;
    this.count = terrain.count;
    // Humidité d'origine : le sol travaille par rapport à cette référence.
    this.baseMoisture = Float32Array.from(terrain.moisture);
    this.baseElevation = Float32Array.from(terrain.elevation);
    this.richness = new Float32Array(this.count);
    this.originBiome = Uint8Array.from(terrain.biome);
    this.dirty = new Set();
    this.slice = 0;
    this._accum = new Float32Array(SOIL_SLICES);
    // Nombre de cellules dont le biome diffère *actuellement* de l'origine.
    // Compter les transitions gonflerait le chiffre dès qu'une parcelle
    // oscille entre prairie et désert.
    this.changedCells = 0;
  }

  /**
   * Balayage amorti : une tranche par pas, comme la végétation.
   * @param {number} dt
   * @param {import('./food.js').Food} food
   */
  update(dt, food) {
    const { terrain, richness } = this;
    const slice = this.slice;
    for (let s = 0; s < SOIL_SLICES; s++) this._accum[s] += dt;
    const localDt = this._accum[slice];
    this._accum[slice] = 0;

    const degrade = SOIL.degradeRate * localDt;
    const regen = SOIL.regenRate * localDt;

    for (let i = slice; i < this.count; i += SOIL_SLICES) {
      const fert = terrain.fertility[i];
      if (fert < 0.04) continue;               // roche, neige, eau profonde
      const ratio = food.plants[i] / fert;
      let delta = 0;
      if (ratio < SOIL.starvedBelow) {
        if (fert < SOIL.erodibleAbove) continue;   // rien à éroder
        delta = -degrade;
      } else if (ratio > SOIL.restedAbove && richness[i] < 0) {
        // La jachère *répare*, elle n'améliore pas : la nature revient à son
        // état d'origine et s'y arrête. Aller au-delà demande un travail —
        // les champs des bâtisseurs ou la décomposition des cadavres.
        delta = Math.min(regen, -richness[i]);
      }
      if (delta === 0) continue;

      const next = clamp(richness[i] + delta, SOIL.min, SOIL.max);
      if (next === richness[i]) continue;
      richness[i] = next;
      this._apply(i);
    }

    this.slice = (slice + 1) % SOIL_SLICES;
  }

  /** Apport ponctuel (champ cultivé, cadavre, outil de l'interface). */
  enrich(i, amount) {
    if (i < 0 || i >= this.count) return;
    const next = clamp(this.richness[i] + amount, SOIL.min, SOIL.max);
    if (next === this.richness[i]) return;
    this.richness[i] = next;
    this._apply(i);
  }

  /** Apport étalé sur une cellule et ses voisines immédiates. */
  enrichArea(cx, cy, amount, radius = 1) {
    const { cols, rows } = this.terrain;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const falloff = dx === 0 && dy === 0 ? 1 : 0.35;
        this.enrich(y * cols + x, amount * falloff);
      }
    }
  }

  /**
   * Remblai : une cellule d'eau devient terre ferme (digue achevée).
   * C'est la seule opération qui touche au relief lui-même.
   */
  reclaim(i) {
    if (i < 0 || i >= this.count) return false;
    if (this.terrain.biome[i] > BIOME.WATER) return false;
    this.terrain.elevation[i] = 0.375;   // plage : juste au-dessus du rivage
    this.richness[i] = Math.max(this.richness[i], 0.12);
    this._apply(i);
    return true;
  }

  /** Reclasse une cellule après modification, et signale le repeint. */
  _apply(i) {
    const t = this.terrain;
    const e = t.elevation[i];
    const m = clamp01(this.baseMoisture[i] + this.richness[i]);
    t.moisture[i] = m;
    const b = t._classify(e, m);
    t.fertility[i] = t._fertilityOf(b, e, m, t.detail[i]);
    if (b !== t.biome[i]) {
      const wasChanged = t.biome[i] !== this.originBiome[i];
      const isChanged = b !== this.originBiome[i];
      if (wasChanged !== isChanged) this.changedCells += isChanged ? 1 : -1;
      t.biome[i] = b;
      this.dirty.add(i);
    }
  }

  /** Cellules à repeindre, vidées à la lecture. */
  drainDirty(limit = 64) {
    if (this.dirty.size === 0) return null;
    const out = [];
    for (const i of this.dirty) {
      out.push(i);
      if (out.length >= limit) break;
    }
    for (const i of out) this.dirty.delete(i);
    return out;
  }

  /** Part du monde dont le biome a été transformé par la vie. */
  get transformedRatio() {
    return this.changedCells / this.count;
  }

  serialize() {
    // Quantification sur 8 bits de l'intervalle [min, max].
    const bytes = new Uint8Array(this.count);
    const span = SOIL.max - SOIL.min;
    for (let i = 0; i < this.count; i++) {
      bytes[i] = Math.round(((this.richness[i] - SOIL.min) / span) * 255);
    }
    return bytes;
  }

  deserialize(bytes) {
    const span = SOIL.max - SOIL.min;
    const n = Math.min(bytes.length, this.count);
    for (let i = 0; i < n; i++) {
      this.richness[i] = SOIL.min + (bytes[i] / 255) * span;
    }
    // Reclasse tout le monde d'un coup, sans marquer de cellules sales :
    // le terrain sera repeint intégralement au chargement.
    for (let i = 0; i < this.count; i++) {
      const t = this.terrain;
      const e = t.elevation[i];
      const m = clamp01(this.baseMoisture[i] + this.richness[i]);
      t.moisture[i] = m;
      t.biome[i] = t._classify(e, m);
      t.fertility[i] = t._fertilityOf(t.biome[i], e, m, t.detail[i]);
    }
    this.dirty.clear();
  }
}
