/**
 * Arbre des savoirs.
 *
 * Aucune découverte n'est programmée dans le temps : une cité accumule du
 * savoir en fonction de sa population, de son intelligence moyenne, de ses
 * ateliers et de ses partenaires commerciaux, puis découvre une technique
 * *parmi celles que son état rend accessibles*. Deux parties ne suivront donc
 * pas le même chemin — une cité côtière ira vers la navigation, une cité de
 * montagne vers la métallurgie, et une cité isolée stagnera.
 *
 * Chaque technique porte :
 *   - `requires` : techniques préalables ;
 *   - `needs`    : condition sur le monde (côte, minerai, population…) ;
 *   - `effects`  : multiplicateurs appliqués à la cité qui la possède ;
 *   - `unlocks`  : type de bâtiment rendu constructible.
 */

export const ERAS = [
  { key: 'pierre', name: 'Âge de pierre', color: '#9aa4b2' },
  { key: 'neolithique', name: 'Néolithique', color: '#9be36a' },
  { key: 'bronze', name: 'Âge du bronze', color: '#e0a458' },
  { key: 'fer', name: 'Âge du fer', color: '#c0c6cf' },
  { key: 'classique', name: 'Âge classique', color: '#9b8cff' },
];

/**
 * `needs` reçoit la cité et renvoie un booléen.
 * `effects` : food, materials, knowledge, capacity, defence, tradeRange,
 *             storage — tous multiplicatifs (1 = neutre) sauf `defence`
 *             et `tradeRange` qui s'ajoutent.
 */
export const TECHS = [
  // ── Âge de pierre
  {
    id: 'feu', name: 'Maîtrise du feu', era: 0, cost: 45, requires: [],
    effects: { cold: 0.7, knowledge: 1.1 },
    story: 'La nuit recule autour des foyers.',
  },
  {
    id: 'outils', name: 'Outils de pierre', era: 0, cost: 40, requires: [],
    effects: { build: 1.35, materials: 1.2 },
    unlocks: 'workshop',
    story: 'La pierre taillée prolonge la main.',
  },
  {
    id: 'langage', name: 'Langage articulé', era: 0, cost: 60, requires: [],
    effects: { knowledge: 1.3, cohesion: 1.2 },
    story: 'Les récits se transmettent plus vite que les gestes.',
  },

  // ── Néolithique
  {
    id: 'agriculture', name: 'Agriculture', era: 1, cost: 110, requires: ['outils'],
    effects: { food: 1.4 },
    unlocks: 'farm',
    needs: (s) => s.population >= 8,
    story: 'On cesse de suivre la nourriture : on la fait pousser.',
  },
  {
    id: 'poterie', name: 'Poterie', era: 1, cost: 95, requires: ['feu'],
    effects: { storage: 1.6 },
    unlocks: 'granary',
    story: 'Le grain se garde d\'une saison à l\'autre.',
  },
  {
    id: 'construction', name: 'Charpente', era: 1, cost: 120, requires: ['outils'],
    effects: { capacity: 1.5, build: 1.2 },
    unlocks: 'hut',
    story: 'Des murs, un toit, et la pluie devient un bruit.',
  },
  {
    id: 'elevage', name: 'Élevage', era: 1, cost: 150, requires: ['agriculture'],
    effects: { food: 1.25, materials: 1.15 },
    story: 'Le troupeau suit, il ne fuit plus.',
  },

  // ── Âge du bronze
  {
    id: 'metallurgie', name: 'Métallurgie', era: 2, cost: 230, requires: ['feu', 'poterie'],
    effects: { materials: 1.5, defence: 0.2 },
    unlocks: 'mine',
    needs: (s) => s.hasRockNearby,
    story: 'La roche rend un métal que la pierre ignorait.',
  },
  {
    id: 'roue', name: 'La roue', era: 2, cost: 200, requires: ['construction'],
    effects: { tradeRange: 260, build: 1.15 },
    unlocks: 'road',
    story: 'La distance cesse d\'être une muraille.',
  },
  {
    id: 'ecriture', name: 'Écriture', era: 2, cost: 260, requires: ['langage'],
    effects: { knowledge: 1.5, diffusion: 1.8 },
    needs: (s) => s.population >= 20,
    story: 'La mémoire survit à ceux qui se souviennent.',
  },
  {
    id: 'commerce', name: 'Commerce', era: 2, cost: 220, requires: ['roue'],
    effects: { trade: 1.6, tradeRange: 180 },
    unlocks: 'market',
    story: 'Ce qui manque ici abonde ailleurs.',
  },
  {
    id: 'navigation', name: 'Navigation', era: 2, cost: 250, requires: ['construction'],
    effects: { tradeRange: 520, food: 1.15 },
    unlocks: 'port',
    needs: (s) => s.hasCoast,
    story: 'La mer devient une route au lieu d\'une fin.',
  },

  // ── Âge du fer
  {
    id: 'fer', name: 'Travail du fer', era: 3, cost: 380, requires: ['metallurgie'],
    effects: { defence: 0.35, materials: 1.3, build: 1.2 },
    story: 'Les outils mordent, et les armes aussi.',
  },
  {
    id: 'fortification', name: 'Fortifications', era: 3, cost: 360, requires: ['construction', 'metallurgie'],
    effects: { defence: 0.5 },
    unlocks: 'wall',
    story: 'On décide enfin qui entre.',
  },
  {
    id: 'irrigation', name: 'Irrigation', era: 3, cost: 340, requires: ['agriculture', 'roue'],
    effects: { food: 1.45, soil: 1.6 },
    story: 'L\'eau va désormais où on la conduit.',
  },
  {
    id: 'monnaie', name: 'Monnaie', era: 3, cost: 380, requires: ['commerce', 'ecriture'],
    effects: { trade: 1.8, knowledge: 1.15 },
    story: 'La valeur tient dans la paume.',
  },
  {
    id: 'astronomie', name: 'Astronomie', era: 3, cost: 400, requires: ['ecriture'],
    effects: { knowledge: 1.4, food: 1.1 },
    story: 'Le ciel devient un calendrier.',
  },

  // ── Âge classique
  {
    id: 'philosophie', name: 'Philosophie', era: 4, cost: 560, requires: ['ecriture', 'astronomie'],
    effects: { knowledge: 1.3, cohesion: 1.5 },
    unlocks: 'temple',
    story: 'On se demande enfin pourquoi.',
  },
  {
    id: 'aqueduc', name: 'Aqueduc', era: 4, cost: 620, requires: ['irrigation', 'fortification'],
    effects: { capacity: 1.6, food: 1.2 },
    story: 'L\'eau franchit les vallées sans se pencher.',
  },
  {
    id: 'mecanique', name: 'Mécanique', era: 4, cost: 700, requires: ['fer', 'astronomie'],
    effects: { materials: 1.6, build: 1.5, knowledge: 1.2 },
    story: 'La force n\'a plus besoin de bras.',
  },
];

export const TECH_MAP = new Map(TECHS.map((t) => [t.id, t]));

/** Techniques immédiatement accessibles à une cité. */
export function availableTechs(settlement) {
  const out = [];
  for (const t of TECHS) {
    if (settlement.techs.has(t.id)) continue;
    let ok = true;
    for (const req of t.requires) {
      if (!settlement.techs.has(req)) { ok = false; break; }
    }
    if (!ok) continue;
    if (t.needs && !t.needs(settlement)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Agrège les effets des techniques connues.
 * Les multiplicateurs se composent, les bonus additifs s'additionnent.
 */
export function aggregateEffects(techs) {
  const e = {
    food: 1, materials: 1, knowledge: 1, capacity: 1, storage: 1,
    build: 1, trade: 1, cohesion: 1, soil: 1, diffusion: 1, cold: 1,
    defence: 0, tradeRange: 0,
  };
  for (const id of techs) {
    const t = TECH_MAP.get(id);
    if (!t || !t.effects) continue;
    for (const [k, v] of Object.entries(t.effects)) {
      if (k === 'defence' || k === 'tradeRange') e[k] += v;
      else e[k] *= v;
    }
  }
  return e;
}

/** Époque atteinte : la plus avancée dont au moins une technique est connue. */
export function eraOf(techs) {
  let era = 0;
  for (const id of techs) {
    const t = TECH_MAP.get(id);
    if (t && t.era > era) era = t.era;
  }
  return era;
}

/** Part de l'arbre parcourue, pour l'affichage. */
export function progressOf(techs) {
  return techs.size / TECHS.length;
}
