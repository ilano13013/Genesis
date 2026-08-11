/**
 * Couche de végétation.
 *
 * Une valeur de densité (0..1) par cellule de terrain, avec croissance
 * logistique bornée par la fertilité du sol et modulée par le climat.
 * La mise à jour est amortie : on ne balaie qu'une tranche de la grille par
 * pas de simulation, ce qui garde le coût constant même sur 25 000 cellules.
 */
import { clamp01 } from '../core/utils.js';
import { BIOME } from './terrain.js';

const SLICES = 8; // la grille entière est rafraîchie toutes les 8 étapes

export class Food {
  /** @param {import('./terrain.js').Terrain} terrain */
  constructor(terrain, rng, { energyPerUnit = 36, growthRate = 0.055, reserveRatio = 0.18 } = {}) {
    this.terrain = terrain;
    this.rng = rng;
    this.energyPerUnit = energyPerUnit;
    this.growthRate = growthRate;
    this.reserveRatio = reserveRatio;
    this.plants = new Float32Array(terrain.count);
    this.slice = 0;
    this.totalBiomass = 0;
    this._accum = new Float32Array(SLICES); // temps écoulé par tranche

    this.seedInitial();
  }

  seedInitial() {
    const { terrain, plants } = this;
    for (let i = 0; i < terrain.count; i++) {
      const cap = terrain.fertility[i];
      plants[i] = cap > 0 ? clamp01(cap * this.rng.range(0.35, 0.95)) : 0;
    }
    this.recomputeBiomass();
  }

  /** Capacité d'accueil d'une cellule pour la saison courante. */
  capacityAt(i, climate) {
    const base = this.terrain.fertility[i];
    if (base <= 0) return 0;
    // En hiver, même les sols riches plafonnent bas ; l'eau peu profonde
    // garde des algues toute l'année.
    const temp = climate.seasonTemp;
    const winterFloor = this.terrain.biome[i] === BIOME.WATER ? 0.55 : 0.18;
    const season = winterFloor + (1 - winterFloor) * (0.3 + temp * 0.7);
    return base * (season > 1 ? 1 : season);
  }

  /**
   * Croissance logistique amortie.
   * @param {number} dt pas de simulation
   * @param {import('./climate.js').Climate} climate
   */
  update(dt, climate) {
    const { terrain, plants } = this;
    const slice = this.slice;
    // Chaque tranche n'est visitée qu'une fois sur SLICES : on lui applique
    // le temps accumulé depuis son dernier passage.
    for (let s = 0; s < SLICES; s++) this._accum[s] += dt;
    const localDt = this._accum[slice];
    this._accum[slice] = 0;

    const g = this.growthRate * climate.growthFactor;
    const step = SLICES;
    const start = slice;
    for (let i = start; i < terrain.count; i += step) {
      const cap = this.capacityAt(i, climate);
      if (cap <= 0) {
        if (plants[i] !== 0) plants[i] = 0;
        continue;
      }
      const p = plants[i];
      if (p <= 0) {
        // Recolonisation lente depuis les graines dormantes du sol.
        plants[i] = Math.min(cap, 0.004 * localDt * g * 60);
        continue;
      }
      // dP/dt = g * P * (1 - P/K)
      const next = p + g * p * (1 - p / cap) * localDt;
      plants[i] = next < 0 ? 0 : next > cap ? cap : next;
    }

    this.slice = (slice + 1) % SLICES;
    if (this.slice === 0) this.recomputeBiomass();
  }

  recomputeBiomass() {
    let sum = 0;
    const p = this.plants;
    for (let i = 0; i < p.length; i++) sum += p[i];
    this.totalBiomass = sum;
    return sum;
  }

  densityAt(worldX, worldY) {
    return this.plants[this.terrain.indexAt(worldX, worldY)];
  }

  densityAtIndex(i) {
    return this.plants[i];
  }

  /**
   * Broute une cellule. Retourne l'énergie effectivement obtenue.
   *
   * Une part de la plante est hors d'atteinte du pâturage — racines, rejets,
   * pousses trop basses. Cette réserve est ce qui empêche l'écosystème de
   * partir en oscillation de relaxation : sans elle, un troupeau nombreux
   * rase une parcelle jusqu'au sol, la ressource s'effondre partout en même
   * temps, et la population avec. Avec elle, la ration par tête diminue
   * progressivement et la population sature au lieu de s'écrouler.
   * @param {number} amount quantité de densité demandée
   */
  consume(worldX, worldY, amount) {
    const i = this.terrain.indexAt(worldX, worldY);
    const reserve = this.terrain.fertility[i] * this.reserveRatio;
    const available = this.plants[i] - reserve;
    if (available <= 0.001) return 0;
    const taken = available < amount ? available : amount;
    this.plants[i] -= taken;
    return taken * this.energyPerUnit;
  }

  /** Ajoute de la matière (ex. décomposition d'un cadavre, outil « fertiliser »). */
  add(worldX, worldY, amount) {
    const i = this.terrain.indexAt(worldX, worldY);
    if (this.terrain.fertility[i] <= 0) return;
    this.plants[i] = clamp01(this.plants[i] + amount);
  }

  /** Sérialisation compacte : densité quantifiée sur 8 bits. */
  serialize() {
    const bytes = new Uint8Array(this.plants.length);
    for (let i = 0; i < this.plants.length; i++) {
      bytes[i] = Math.round(clamp01(this.plants[i]) * 255);
    }
    return bytes;
  }

  deserialize(bytes) {
    const n = Math.min(bytes.length, this.plants.length);
    for (let i = 0; i < n; i++) this.plants[i] = bytes[i] / 255;
    this.recomputeBiomass();
  }
}
