/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Déterministe = une même graine reproduit exactement le même monde,
 * ce qui rend les sauvegardes fiables et les mondes partageables.
 */

/** Convertit une chaîne quelconque en entier 32 bits (hash FNV-1a). */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = Date.now()) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    this.state = this.seed || 1;
    this._spare = null;
  }

  /** Flottant dans [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Flottant dans [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Entier dans [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** Vrai avec la probabilité p. */
  chance(p) {
    return this.next() < p;
  }

  /** Élément aléatoire d'un tableau. */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Loi normale (Box–Muller), moyenne `mean`, écart-type `sd`. */
  gauss(mean = 0, sd = 1) {
    if (this._spare !== null) {
      const v = this._spare;
      this._spare = null;
      return mean + v * sd;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * mul;
    return mean + u * mul * sd;
  }

  /** Sous-générateur indépendant (utile pour isoler terrain / créatures). */
  fork() {
    return new Rng(Math.floor(this.next() * 0xffffffff));
  }

  /** État sérialisable. */
  save() {
    return { seed: this.seed, state: this.state };
  }

  load(data) {
    this.seed = data.seed >>> 0;
    this.state = data.state >>> 0;
    this._spare = null;
    return this;
  }
}

/** Instance globale pratique pour les effets purement visuels (non déterministes). */
export const visualRng = new Rng(0xc0ffee);
