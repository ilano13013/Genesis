/**
 * Génome des créatures.
 *
 * Un génome est un objet plat de gènes numériques. Chaque gène possède des
 * bornes, un écart-type de mutation et des métadonnées d'affichage : le même
 * descripteur sert à la simulation, à l'interface et à la sérialisation.
 */
import { clamp, lerp } from '../core/utils.js';

export const TRAITS = [
  { key: 'speed',       label: 'Vitesse',      unit: 'u/s', min: 18,  max: 165, sigma: 5.5,  weight: 1.0, icon: '⚡' },
  { key: 'vision',      label: 'Vision',       unit: 'u',   min: 35,  max: 360, sigma: 11,   weight: 0.9, icon: '👁️' },
  { key: 'size',        label: 'Taille',       unit: '×',   min: 0.42, max: 2.8, sigma: 0.075, weight: 1.2, icon: '⬤' },
  { key: 'metabolism',  label: 'Métabolisme',  unit: '×',   min: 0.5, max: 1.7, sigma: 0.05, weight: 0.8, icon: '🔥' },
  { key: 'fertility',   label: 'Fertilité',    unit: '×',   min: 0.2, max: 1.8, sigma: 0.06, weight: 0.7, icon: '🥚' },
  { key: 'lifespan',    label: 'Longévité',    unit: 's',   min: 90,  max: 560, sigma: 15,   weight: 0.5, icon: '⏳' },
  { key: 'carnivory',   label: 'Carnivorie',   unit: '',    min: 0,   max: 1,   sigma: 0.028, weight: 2.2, icon: '🍖' },
  { key: 'aggression',  label: 'Agressivité',  unit: '',    min: 0,   max: 1,   sigma: 0.035, weight: 0.6, icon: '💢' },
  { key: 'sociability', label: 'Sociabilité',  unit: '',    min: 0,   max: 1,   sigma: 0.035, weight: 0.4, icon: '🫂' },
  { key: 'hue',         label: 'Teinte',       unit: '°',   min: 0,   max: 360, sigma: 4,    weight: 0.0, icon: '🎨' },
];

export const TRAIT_MAP = Object.fromEntries(TRAITS.map((t) => [t.key, t]));

/** Génome neutre au milieu de chaque intervalle. */
export function defaultGenome() {
  const g = {};
  for (const t of TRAITS) g[t.key] = (t.min + t.max) / 2;
  return g;
}

/** Construit un génome à partir de valeurs partielles, bornées. */
export function makeGenome(values = {}) {
  const g = defaultGenome();
  for (const t of TRAITS) {
    if (values[t.key] !== undefined) {
      g[t.key] = t.key === 'hue'
        ? ((values[t.key] % 360) + 360) % 360
        : clamp(values[t.key], t.min, t.max);
    }
  }
  return g;
}

/** Copie profonde (les génomes n'ont que des nombres). */
export function cloneGenome(g) {
  const out = {};
  for (const t of TRAITS) out[t.key] = g[t.key];
  return out;
}

/**
 * Reproduction : moyenne pondérée des deux parents (ou copie si asexué),
 * puis mutation gaussienne gène par gène.
 * @param {object} a génome parent A
 * @param {object|null} b génome parent B (null = bourgeonnement)
 * @param {import('../core/rng.js').Rng} rng
 * @param {number} rate multiplicateur global de mutation
 */
export function breed(a, b, rng, rate = 1) {
  const child = {};
  for (const t of TRAITS) {
    let v;
    if (b) {
      if (t.key === 'hue') {
        // Interpolation circulaire pour la teinte.
        let d = ((b.hue - a.hue + 540) % 360) - 180;
        v = a.hue + d * rng.range(0.35, 0.65);
      } else {
        // Un mélange non centré évite la convergence de toute la population
        // vers la moyenne au bout de quelques générations.
        v = lerp(a[t.key], b[t.key], rng.range(0.28, 0.72));
      }
    } else {
      v = a[t.key];
    }
    if (rng.chance(0.85)) v += rng.gauss(0, t.sigma * rate);
    // Mutation rare de grande amplitude : moteur des sauts évolutifs.
    if (rng.chance(0.012 * rate)) v += rng.gauss(0, t.sigma * 6 * rate);
    child[t.key] = t.key === 'hue' ? ((v % 360) + 360) % 360 : clamp(v, t.min, t.max);
  }
  return child;
}

/**
 * Distance génétique normalisée (0 = identiques). Sert à la spéciation.
 */
export function geneticDistance(a, b) {
  let sum = 0, wsum = 0;
  for (const t of TRAITS) {
    if (t.weight <= 0) continue;
    const span = t.max - t.min;
    const d = Math.abs(a[t.key] - b[t.key]) / span;
    sum += d * d * t.weight;
    wsum += t.weight;
  }
  return Math.sqrt(sum / wsum);
}

/**
 * Teinte plausible selon le régime : verts et bleus pour les brouteurs,
 * ocres pour les omnivores, rouges et pourpres pour les prédateurs.
 * La lisibilité du monde y gagne — la couleur renseigne sur le rôle.
 */
export function hueForDiet(carnivory, rng) {
  if (carnivory < 0.3) return rng.range(78, 200);
  if (carnivory < 0.65) return rng.chance(0.5) ? rng.range(28, 62) : rng.range(200, 240);
  return rng.chance(0.65) ? rng.range(-14, 26) : rng.range(268, 320);
}

/** Génome aléatoire plausible, orienté par un régime alimentaire cible. */
export function randomGenome(rng, carnivory = null) {
  const c = carnivory === null ? (rng.chance(0.7) ? rng.range(0, 0.25) : rng.range(0.6, 0.95)) : carnivory;
  return makeGenome({
    speed: rng.range(45, 80) + c * rng.range(5, 35),
    vision: rng.range(90, 170) + c * rng.range(10, 70),
    size: rng.range(0.7, 1.3) + c * rng.range(0.05, 0.5),
    metabolism: rng.range(0.75, 1.15),
    fertility: rng.range(0.6, 1.25) - c * 0.25,
    lifespan: rng.range(150, 280),
    carnivory: c,
    aggression: c * rng.range(0.5, 1) + rng.range(0, 0.2),
    sociability: rng.range(0.15, 0.9),
    hue: hueForDiet(c, rng),
  });
}

/** Étiquette de régime alimentaire lisible. */
export function dietOf(genome) {
  const c = genome.carnivory;
  if (c < 0.3) return 'herbivore';
  if (c > 0.65) return 'carnivore';
  return 'omnivore';
}

export const DIET_LABEL = {
  herbivore: 'Herbivore',
  omnivore: 'Omnivore',
  carnivore: 'Carnivore',
};

/** Génome -> tableau compact pour la sauvegarde. */
export function genomeToArray(g) {
  return TRAITS.map((t) => Math.round(g[t.key] * 1000) / 1000);
}

export function genomeFromArray(arr) {
  const g = {};
  TRAITS.forEach((t, i) => { g[t.key] = arr[i]; });
  return makeGenome(g);
}
