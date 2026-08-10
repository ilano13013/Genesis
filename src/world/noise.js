/**
 * Bruit de gradient 2D (type Perlin) + fBm + domain warping.
 * Utilisé pour la génération procédurale du relief et de l'humidité.
 */

const GRAD_COUNT = 256;

export class Noise {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    // Table de gradients pré-calculée : évite un sin/cos par échantillon.
    this.gx = new Float32Array(GRAD_COUNT);
    this.gy = new Float32Array(GRAD_COUNT);
    let s = this.seed || 1;
    for (let i = 0; i < GRAD_COUNT; i++) {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const a = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  _hash(ix, iy) {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ this.seed;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    return h & (GRAD_COUNT - 1);
  }

  /** Bruit de gradient dans [-1, 1]. */
  noise2(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    // Courbe quintique : dérivées continues -> pas d'artefacts en grille.
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

    const h00 = this._hash(x0, y0);
    const h10 = this._hash(x0 + 1, y0);
    const h01 = this._hash(x0, y0 + 1);
    const h11 = this._hash(x0 + 1, y0 + 1);

    const n00 = this.gx[h00] * fx + this.gy[h00] * fy;
    const n10 = this.gx[h10] * (fx - 1) + this.gy[h10] * fy;
    const n01 = this.gx[h01] * fx + this.gy[h01] * (fy - 1);
    const n11 = this.gx[h11] * (fx - 1) + this.gy[h11] * (fy - 1);

    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return a + v * (b - a);
  }

  /** Somme d'octaves. Retourne environ [-1, 1]. */
  fbm(x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** fBm à valeur absolue : crête les montagnes (aspect « ridged »). */
  ridged(x, y, octaves = 4, lacunarity = 2.1, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(this.noise2(x * freq, y * freq)));
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return (sum / norm) * 2 - 1;
  }

  /** fBm déformé par lui-même : contours organiques (continents, côtes). */
  warped(x, y, strength = 0.75, octaves = 5) {
    const wx = this.fbm(x + 5.2, y + 1.3, 3);
    const wy = this.fbm(x - 3.7, y + 8.9, 3);
    return this.fbm(x + strength * wx, y + strength * wy, octaves);
  }
}
