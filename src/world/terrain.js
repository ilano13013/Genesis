/**
 * Terrain procédural : relief + humidité -> biomes.
 * Les données sont stockées dans des TypedArrays alignés sur une grille
 * unique, partagée avec la couche de végétation (module food.js).
 */
import { Noise } from './noise.js';
import { clamp01, smoothstep } from '../core/utils.js';

export const BIOME = {
  DEEP_WATER: 0,
  WATER: 1,
  BEACH: 2,
  DESERT: 3,
  GRASSLAND: 4,
  FOREST: 5,
  ROCK: 6,
  SNOW: 7,
};

/**
 * Palette et propriétés de chaque biome.
 * `fertility` = capacité d'accueil végétale de base (0 = stérile).
 * `speed` = coefficient de déplacement appliqué aux créatures.
 */
export const BIOME_INFO = [
  { id: 0, key: 'deepWater', name: 'Lac profond', color: [24, 58, 104], color2: [16, 42, 82], fertility: 0.0, speed: 0.0, walkable: false },
  { id: 1, key: 'water', name: 'Eau peu profonde', color: [46, 104, 156], color2: [38, 88, 138], fertility: 0.12, speed: 0.45, walkable: true },
  { id: 2, key: 'beach', name: 'Plage', color: [214, 197, 142], color2: [198, 180, 126], fertility: 0.18, speed: 0.92, walkable: true },
  { id: 3, key: 'desert', name: 'Désert', color: [219, 184, 120], color2: [200, 162, 100], fertility: 0.14, speed: 1.0, walkable: true },
  { id: 4, key: 'grass', name: 'Prairie', color: [104, 152, 80], color2: [86, 134, 68], fertility: 0.85, speed: 1.0, walkable: true },
  { id: 5, key: 'forest', name: 'Forêt', color: [56, 108, 66], color2: [40, 88, 54], fertility: 1.0, speed: 0.82, walkable: true },
  { id: 6, key: 'rock', name: 'Montagne', color: [122, 118, 116], color2: [98, 94, 94], fertility: 0.18, speed: 0.7, walkable: true },
  { id: 7, key: 'snow', name: 'Sommet neigeux', color: [232, 236, 244], color2: [206, 214, 228], fertility: 0.05, speed: 0.55, walkable: true },
];

export class Terrain {
  /**
   * @param {object} opts
   * @param {number} opts.cols  nombre de cellules en X
   * @param {number} opts.rows  nombre de cellules en Y
   * @param {number} opts.cellSize taille d'une cellule en unités monde
   * @param {number} opts.seed
   */
  constructor({ cols = 200, rows = 125, cellSize = 16, seed = 1 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.width = cols * cellSize;
    this.height = rows * cellSize;
    this.seed = seed >>> 0;
    this.count = cols * rows;

    this.elevation = new Float32Array(this.count);
    this.moisture = new Float32Array(this.count);
    this.biome = new Uint8Array(this.count);
    this.fertility = new Float32Array(this.count);
    this.shade = new Float32Array(this.count); // relief ombré pré-calculé
    this.detail = new Float32Array(this.count); // variation locale (aspect)

    this.generate();
  }

  generate() {
    const { cols, rows } = this;
    const nElev = new Noise(this.seed);
    const nMoist = new Noise(this.seed ^ 0x9e3779b9);
    const nDetail = new Noise(this.seed ^ 0x517cc1b7);

    const sx = 3.2 / cols;
    const sy = 3.2 / rows * (rows / cols);

    let min = Infinity, max = -Infinity;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const nx = x * sx, ny = y * sy;
        // Base continentale + crêtes montagneuses en altitude.
        let e = nElev.warped(nx, ny, 0.9, 6) * 0.5 + 0.5;
        const ridge = nElev.ridged(nx * 2.1 + 11.3, ny * 2.1 - 4.7, 4) * 0.5 + 0.5;
        e = e * 0.78 + ridge * e * 0.42;
        this.elevation[i] = e;
        if (e < min) min = e;
        if (e > max) max = e;
      }
    }

    // Normalisation *avant* l'atténuation des bords : sans cela, le creux
    // côtier étirerait l'échelle et transformerait tout l'intérieur des
    // terres en sommets enneigés.
    const span = max - min || 1;
    for (let y = 0; y < rows; y++) {
      const fy = (y / (rows - 1)) * 2 - 1;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        // Léger rehaussement : garantit une part de terres émergées
        // suffisante quelle que soit la graine.
        let e = ((this.elevation[i] - min) / span) * 0.88 + 0.16;
        // Le monde devient une île cernée d'eau : frontières naturelles
        // pour les créatures, et littoral toujours praticable.
        const fx = (x / (cols - 1)) * 2 - 1;
        const d = Math.sqrt(fx * fx * 0.92 + fy * fy * 1.05);
        e -= smoothstep(0.78, 1.34, d) * 0.85;
        this.elevation[i] = clamp01(e);
      }
    }

    // L'humidité est normalisée elle aussi : le bruit fBm brut se concentre
    // autour de 0.5 et n'engendrerait presque aucun désert.
    let mMin = Infinity, mMax = -Infinity;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const m = nMoist.warped(x * sx * 1.5 + 31.7, y * sy * 1.5 - 12.4, 0.7, 5);
        this.moisture[i] = m;
        if (m < mMin) mMin = m;
        if (m > mMax) mMax = m;
      }
    }
    const mSpan = mMax - mMin || 1;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const nx = x * sx, ny = y * sy;
        const e = this.elevation[i];
        // L'humidité décroît avec l'altitude (effet de foehn simplifié) et
        // remonte près des rivages.
        let m = (this.moisture[i] - mMin) / mSpan;
        m = clamp01(m * 1.06 - 0.03 - Math.max(0, e - 0.58) * 0.7 + (e < 0.45 ? 0.22 : 0));
        this.moisture[i] = m;
        this.detail[i] = nDetail.fbm(nx * 8, ny * 8, 2) * 0.5 + 0.5;
        this.biome[i] = this._classify(e, m);
        this.fertility[i] = this._fertilityOf(this.biome[i], e, m, this.detail[i]);
      }
    }

    this._computeShade();
  }

  _classify(e, m) {
    if (e < 0.285) return BIOME.DEEP_WATER;
    if (e < 0.355) return BIOME.WATER;
    if (e < 0.395) return BIOME.BEACH;
    if (e > 0.86) return BIOME.SNOW;
    if (e > 0.74) return BIOME.ROCK;
    if (m < 0.34) return BIOME.DESERT;
    if (m < 0.585) return BIOME.GRASSLAND;
    return BIOME.FOREST;
  }

  _fertilityOf(biome, e, m, detail) {
    const base = BIOME_INFO[biome].fertility;
    // L'humidité module la fertilité à l'intérieur d'un même biome,
    // ce qui crée des dégradés au lieu de bandes uniformes.
    const humid = 0.72 + m * 0.56;
    const rough = 0.86 + detail * 0.28;
    return clamp01(base * humid * rough);
  }

  _computeShade() {
    const { cols, rows, elevation, shade } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const l = elevation[y * cols + Math.max(0, x - 1)];
        const r = elevation[y * cols + Math.min(cols - 1, x + 1)];
        const u = elevation[Math.max(0, y - 1) * cols + x];
        const d = elevation[Math.min(rows - 1, y + 1) * cols + x];
        // Lumière rasante venant du nord-ouest.
        const nx = (l - r) * 5.0;
        const ny = (u - d) * 5.0;
        shade[i] = clamp01(0.5 + (nx * 0.55 + ny * 0.55));
      }
    }
  }

  // ---------------------------------------------------------------- requêtes

  index(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }

  cellX(worldX) {
    const cx = (worldX / this.cellSize) | 0;
    return cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
  }

  cellY(worldY) {
    const cy = (worldY / this.cellSize) | 0;
    return cy < 0 ? 0 : cy >= this.rows ? this.rows - 1 : cy;
  }

  indexAt(worldX, worldY) {
    return this.cellY(worldY) * this.cols + this.cellX(worldX);
  }

  biomeAt(worldX, worldY) {
    return this.biome[this.indexAt(worldX, worldY)];
  }

  elevationAt(worldX, worldY) {
    return this.elevation[this.indexAt(worldX, worldY)];
  }

  /** Eau profonde = infranchissable. */
  isBlocked(worldX, worldY) {
    return this.biome[this.indexAt(worldX, worldY)] === BIOME.DEEP_WATER;
  }

  isWater(worldX, worldY) {
    return this.biome[this.indexAt(worldX, worldY)] <= BIOME.WATER;
  }

  /** Coefficient de vitesse du sol (0 = infranchissable). */
  speedFactor(worldX, worldY) {
    return BIOME_INFO[this.biome[this.indexAt(worldX, worldY)]].speed;
  }

  /** Cherche une position terrestre valide autour d'un point (spirale). */
  findLandNear(worldX, worldY, maxRings = 24) {
    if (!this.isBlocked(worldX, worldY)) return { x: worldX, y: worldY };
    const cs = this.cellSize;
    let cx = this.cellX(worldX), cy = this.cellY(worldY);
    for (let r = 1; r <= maxRings; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const i = this.index(cx + dx, cy + dy);
          if (i >= 0 && this.biome[i] > BIOME.DEEP_WATER) {
            return { x: (cx + dx + 0.5) * cs, y: (cy + dy + 0.5) * cs };
          }
        }
      }
    }
    return { x: this.width * 0.5, y: this.height * 0.5 };
  }

  /** Statistiques de couverture, utilisées par l'interface. */
  biomeShares() {
    const counts = new Array(BIOME_INFO.length).fill(0);
    for (let i = 0; i < this.count; i++) counts[this.biome[i]]++;
    return counts.map((c) => c / this.count);
  }
}
