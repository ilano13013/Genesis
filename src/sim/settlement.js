/**
 * Cités : ce que les peuples conscients font du monde.
 *
 * Une cité n'a pas de population abstraite. Ses habitants sont les créatures
 * réellement simulées qui vivent dans son territoire — avec leur génétique,
 * leurs naissances et leurs morts. Une cité qui grandit, c'est littéralement
 * des animaux de plus à l'écran ; une cité qui s'effondre, ce sont des morts
 * qu'on peut aller regarder.
 *
 * Tout ce qui suit est conditionnel, jamais programmé dans le temps :
 *   - le rang dépend du nombre d'habitants ;
 *   - le savoir s'accumule selon la population, l'intelligence, les ateliers
 *     et les routes commerciales ;
 *   - la découverte se tire parmi les techniques que l'état rend accessibles ;
 *   - les routes se nouent quand deux cités sont à portée ;
 *   - les raids éclatent quand deux peuples se serrent et que les greniers
 *     sont vides ;
 *   - l'abandon survient quand il ne reste personne.
 *
 * Une même graine rejouée donne donc la même histoire, mais deux graines n'en
 * donnent jamais deux semblables.
 */
import { BIOME } from '../world/terrain.js';
import { KIND, STRUCTURE_INFO } from './structures.js';
import { availableTechs, aggregateEffects, eraOf, TECH_MAP, ERAS } from './tech.js';
import { People, SAPIENCE } from './culture.js';
import { clamp, clamp01 } from '../core/utils.js';

/** Rangs successifs. `min` = habitants requis, `radius` en cellules. */
export const TIERS = [
  { key: 'camp', name: 'Campement', min: 0, radius: 6, slots: 5 },
  { key: 'hamlet', name: 'Hameau', min: 7, radius: 8, slots: 10 },
  { key: 'village', name: 'Village', min: 16, radius: 11, slots: 20 },
  { key: 'town', name: 'Bourg', min: 34, radius: 15, slots: 34 },
  { key: 'city', name: 'Cité', min: 62, radius: 20, slots: 54 },
  { key: 'metropolis', name: 'Métropole', min: 105, radius: 26, slots: 80 },
];

/** Délai avant qu'une cité vidée de ses habitants soit déclarée abandonnée. */
const ABANDON_DELAY = 130;
/** Portée de commerce de base, en unités monde. */
const BASE_TRADE_RANGE = 420;

let NEXT_SETTLEMENT_ID = 1;

export class Settlement {
  constructor(people, nest, terrain, time, rng) {
    this.id = NEXT_SETTLEMENT_ID++;
    this.peopleId = people.id;
    this.speciesId = people.speciesId;
    this.hue = people.hue;
    this.name = People.generatePlaceName(rng);
    this.nest = nest;
    this.cx = nest.cx;
    this.cy = nest.cy;
    this.x = nest.x;
    this.y = nest.y;
    this.foundedAt = time;
    this.abandoned = false;
    this.abandonedAt = null;
    this._emptyFor = 0;

    this.population = 0;
    this.peak = 0;
    this.tier = 0;
    this.tierRecord = 0;   // plus haut rang jamais atteint
    this.knowledge = 0;
    this.materials = 0;
    this.techs = new Set(people.knownTechs);
    this.era = eraOf(this.techs);
    this.effects = aggregateEffects(this.techs);
    this.routes = new Map();       // id de cité -> force (0..1)
    this.buildings = Object.create(null);
    this.structures = [nest];
    this.unrest = 0;
    this.raidCooldown = 40;
    this.avgIntellect = 0;

    // Contraintes géographiques, figées à la fondation : c'est le lieu qui
    // décide des chemins techniques ouverts à cette cité.
    const t = terrain;
    this.hasCoast = false;
    this.hasRockNearby = false;
    for (let dy = -6; dy <= 6 && !(this.hasCoast && this.hasRockNearby); dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const i = t.index(this.cx + dx, this.cy + dy);
        if (i < 0) continue;
        const b = t.biome[i];
        if (b <= BIOME.WATER) this.hasCoast = true;
        else if (b === BIOME.ROCK || b === BIOME.SNOW) this.hasRockNearby = true;
      }
    }
  }

  get tierInfo() {
    return TIERS[this.tier];
  }

  get radiusCells() {
    return TIERS[this.tier].radius;
  }

  get radius() {
    return this.radiusCells * 16;
  }

  /** Vivres stockés dans les greniers de la cité. */
  get food() {
    let sum = 0;
    for (const s of this.structures) if (s.capacity > 0) sum += s.store;
    return sum;
  }

  get foodCapacity() {
    let sum = 0;
    for (const s of this.structures) sum += s.capacity;
    return sum;
  }

  /** Force militaire : population, défense technologique, murailles. */
  get might() {
    const walls = this.buildings.wall || 0;
    return this.population * (1 + this.effects.defence + walls * 0.12);
  }

  count(kind) {
    return this.buildings[kind] || 0;
  }

  get buildingCount() {
    let n = 0;
    for (const k in this.buildings) n += this.buildings[k];
    return n;
  }

  /** Enregistre un ouvrage achevé dans la cité. */
  register(structure) {
    if (!this.structures.includes(structure)) this.structures.push(structure);
    const key = STRUCTURE_INFO[structure.kind].key;
    this.buildings[key] = (this.buildings[key] || 0) + 1;
  }

  serialize() {
    return {
      id: this.id, peopleId: this.peopleId, speciesId: this.speciesId,
      name: this.name, cx: this.cx, cy: this.cy, hue: this.hue,
      foundedAt: this.foundedAt, abandoned: this.abandoned, abandonedAt: this.abandonedAt,
      knowledge: Math.round(this.knowledge), materials: Math.round(this.materials),
      techs: [...this.techs], peak: this.peak, tier: this.tier,
    };
  }
}

/**
 * Orchestre l'ensemble des peuples et de leurs cités.
 * Ne dépend que du modèle : aucun accès au DOM, testable en headless.
 */
export class Civilisations {
  /**
   * @param {import('./ecosystem.js').Ecosystem} eco
   */
  constructor(eco) {
    this.eco = eco;
    this.list = [];
    this.byId = new Map();
    this._tickTimer = 0;
    this._tradeTimer = 0;
    this.stats = {
      peoples: 0, settlements: 0, population: 0, era: 0,
      techs: 0, routes: 0, ruins: 0,
    };
  }

  get living() {
    return this.list.filter((s) => !s.abandoned);
  }

  // ------------------------------------------------------------------ éveil

  /**
   * Une espèce bâtisseuse peut franchir le seuil de la conscience. C'est le
   * seul point d'entrée vers la civilisation, et il dépend uniquement du
   * génome — donc de la sélection naturelle qui l'a fabriqué.
   */
  checkAwakening(species, time) {
    const { peoples, chronicle, rng } = this.eco;
    if (peoples.get(species.id)) return null;
    if (!species.count) return null;
    // On juge la population vivante, pas l'archétype de fondation : une
    // lignée qui s'éveille est une lignée dont les membres, en moyenne, ont
    // franchi les trois seuils ensemble.
    if (!PeopleIsSapient({
      intellect: species.avgIntellect ?? 0,
      builder: species.avgBuilder ?? 0,
      sociability: species.avgSocial ?? 0,
    })) return null;

    const parentPeople = species.parentId ? peoples.get(species.parentId) : null;
    const people = peoples.create(species, time, rng, parentPeople);
    species.peopleId = people.id;

    if (parentPeople) {
      chronicle.add('schism', `Les ${people.name} se séparent des ${parentPeople.name}.`, {
        time, peopleId: people.id, hue: people.hue,
      });
    } else {
      chronicle.add('sapience',
        `Éveil des ${people.name} : ${species.name} franchit le seuil de la conscience.`,
        { time, peopleId: people.id, hue: people.hue });
    }

    // Les foyers déjà bâtis du temps de l'animalité deviennent les premières
    // cités du peuple : une civilisation hérite des lieux de ses ancêtres.
    for (const nest of this.eco.structures.nests) {
      if (nest.speciesId !== species.id || !nest.done || nest.settlementId) continue;
      this.found(nest, people, time);
    }
    return people;
  }

  /** Fonde une cité autour d'un nid achevé par un peuple conscient. */
  found(nest, people, time) {
    const s = new Settlement(people, nest, this.eco.terrain, time, this.eco.rng);
    s._civ = this;          // pour tracer les routes vers les partenaires
    s.plan = null;
    this.list.push(s);
    this.byId.set(s.id, s);
    people.settlements.push(s);
    people.foundedCount++;
    nest.settlementId = s.id;
    s.register(nest);
    this.eco.chronicle.add('founding',
      `Fondation de ${s.name} par les ${people.name}.`,
      { time, x: s.x, y: s.y, peopleId: people.id, settlementId: s.id, hue: s.hue });
    return s;
  }

  // ------------------------------------------------------------------ cycle

  /**
   * Avance la couche civilisationnelle. Volontairement appelée à basse
   * fréquence : une cité ne change pas d'état soixante fois par seconde, et
   * la boucle biologique n'a pas à porter ce coût.
   */
  update(dt, time) {
    this._tickTimer += dt;
    if (this._tickTimer < 1) return;
    const step = this._tickTimer;
    this._tickTimer = 0;

    this._recomputePopulations();

    for (const s of this.list) {
      if (s.abandoned) continue;
      this._updateSettlement(s, step, time);
    }

    this._tradeTimer += step;
    if (this._tradeTimer >= 6) {
      this._updateTrade(this._tradeTimer, time);
      this._tradeTimer = 0;
    }

    this.eco.peoples.prune(this.eco.species, time);
    this._collectStats();
  }

  /**
   * Rattache chaque créature consciente à sa cité. Un seul balayage : les
   * cités sont peu nombreuses, la boucle reste linéaire en population.
   */
  _recomputePopulations() {
    const living = this.living;
    for (const s of living) {
      s.population = 0;
      s._intellectSum = 0;
    }

    const creatures = this.eco.creatures;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      c.settlement = null;
      // Appartenir à un peuple conscient suffit à faire un bâtisseur : la
      // civilisation transmet le geste que la génétique seule n'assurait pas.
      c.sapient = !!this.eco.peoples.get(c.speciesId);
      if (!c.sapient || !living.length) continue;
      let best = null, bestD = Infinity;
      for (let k = 0; k < living.length; k++) {
        const s = living[k];
        if (s.speciesId !== c.speciesId) continue;
        const dx = s.x - c.x, dy = s.y - c.y;
        const d = dx * dx + dy * dy;
        const r = s.radius;
        if (d < r * r && d < bestD) { bestD = d; best = s; }
      }
      if (best) {
        best.population++;
        best._intellectSum += c.genome.intellect;
        c.settlement = best;
      }
    }

    for (const s of living) {
      s.avgIntellect = s.population ? s._intellectSum / s.population : 0;
      if (s.population > s.peak) s.peak = s.population;
    }
  }

  _updateSettlement(s, dt, time) {
    const eco = this.eco;
    const people = eco.peoples.get(s.speciesId) || eco.peoples.list.find((p) => p.id === s.peopleId);

    // ── rang
    let tier = 0;
    for (let i = TIERS.length - 1; i >= 0; i--) {
      if (s.population >= TIERS[i].min) { tier = i; break; }
    }
    s.tier = tier;
    // Seule une promotion *inédite* mérite d'être écrite : une cité qui
    // oscille autour d'un seuil au gré des saisons remplirait la chronique
    // de bruit, et noierait les événements qui comptent.
    if (tier > s.tierRecord) {
      s.tierRecord = tier;
      eco.chronicle.add('growth',
        `${s.name} devient ${TIERS[tier].name.toLowerCase()} (${s.population} habitants).`,
        { time, x: s.x, y: s.y, peopleId: s.peopleId, settlementId: s.id, hue: s.hue });
    }

    const e = s.effects;

    // ── agriculture
    // Les champs versent leur récolte dans les greniers, indépendamment de
    // ce que chaque habitant glane dans la nature. C'est la rupture décisive
    // avec le reste du vivant : une cité cesse de dépendre du cycle sauvage
    // de la végétation, et peut donc traverser les crises qui déciment les
    // espèces alentour. Sans cela, aucune civilisation ne dure assez pour
    // avoir une histoire.
    const farms = s.count('field');
    if (farms > 0) {
      const season = 0.35 + eco.climate.seasonTemp * 0.9;
      const soil = eco.terrain.fertility[eco.terrain.index(s.cx, s.cy)] || 0.3;
      let harvest = farms * 1.15 * e.food * season * (0.5 + soil) * dt;
      for (const st of s.structures) {
        if (harvest <= 0) break;
        if (st.capacity <= 0 || st.store >= st.capacity) continue;
        const room = st.capacity - st.store;
        const put = Math.min(room, harvest);
        st.store += put;
        harvest -= put;
      }
    }

    // ── savoir
    const routeBonus = 1 + Math.min(0.8, s.routes.size * 0.16);
    const workshops = s.count('workshop') + s.count('temple') * 0.5;
    s.knowledge += s.population * s.avgIntellect * 0.05
      * e.knowledge * routeBonus * (1 + workshops * 0.22) * dt;

    // ── matériaux
    s.materials += (0.05 + s.count('workshop') * 0.09 + s.count('mine') * 0.14)
      * e.materials * Math.sqrt(Math.max(1, s.population)) * dt;
    s.materials = Math.min(s.materials, 400);

    // ── découverte
    const options = availableTechs(s);
    if (options.length) {
      // Les techniques bon marché sortent plus souvent, sans jamais fermer la
      // porte aux sauts : c'est ce qui rend deux parties divergentes.
      let affordable = options.filter((t) => s.knowledge >= t.cost);
      if (affordable.length) {
        let total = 0;
        for (const t of affordable) total += 1 / t.cost;
        let r = eco.rng.next() * total;
        let chosen = affordable[0];
        for (const t of affordable) { r -= 1 / t.cost; if (r <= 0) { chosen = t; break; } }
        this._discover(s, chosen, people, time);
      }
    }

    // ── projet de construction
    if (s.materials > 20 && s.buildingCount < s.tierInfo.slots) {
      s.plan = this._chooseBuilding(s);
    } else {
      s.plan = null;
    }

    // ── faim et troubles
    const hungry = s.food < s.foodCapacity * 0.08;
    if (hungry && s.population > 4) {
      s.unrest = Math.min(1, s.unrest + dt * 0.02);
      if (s.unrest > 0.75 && eco.rng.chance(dt * 0.05)) {
        eco.chronicle.add('famine',
          `Famine à ${s.name} : les greniers sont vides.`,
          { time, x: s.x, y: s.y, peopleId: s.peopleId, settlementId: s.id, hue: s.hue });
        s.unrest = 0.4;
      }
    } else {
      s.unrest = Math.max(0, s.unrest - dt * 0.03);
    }

    // ── abandon
    if (s.population === 0) {
      s._emptyFor += dt;
      if (s._emptyFor > ABANDON_DELAY) this._abandon(s, time);
    } else {
      s._emptyFor = 0;
    }

    // ── raids
    s.raidCooldown -= dt;
    if (s.raidCooldown <= 0) {
      s.raidCooldown = 30 + eco.rng.next() * 60;
      this._maybeRaid(s, time);
    }
  }

  _discover(s, tech, people, time) {
    s.knowledge -= tech.cost;
    s.techs.add(tech.id);
    s.effects = aggregateEffects(s.techs);
    if (people) people.knownTechs.add(tech.id);

    const era = eraOf(s.techs);
    const isNewEra = era > s.era;
    s.era = era;

    this.eco.chronicle.add('tech',
      `${s.name} découvre ${tech.name.toLowerCase()}. ${tech.story}`,
      { time, x: s.x, y: s.y, peopleId: s.peopleId, settlementId: s.id, hue: s.hue });

    if (isNewEra) {
      this.eco.chronicle.add('era',
        `Les ${people ? people.name : 'anciens'} entrent dans l'${ERAS[era].name.toLowerCase()}.`,
        { time, x: s.x, y: s.y, peopleId: s.peopleId, hue: s.hue });
    }
  }

  /**
   * Choisit le prochain bâtiment selon le manque le plus criant.
   * C'est un besoin qui décide, pas une file d'attente écrite d'avance.
   */
  _chooseBuilding(s) {
    const pop = Math.max(1, s.population);
    const wants = [];
    const has = (t) => s.techs.has(t);

    // Nourriture : la priorité tant que les greniers ne suivent pas.
    wants.push({ kind: KIND.FIELD, score: 1.4 * (1 - clamp01(s.food / (pop * 6))) + (has('agriculture') ? 0.5 : 0) });
    if (has('poterie')) {
      wants.push({ kind: KIND.GRANARY, score: 1.2 * clamp01(1 - s.foodCapacity / (pop * 14)) });
    }
    if (has('construction')) {
      wants.push({ kind: KIND.HUT, score: 0.9 * clamp01(1 - s.count('hut') / (pop / 4)) });
    }
    if (has('outils')) {
      wants.push({ kind: KIND.WORKSHOP, score: 0.85 - s.count('workshop') * 0.12 });
    }
    if (has('metallurgie') && s.hasRockNearby) {
      wants.push({ kind: KIND.MINE, score: 0.8 - s.count('mine') * 0.15 });
    }
    if (has('roue')) {
      wants.push({ kind: KIND.ROAD, score: 0.6 + s.routes.size * 0.2 - s.count('road') * 0.05 });
    }
    if (has('commerce')) {
      wants.push({ kind: KIND.MARKET, score: 0.9 - s.count('market') * 0.3 });
    }
    if (has('navigation') && s.hasCoast) {
      wants.push({ kind: KIND.PORT, score: 0.9 - s.count('port') * 0.4 });
    }
    if (has('fortification')) {
      wants.push({ kind: KIND.WALL, score: 0.5 + s.unrest * 1.2 - s.count('wall') * 0.06 });
    }
    if (has('philosophie')) {
      wants.push({ kind: KIND.TEMPLE, score: 0.7 - s.count('temple') * 0.35 });
    }

    let best = null, bestScore = 0.05;
    for (const w of wants) {
      if (w.score > bestScore) { bestScore = w.score; best = w.kind; }
    }
    return best;
  }

  // --------------------------------------------------------------- commerce

  _updateTrade(dt, time) {
    const living = this.living;
    for (const a of living) {
      const range = BASE_TRADE_RANGE + a.effects.tradeRange;
      for (const b of living) {
        if (b.id <= a.id) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const reach = Math.min(range, BASE_TRADE_RANGE + b.effects.tradeRange);
        if (d > reach) {
          if (a.routes.has(b.id)) { a.routes.delete(b.id); b.routes.delete(a.id); }
          continue;
        }
        const strength = clamp01(1 - d / reach) * Math.min(1, (a.population + b.population) / 40);
        if (strength < 0.08) continue;

        const isNew = !a.routes.has(b.id);
        a.routes.set(b.id, strength);
        b.routes.set(a.id, strength);
        if (isNew) {
          this.eco.chronicle.add('trade',
            `Une route s'ouvre entre ${a.name} et ${b.name}.`,
            { time, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, peopleId: a.peopleId, hue: a.hue });
        }

        // Les biens circulent du plein vers le vide.
        this._exchangeGoods(a, b, strength, dt);
        // Et les idées avec eux.
        this._diffuseTech(a, b, strength, dt, time);
      }
    }
  }

  _exchangeGoods(a, b, strength, dt) {
    const rate = strength * dt * 0.6;
    const give = (from, to) => {
      const donor = from.structures.find((s) => s.capacity > 0 && s.store > s.capacity * 0.7);
      const receiver = to.structures.find((s) => s.capacity > 0 && s.store < s.capacity * 0.4);
      if (!donor || !receiver) return;
      const amount = Math.min(rate * 6, donor.store * 0.2, receiver.capacity - receiver.store);
      donor.store -= amount;
      receiver.store += amount * 0.9;   // pertes de transport
    };
    give(a, b);
    give(b, a);
    const flow = rate * 0.7;
    a.materials += flow * b.effects.trade;
    b.materials += flow * a.effects.trade;
  }

  _diffuseTech(a, b, strength, dt, time) {
    const chance = strength * dt * 0.02;
    const spread = (from, to) => {
      if (!this.eco.rng.chance(chance * from.effects.diffusion)) return;
      for (const id of from.techs) {
        if (to.techs.has(id)) continue;
        const tech = TECH_MAP.get(id);
        if (!tech) continue;
        // On n'emprunte que ce qu'on peut comprendre et utiliser.
        if (tech.requires.some((r) => !to.techs.has(r))) continue;
        if (tech.needs && !tech.needs(to)) continue;
        to.techs.add(id);
        to.effects = aggregateEffects(to.techs);
        to.era = eraOf(to.techs);
        const people = this.eco.peoples.list.find((p) => p.id === to.peopleId);
        if (people) people.knownTechs.add(id);
        this.eco.chronicle.add('trade',
          `${to.name} apprend ${tech.name.toLowerCase()} de ${from.name}.`,
          { time, x: to.x, y: to.y, peopleId: to.peopleId, settlementId: to.id, hue: to.hue });
        return;
      }
    };
    spread(a, b);
    spread(b, a);
  }

  // ---------------------------------------------------------------- conflit

  /**
   * Un raid n'est pas déclenché par un scénario : il faut un voisin d'un
   * autre peuple, des territoires qui se touchent, et la faim.
   */
  _maybeRaid(s, time) {
    if (s.population < 6) return;
    const eco = this.eco;
    const aggression = eco.species.get(s.speciesId)?.archetype.aggression ?? 0.3;
    const pressure = s.unrest * 0.8 + aggression * 0.6;
    if (pressure < 0.45) return;

    let target = null, bestD = Infinity;
    for (const o of this.living) {
      if (o.peopleId === s.peopleId || o.population < 3) continue;
      const dx = o.x - s.x, dy = o.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < s.radius + o.radius && d < bestD) { bestD = d; target = o; }
    }
    if (!target) return;
    if (!eco.rng.chance(clamp01(pressure - 0.35))) return;

    const attacker = s.might * (0.75 + eco.rng.next() * 0.5);
    const defender = target.might * (0.85 + eco.rng.next() * 0.5);
    const won = attacker > defender;
    const loser = won ? target : s;
    const winner = won ? s : target;

    // Pertes réelles : on tue des habitants, pas un compteur.
    const toll = Math.max(1, Math.round(loser.population * (0.12 + eco.rng.next() * 0.16)));
    let killed = 0;
    for (const c of eco.creatures) {
      if (killed >= toll) break;
      if (c.settlement !== loser || !c.alive) continue;
      c.alive = false;
      c.causeOfDeath = 'prédation';
      killed++;
    }
    const spoils = Math.min(loser.materials, 30 + eco.rng.next() * 40);
    loser.materials -= spoils;
    winner.materials += spoils * 0.7;
    loser.unrest = Math.min(1, loser.unrest + 0.3);
    winner.unrest = Math.max(0, winner.unrest - 0.25);

    eco.chronicle.add('raid',
      `${winner.name} pille ${loser.name} — ${killed} morts.`,
      { time, x: loser.x, y: loser.y, peopleId: winner.peopleId, hue: winner.hue });
  }

  _abandon(s, time) {
    s.abandoned = true;
    s.abandonedAt = time;
    const people = this.eco.peoples.list.find((p) => p.id === s.peopleId);
    if (people) people.lostCount++;
    for (const st of s.structures) st.ruined = true;
    const lived = Math.round((time - s.foundedAt) / 60);
    if (lived < 2 && s.tierRecord === 0) return;   // un campement sans lendemain
    this.eco.chronicle.add('collapse',
      `${s.name} est abandonnée après ${lived} jour(s).`,
      { time, x: s.x, y: s.y, peopleId: s.peopleId, settlementId: s.id, hue: s.hue });

    if (people && !people.settlements.some((o) => !o.abandoned)) {
      this.eco.chronicle.add('extinction',
        `Les ${people.name} n'ont plus de cité. Leur histoire s'arrête ici.`,
        { time, peopleId: people.id, hue: people.hue });
    }
  }

  // -------------------------------------------------------------- statistiques

  _collectStats() {
    const st = this.stats;
    st.settlements = 0;
    st.population = 0;
    st.ruins = 0;
    st.era = 0;
    st.routes = 0;
    const techs = new Set();
    for (const s of this.list) {
      if (s.abandoned) { st.ruins++; continue; }
      st.settlements++;
      st.population += s.population;
      st.routes += s.routes.size;
      if (s.era > st.era) st.era = s.era;
      for (const t of s.techs) techs.add(t);
    }
    st.routes = Math.round(st.routes / 2);
    st.techs = techs.size;
    st.peoples = this.eco.peoples.living.length;

    for (const p of this.eco.peoples.list) {
      let pop = 0;
      for (const s of p.settlements) if (!s.abandoned) pop += s.population;
      if (pop > p.peakPopulation) p.peakPopulation = pop;
    }
  }

  /** Cité la plus proche d'un point, pour la sélection à la souris. */
  pick(x, y) {
    let best = null, bestD = Infinity;
    for (const s of this.list) {
      const dx = s.x - x, dy = s.y - y;
      const d = dx * dx + dy * dy;
      if (d < s.radius * s.radius && d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  serialize() {
    return this.list.map((s) => s.serialize());
  }
}

/** Évite une dépendance circulaire avec culture.js. */
function PeopleIsSapient(genome) {
  return genome.intellect >= SAPIENCE.intellect
    && genome.builder >= SAPIENCE.builder
    && genome.sociability >= SAPIENCE.sociability;
}

export function resetSettlementIds(v = 1) {
  NEXT_SETTLEMENT_ID = v;
}
