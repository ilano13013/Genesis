/**
 * Peuples : ce que devient une espèce qui franchit le seuil de la conscience.
 *
 * Rien n'est écrit d'avance. Une lignée bâtisseuse dont l'intelligence, la
 * sociabilité et la pulsion de construction dépassent ensemble un seuil cesse
 * d'être un simple animal grégaire : elle reçoit un nom, une culture, et ses
 * groupes fondent des cités. Si cette espèce se scinde plus tard, le peuple
 * fille hérite de la conscience — un schisme.
 *
 * Le « caractère » d'un peuple n'est pas tiré au hasard : il se lit dans le
 * génome moyen de ses membres. Un peuple massif et cornu devient guerrier,
 * un peuple sociable et bâtisseur devient marchand.
 */

/** Seuils conjoints de l'éveil. Aucun ne suffit seul. */
export const SAPIENCE = {
  intellect: 0.5,
  builder: 0.45,
  sociability: 0.45,
};

const ONSET = ['Ka', 'Tor', 'Mel', 'Sar', 'Vhen', 'Ash', 'Dro', 'Ith', 'Nor', 'Bel',
  'Zar', 'Ulm', 'Cra', 'Hes', 'Yon', 'Pel', 'Rhu', 'Ove', 'Sil', 'Tan'];
const MIDDLE = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou', 'ei', 'au'];
const CODA = ['ndar', 'rim', 'thas', 'lon', 'vek', 'mir', 'dun', 'ska', 'peth', 'gorn',
  'seth', 'valt', 'ren', 'khar', 'tia', 'moss', 'lys', 'bran', 'dur', 'nesh'];

const PLACE_PREFIX = ['Haut', 'Val', 'Roche', 'Pierre', 'Bois', 'Rive', 'Mont', 'Clair',
  'Vieux', 'Grand', 'Fon', 'Bel', 'Sable', 'Gué', 'Cap'];
const PLACE_SUFFIX = ['combe', 'val', 'bourg', 'ford', 'haven', 'mure', 'garde', 'fonds',
  'crête', 'anse', 'plaine', 'source', 'porte', 'rive', 'terre'];

const TRAIT_LABELS = {
  builders: 'Bâtisseurs',
  traders: 'Marchands',
  warriors: 'Guerriers',
  scholars: 'Lettrés',
  farmers: 'Cultivateurs',
  sailors: 'Navigateurs',
  nomads: 'Nomades',
};

export class People {
  constructor(id, species, time, rng, parent = null) {
    this.id = id;
    this.speciesId = species.id;
    this.name = People.generateName(rng);
    this.adjective = this.name.slice(0, -1) + 'ites';
    this.hue = species.hue;
    this.bornAt = time;
    this.endedAt = null;
    this.parentId = parent ? parent.id : null;
    this.settlements = [];
    this.knownTechs = new Set(parent ? parent.knownTechs : []);
    this.character = People.characterOf(species.archetype);
    // Statistiques cumulées, pour la fiche du peuple.
    this.peakPopulation = 0;
    this.foundedCount = 0;
    this.lostCount = 0;
  }

  static generateName(rng) {
    const a = rng.pick(ONSET);
    const b = rng.chance(0.45) ? rng.pick(MIDDLE) : '';
    return a + b + rng.pick(CODA);
  }

  static generatePlaceName(rng) {
    return rng.chance(0.55)
      ? `${rng.pick(PLACE_PREFIX)}${rng.pick(PLACE_SUFFIX)}`
      : `${rng.pick(PLACE_PREFIX)}-${rng.pick(PLACE_SUFFIX)}`;
  }

  /** Caractère dominant, déduit du génome archétype. */
  static characterOf(g) {
    const scores = {
      warriors: g.aggression * 1.2 + g.horns + g.armor * 0.8,
      traders: g.sociability * 1.4 + g.speed / 200,
      builders: g.builder * 1.6,
      scholars: (g.intellect ?? 0) * 1.5 + g.lifespan / 700,
      farmers: (1 - g.carnivory) * 1.1 + g.fertility * 0.5,
      sailors: g.fins * 2,
      nomads: g.speed / 120 + (1 - g.builder),
    };
    let best = 'builders', bestV = -Infinity;
    for (const [k, v] of Object.entries(scores)) {
      if (v > bestV) { bestV = v; best = k; }
    }
    return best;
  }

  get characterLabel() {
    return TRAIT_LABELS[this.character] || 'Bâtisseurs';
  }

  get alive() {
    return this.settlements.some((s) => !s.abandoned);
  }

  serialize() {
    return {
      id: this.id, speciesId: this.speciesId, name: this.name, hue: this.hue,
      bornAt: this.bornAt, endedAt: this.endedAt, parentId: this.parentId,
      character: this.character, knownTechs: [...this.knownTechs],
      peakPopulation: this.peakPopulation, foundedCount: this.foundedCount,
      lostCount: this.lostCount,
    };
  }
}

export class PeopleRegistry {
  constructor() {
    this.list = [];
    this.bySpecies = new Map();
    this.nextId = 1;
  }

  get(speciesId) {
    return this.bySpecies.get(speciesId);
  }

  /**
   * Une espèce est-elle prête à l'éveil ? Les trois seuils doivent tomber
   * ensemble : l'intelligence seule ne fait pas une civilisation.
   */
  static isSapient(genome) {
    return genome.intellect >= SAPIENCE.intellect
      && genome.builder >= SAPIENCE.builder
      && genome.sociability >= SAPIENCE.sociability;
  }

  create(species, time, rng, parentPeople = null) {
    const p = new People(this.nextId++, species, time, rng, parentPeople);
    this.list.push(p);
    this.bySpecies.set(species.id, p);
    return p;
  }

  /** Retire les peuples dont l'espèce a disparu et dont les cités sont mortes. */
  prune(speciesRegistry, time) {
    for (const p of this.list) {
      if (p.endedAt !== null) continue;
      const sp = speciesRegistry.get(p.speciesId);
      const gone = (!sp || sp.count === 0) && !p.settlements.some((s) => !s.abandoned);
      if (gone) p.endedAt = time;
    }
  }

  get living() {
    return this.list.filter((p) => p.endedAt === null);
  }
}
