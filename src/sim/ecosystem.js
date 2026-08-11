/**
 * Écosystème : orchestre terrain, climat, végétation, créatures et espèces.
 *
 * C'est le seul module qui fait avancer le temps. Il est volontairement
 * dépourvu de toute dépendance au DOM : il peut donc tourner tel quel dans
 * un test headless (voir tests/simulation.test.mjs).
 */
import { Rng } from '../core/rng.js';
import { Terrain, BIOME } from '../world/terrain.js';
import { Food } from '../world/food.js';
import { Climate } from '../world/climate.js';
import { Soil } from '../world/soil.js';
import { Structures, KIND, STRUCTURE_INFO } from './structures.js';
import { SpatialHash } from './spatialhash.js';
import { Creature, resetCreatureIds } from './creature.js';
import { SpeciesRegistry } from './species.js';
import { breed, randomGenome, makeGenome, genomeToArray, genomeFromArray } from './genome.js';
import { clamp, clamp01, bytesToBase64, base64ToBytes } from '../core/utils.js';

const HISTORY_MAX = 300;
const EVENT_MAX = 320;

// Délai minimal entre deux réintroductions de guilde (secondes simulées).
const RESCUE_COOLDOWN = 150;


export const DEFAULT_OPTIONS = {
  cols: 200,
  rows: 125,
  cellSize: 16,
  maxPopulation: 1150,
  minPopulation: 12,
  mutationRate: 1,
  speciationThreshold: 0.19,
  autoRepopulate: true,
  // Régulation dépendante de la densité, en congénères par carré de 100×100 :
  // seuil à partir duquel la reproduction se raréfie, et plage sur laquelle
  // elle devient quasi impossible.
  maxStructures: 420,
  crowdingSoft: 1.3,
  crowdingRange: 2.4,
  dayLength: 60,
  daysPerSeason: 4,
  statsInterval: 1,
};

export class Ecosystem {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    const seed = this.options.seed ?? (Date.now() & 0xffffffff);
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);

    this.terrain = new Terrain({
      cols: this.options.cols,
      rows: this.options.rows,
      cellSize: this.options.cellSize,
      seed: this.seed,
    });
    this.food = new Food(this.terrain, this.rng.fork());
    this.soil = new Soil(this.terrain);
    this.climate = new Climate(this.rng.fork(), {
      dayLength: this.options.dayLength,
      daysPerSeason: this.options.daysPerSeason,
      // Le monde s'ouvre en milieu de matinée de printemps : pleine lumière
      // pour la première impression, et une première nuit à venir.
      time: this.options.dayLength * 0.34,
    });
    this.species = new SpeciesRegistry({
      speciationThreshold: this.options.speciationThreshold,
      maxSpecies: 26,
    });

    this.structures = new Structures(this.terrain, this.soil);
    this.grid = new SpatialHash(this.terrain.width, this.terrain.height, 128);
    this.corpseGrid = new SpatialHash(this.terrain.width, this.terrain.height, 160);

    this.creatures = [];
    this.pool = [];
    this.corpses = [];
    this.corpsePool = [];
    this.events = [];
    this.notices = [];

    this.tick = 0;
    this.time = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.deathCauses = { famine: 0, vieillesse: 0, prédation: 0 };
    this.generationMax = 0;

    this._statsTimer = 0;
    this._birthWindow = 0;
    this._deathWindow = 0;
    this._pruneTimer = 0;
    this._lastRescue = -1e9;

    this.history = {
      time: [], population: [], biomass: [], species: [], avgAge: [],
      herbivores: [], carnivores: [],
    };
    this.stats = this._emptyStats();

    // Contexte réutilisé à chaque pas (évite une allocation par créature).
    this.env = {
      terrain: this.terrain,
      food: this.food,
      climate: this.climate,
      grid: this.grid,
      rng: this.rng,
      ecosystem: this,
      tick: 0,
      allowEffects: true,
    };
  }

  _emptyStats() {
    return {
      population: 0, speciesCount: 0, avgAge: 0, avgSpeed: 0, avgSize: 0,
      avgVision: 0, avgLifespan: 0, biomass: 0, herbivores: 0, omnivores: 0,
      carnivores: 0, birthsPerMin: 0, deathsPerMin: 0, generationMax: 0,
      corpses: 0, oldest: 0, builders: 0, swimmers: 0,
      structures: 0, sites: 0, nests: 0, fields: 0, dikes: 0, transformed: 0,
    };
  }

  // ------------------------------------------------------------ peuplement

  /**
   * Peuple le monde de départ : quelques espèces herbivores et un prédateur.
   */
  seedWorld(preset = 'default') {
    // `traits` force certains gènes par-dessus le tirage aléatoire : c'est
    // ainsi qu'on garantit la présence d'un peuple bâtisseur au départ,
    // plutôt que d'attendre que la dérive génétique en fasse apparaître un.
    const presets = {
      default: [
        { count: 84, carnivory: 0.05 },
        { count: 48, carnivory: 0.18 },
        { count: 34, carnivory: 0.08, traits: { builder: 0.78, sociability: 0.85, limbs: 2.4, fertility: 0.9 } },
        { count: 26, carnivory: 0.82 },
      ],
      abundance: [
        { count: 130, carnivory: 0.05 },
        { count: 80, carnivory: 0.12 },
        { count: 40, carnivory: 0.1, traits: { builder: 0.8, sociability: 0.9 } },
        { count: 55, carnivory: 0.45 },
        { count: 30, carnivory: 0.85 },
      ],
      duel: [
        { count: 120, carnivory: 0.04 },
        { count: 40, carnivory: 0.9 },
      ],
      civilisations: [
        { count: 60, carnivory: 0.06, traits: { builder: 0.82, sociability: 0.9, limbs: 2.6 } },
        { count: 60, carnivory: 0.35, traits: { builder: 0.7, sociability: 0.75, armor: 0.35 } },
        { count: 50, carnivory: 0.05, traits: { fins: 0.75, elongation: 1.7, limbs: 0.4 } },
        { count: 28, carnivory: 0.85, traits: { horns: 0.4 } },
      ],
    };
    for (const spec of presets[preset] || presets.default) {
      const genome = randomGenome(this.rng, spec.carnivory);
      if (spec.traits) Object.assign(genome, spec.traits);
      this.addSpecies({ count: spec.count, genome });
    }
    this.sampleStats(true);
    return this;
  }

  /**
   * Crée une espèce et l'implante dans le monde.
   * @returns {import('./species.js').Species}
   */
  addSpecies({ count = 24, genome = null, name = null, hue = null, cluster = true, origin = null } = {}) {
    const g = genome ? makeGenome(genome) : randomGenome(this.rng);
    const sp = this.species.create(g, { name, bornAt: this.time, hue: hue ?? g.hue });
    sp.pinned = true;
    this.spawnMembers(sp, count, { cluster, origin });
    this.notices.push({ type: 'species-added', species: sp.id, text: `${sp.name} apparaît (${sp.dietLabel})`, time: this.time });
    return sp;
  }

  /** Ajoute `count` individus d'une espèce existante. */
  spawnMembers(species, count, { cluster = true, origin = null } = {}) {
    let cx, cy;
    if (origin) {
      cx = origin.x; cy = origin.y;
    } else {
      const p = this._randomLandPoint();
      cx = p.x; cy = p.y;
    }
    const spread = cluster ? Math.min(this.terrain.width, this.terrain.height) * 0.14 : 1e9;
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        if (cluster) {
          x = clamp(cx + this.rng.gauss(0, spread), 8, this.terrain.width - 8);
          y = clamp(cy + this.rng.gauss(0, spread), 8, this.terrain.height - 8);
        } else {
          x = this.rng.range(8, this.terrain.width - 8);
          y = this.rng.range(8, this.terrain.height - 8);
        }
        tries++;
      } while (this.terrain.isBlocked(x, y) && tries < 24);
      if (this.terrain.isBlocked(x, y)) {
        const p = this.terrain.findLandNear(x, y);
        x = p.x; y = p.y;
      }
      const genome = breed(species.archetype, null, this.rng, 0.6);
      const c = this._acquireCreature(genome, x, y, species.id, {
        age: this.rng.range(0, species.archetype.lifespan * 0.35),
      });
      species.totalBorn++;
      this.creatures.push(c);
    }
    species.count += count;
    return count;
  }

  /** Supprime une espèce (et ses individus) du monde. */
  removeSpecies(id, { leaveCorpses = false } = {}) {
    const sp = this.species.get(id);
    if (!sp) return false;
    for (const c of this.creatures) {
      if (c.speciesId === id && c.alive) {
        c.alive = false;
        c.causeOfDeath = leaveCorpses ? 'disparition' : 'retiré';
      }
    }
    this._reap(!leaveCorpses);
    this.species.remove(id);
    this.notices.push({ type: 'species-removed', text: `${sp.name} a été retirée`, time: this.time });
    return true;
  }

  _randomLandPoint() {
    for (let i = 0; i < 200; i++) {
      const x = this.rng.range(0, this.terrain.width);
      const y = this.rng.range(0, this.terrain.height);
      const b = this.terrain.biomeAt(x, y);
      if (b >= BIOME.BEACH && b <= BIOME.FOREST) return { x, y };
    }
    return { x: this.terrain.width / 2, y: this.terrain.height / 2 };
  }

  _acquireCreature(genome, x, y, speciesId, opts = {}) {
    const c = this.pool.length ? this.pool.pop() : new Creature();
    return c.reset(genome, x, y, speciesId, this.rng, opts);
  }

  // ------------------------------------------------------------------ boucle

  /** Un pas de simulation de `dt` secondes simulées. */
  step(dt) {
    this.tick++;
    this.time += dt;
    this.env.tick = this.tick;
    this.env.allowEffects = this.allowEffects !== false;

    this.climate.update(dt);
    this.food.update(dt, this.climate);
    this.soil.update(dt, this.food);
    this.structures.update(dt, this.species);

    const creatures = this.creatures;
    this.grid.build(creatures);
    this.corpseGrid.build(this.corpses);

    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.alive) c.update(dt, this.env);
    }

    this._reproduce(dt);
    this._updateCorpses(dt);
    this._reap(true);

    if (this.options.autoRepopulate && this.creatures.length < this.options.minPopulation) {
      this._repopulate();
    }

    this._statsTimer += dt;
    if (this._statsTimer >= this.options.statsInterval) {
      this.sampleStats();
      this._statsTimer = 0;
    }

    this._pruneTimer += dt;
    if (this._pruneTimer > 30) {
      this.species.prune(this.time);
      this._rescueGuilds();
      this._pruneTimer = 0;
    }
  }

  _reproduce(dt) {
    const creatures = this.creatures;
    const capacity = this.options.maxPopulation - creatures.length;
    if (capacity <= 0) return;
    let budget = capacity;
    const soft = this.options.crowdingSoft;
    const range = this.options.crowdingRange;

    for (let i = 0; i < creatures.length && budget > 0; i++) {
      const c = creatures[i];
      if (!c.alive || !c.readyToBreed) continue;

      // Régulation dépendante de la densité : passé `crowdingSoft` congénères
      // par carré de 100×100, la reproduction devient de plus en plus
      // improbable. C'est ce qui empêche une espèce prospère de saturer le
      // monde entier — et ce qui laisse respirer les espèces rares.
      // Un nid abrite la nichée : la colonie tolère une densité que des
      // animaux sans abri ne supporteraient pas. C'est tout l'intérêt de
      // bâtir, et ce qui rend les colonies visibles sur la carte.
      const shelter = this.structures.nests.length
        ? this.structures.nestComfort(c.x, c.y, c.speciesId)
        : 0;
      const tolerated = soft * (1 + shelter * 0.5);
      if (c.crowding > tolerated) {
        const pressure = clamp01((c.crowding - tolerated) / range);
        if (this.rng.next() < pressure) { c.mateSearch = 0; continue; }
      }

      const mate = c.mate;
      if (mate && mate.alive && mate.readyToBreed && mate.speciesId === c.speciesId) {
        const mx = mate.x - c.x, my = mate.y - c.y;
        const reach = c.radius + mate.radius + 6;
        if (mx * mx + my * my < reach * reach) {
          // Un seul des deux partenaires déclenche la ponte.
          if (c.id < mate.id) {
            budget -= this._makeOffspring(c, mate, budget);
          }
          continue;
        }
        c.mateSearch += dt;
      } else {
        c.mateSearch += dt;
      }

      // Reproduction asexuée de secours : évite l'extinction d'une population
      // trop clairsemée pour que deux adultes se rencontrent.
      if (c.mateSearch > 26 && c.energy > c.maxEnergy * 0.8) {
        budget -= this._makeOffspring(c, null, budget);
      }
    }
  }

  _makeOffspring(parentA, parentB, budget) {
    const sp = this.species.get(parentA.speciesId);
    if (!sp) return 0;
    const asexual = !parentB;
    const fert = parentA.genome.fertility * (parentB ? parentB.genome.fertility : 0.8);
    let litter = 1;
    if (fert > 1.1) litter = 2;
    if (fert > 1.9 && this.rng.chance(0.5)) litter = 3;
    litter = Math.min(litter, budget);
    if (litter <= 0) return 0;

    // Une portée nombreuse coûte plus cher, sans être proportionnelle :
    // il reste avantageux d'être fertile, mais pas gratuitement.
    parentA.energy -= parentA.breedingCost(asexual) * (0.7 + 0.3 * litter);
    parentA.reproCooldown = 14 / parentA.genome.fertility;
    parentA.mateSearch = 0;
    if (parentB) {
      parentB.energy -= parentB.breedingCost(false) * 0.8;
      parentB.reproCooldown = 14 / parentB.genome.fertility;
      parentB.mateSearch = 0;
      parentB.mate = null;
    }
    parentA.mate = null;

    let made = 0;
    for (let k = 0; k < litter; k++) {
      const genome = breed(
        parentA.genome,
        parentB ? parentB.genome : null,
        this.rng,
        this.options.mutationRate * (asexual ? 1.25 : 1)
      );
      const { species, isNew } = this.species.assign(genome, sp, this.time);
      const angle = this.rng.range(0, Math.PI * 2);
      const r = parentA.radius + 6;
      let x = clamp(parentA.x + Math.cos(angle) * r, 4, this.terrain.width - 4);
      let y = clamp(parentA.y + Math.sin(angle) * r, 4, this.terrain.height - 4);
      if (this.terrain.isBlocked(x, y)) { x = parentA.x; y = parentA.y; }

      const generation = parentA.generation + 1;
      const child = this._acquireCreature(genome, x, y, species.id, {
        energy: null,
        generation,
      });
      child.energy = child.maxEnergy * 0.45;
      child.reproCooldown = child.maturity * 0.5;
      this.creatures.push(child);
      species.count++;
      species.totalBorn++;
      if (generation > species.generationMax) species.generationMax = generation;
      if (generation > this.generationMax) this.generationMax = generation;
      this.totalBirths++;
      this._birthWindow++;
      made++;

      this.emit('birth', x, y, child);
      if (isNew) {
        this.notices.push({
          type: 'speciation',
          species: species.id,
          text: `Spéciation : ${species.name} se sépare de ${sp.name}`,
          time: this.time,
        });
        this.emit('speciation', x, y, child);
      }
    }
    return made;
  }

  /** Retire les morts, recycle les objets, dépose les cadavres. */
  _reap(leaveCorpses) {
    const creatures = this.creatures;
    let w = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.alive) {
        creatures[w++] = c;
        continue;
      }
      const sp = this.species.get(c.speciesId);
      if (sp) {
        sp.count = Math.max(0, sp.count - 1);
        if (c.causeOfDeath !== 'retiré') sp.totalDied++;
      }
      if (c.causeOfDeath && this.deathCauses[c.causeOfDeath] !== undefined) {
        this.deathCauses[c.causeOfDeath]++;
      }
      if (c.causeOfDeath !== 'retiré') {
        this.totalDeaths++;
        this._deathWindow++;
        this.emit('death', c.x, c.y, c);
        if (leaveCorpses && c.causeOfDeath !== 'prédation') this._dropCorpse(c);
        else if (leaveCorpses && this.rng.chance(0.35)) this._dropCorpse(c, 0.4);
      }
      c.genome = null;
      c.threat = c.prey = c.mate = null;
      if (this.pool.length < 1200) this.pool.push(c);
    }
    creatures.length = w;
  }

  _dropCorpse(c, scale = 1) {
    if (this.corpses.length > 260) return;
    const obj = this.corpsePool.length ? this.corpsePool.pop() : {};
    obj.x = c.x;
    obj.y = c.y;
    obj.size = c.genome.size;
    obj.hue = c.genome.hue;
    obj.energy = 22 * Math.pow(c.genome.size, 2) * scale;
    obj.maxEnergy = obj.energy;
    obj.age = 0;
    obj.life = 55 + c.genome.size * 25;
    this.corpses.push(obj);
  }

  _updateCorpses(dt) {
    const arr = this.corpses;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      c.age += dt;
      if (c.age >= c.life || c.energy <= 0.5) {
        // Décomposition : la matière retourne au sol et nourrit les plantes.
        this.food.add(c.x, c.y, 0.25);
        if (this.corpsePool.length < 300) this.corpsePool.push(c);
        continue;
      }
      arr[w++] = c;
    }
    arr.length = w;
  }

  /**
   * Cherche un chantier pour une créature bâtisseuse.
   * Les demandes sont espacées par la créature elle-même ; ici on se borne à
   * refuser si l'espèce a déjà plus d'ouvrages qu'elle n'a de bras.
   */
  requestBuildSite(creature) {
    const sp = this.species.get(creature.speciesId);
    if (!sp) return null;
    if (this.structures.count >= this.options.maxStructures) return null;
    // Un ouvrage pour trois individus : les colonies grandissent avec le
    // peuple qui les tient, au lieu de couvrir la carte.
    if (this.structures.countForSpecies(sp.id) > Math.max(2, sp.count / 3)) return null;
    // Un nid pour quarante individus : une espèce prospère essaime, elle ne
    // pique pas un hameau à chaque fois qu'un bâtisseur s'écarte du groupe.
    const site = this.structures.findSite(creature, sp, this.rng, this.time);
    if (site && site.kind === KIND.NEST &&
        this.structures.nestCountFor(sp.id) > 1 + sp.count / 40) {
      this.structures.abandon(site);
      return null;
    }
    return site;
  }

  /**
   * Échange avec le grenier de la colonie la plus proche.
   * Appelé de façon échelonnée : le trajet vers le nid est déjà un coût,
   * inutile d'y ajouter une recherche à chaque pas.
   */
  useNest(creature, dt) {
    if (this.structures.nests.length === 0) return;
    const reach = this.terrain.cellSize * 5;
    const nest = this.structures.nearestNest(creature.x, creature.y, creature.speciesId, reach);
    if (nest) this.structures.trade(nest, creature, dt);
  }

  /** Verse le travail d'une créature dans un chantier. */
  investInBuild(creature, structure, amount) {
    const finished = this.structures.invest(structure, amount, this.time);
    if (!finished) return;
    creature.buildTarget = null;
    const info = STRUCTURE_INFO[structure.kind];
    this.emit('build', structure.x, structure.y, creature);
    const sp = this.species.get(structure.speciesId);
    if (structure.kind !== KIND.FIELD && sp) {
      this.notices.push({
        type: 'build',
        text: `${sp.name} achève ${info.name === 'Nid' ? 'un nid' : 'une digue'}`,
        time: this.time,
      });
    }
  }

  /** Un charognard consomme le cadavre le plus proche, s'il y en a un. */
  tryScavenge(creature, dt) {
    if (this.corpses.length === 0) return;
    if ((this.tick + creature.id) % 6 !== 0) return;
    const r = creature.radius + 10;
    const found = this.corpseGrid.query(creature.x, creature.y, r);
    for (let i = 0; i < found.length; i++) {
      const corpse = found[i];
      const dx = corpse.x - creature.x, dy = corpse.y - creature.y;
      if (dx * dx + dy * dy > r * r) continue;
      const take = Math.min(corpse.energy, 26 * dt * 6);
      corpse.energy -= take;
      creature.energy = Math.min(creature.maxEnergy, creature.energy + take * creature.meatEfficiency);
      creature.flash = Math.max(creature.flash, 0.4);
      if (this.env.allowEffects && this.rng.chance(0.15)) this.emit('bite', corpse.x, corpse.y, creature);
      return;
    }
  }

  /**
   * Un pic de prédation peut faire disparaître définitivement tout un maillon
   * de la chaîne alimentaire. Quand une guilde entière s'éteint alors que le
   * monde reste peuplé, on la réintroduit — depuis une espèce éteinte du bon
   * régime si possible, sinon avec une nouvelle lignée.
   */
  _rescueGuilds() {
    if (!this.options.autoRepopulate || this.creatures.length < 24) return;
    // Carence : sans elle, un hiver rigoureux qui tue chaque vague de
    // réintroduction en déclencherait une nouvelle toutes les 30 secondes,
    // noyant l'utilisateur sous les notifications.
    if (this.time - this._lastRescue < RESCUE_COOLDOWN) return;
    if (this.stats.carnivores === 0) this._reintroduce(0.85, 8, 'prédateurs');
    else if (this.stats.herbivores + this.stats.omnivores === 0) this._reintroduce(0.06, 16, 'herbivores');
    // Une lignée bâtisseuse peut s'éteindre pendant une disette ; sans cela
    // le monde perdrait définitivement toute construction.
    else if (this.stats.builders === 0 && this.creatures.length > 60) {
      this._reintroduce(0.08, 14, 'bâtisseurs', { builder: 0.8, sociability: 0.85 });
    }
  }

  _reintroduce(carnivory, count, label, traits = null) {
    const pool = this.species.list.filter(
      (s) => s.count === 0 && Math.abs(s.archetype.carnivory - carnivory) < 0.32 &&
        (!traits || s.archetype.builder > 0.55)
    );
    if (pool.length) {
      const sp = this.rng.pick(pool);
      this.spawnMembers(sp, count);
      this._lastRescue = this.time;
      this.notices.push({
        type: 'repopulate',
        text: `Retour des ${label} : ${sp.name}`,
        time: this.time,
      });
    } else {
      const genome = randomGenome(this.rng, carnivory);
      if (traits) Object.assign(genome, traits);
      this.addSpecies({ count, genome });
      this._lastRescue = this.time;
    }
  }

  _repopulate() {
    // Réintroduit une espèce disparue à partir de son archétype, ou en crée
    // une nouvelle si le registre est vide.
    const candidates = this.species.list.filter((s) => s.pinned || s.totalBorn > 4);
    if (candidates.length && this.rng.chance(0.75)) {
      const sp = this.rng.pick(candidates);
      this.spawnMembers(sp, 12);
      this._lastRescue = this.time;
      this.notices.push({ type: 'repopulate', text: `Recolonisation : ${sp.name}`, time: this.time });
    } else {
      this.addSpecies({ count: 18, genome: randomGenome(this.rng, this.rng.chance(0.75) ? 0.08 : 0.8) });
    }
  }

  // ---------------------------------------------------------------- métriques

  sampleStats(force = false) {
    const creatures = this.creatures;
    const n = creatures.length;
    const s = this.stats;
    s.population = n;

    for (const sp of this.species.list) {
      sp.count = 0;
      sp._age = 0; sp._speed = 0; sp._size = 0; sp._vision = 0; sp._energy = 0;
    }

    let age = 0, speed = 0, size = 0, vision = 0, lifespan = 0;
    let herb = 0, omni = 0, carn = 0, oldest = 0, builders = 0, swimmers = 0;
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      const g = c.genome;
      age += c.age;
      speed += g.speed;
      size += g.size;
      vision += g.vision;
      lifespan += c.lifespan;
      if (c.age > oldest) oldest = c.age;
      const d = c.diet;
      if (d === 'herbivore') herb++;
      else if (d === 'carnivore') carn++;
      else omni++;
      if (c.isBuilder) builders++;
      if (c.canSwim) swimmers++;

      const sp = this.species.get(c.speciesId);
      if (sp) {
        sp.count++;
        sp._age += c.age;
        sp._speed += g.speed;
        sp._size += g.size;
        sp._vision += g.vision;
        sp._energy += c.energy / c.maxEnergy;
      }
    }

    s.avgAge = n ? age / n : 0;
    s.avgSpeed = n ? speed / n : 0;
    s.avgSize = n ? size / n : 0;
    s.avgVision = n ? vision / n : 0;
    s.avgLifespan = n ? lifespan / n : 0;
    s.herbivores = herb;
    s.omnivores = omni;
    s.carnivores = carn;
    s.oldest = oldest;
    s.corpses = this.corpses.length;
    s.biomass = this.food.totalBiomass;
    s.builders = builders;
    s.swimmers = swimmers;
    const built = this.structures.countByKind();
    s.nests = built.nest;
    s.fields = built.field;
    s.dikes = built.dike;
    s.sites = built.chantiers;
    s.structures = built.nest + built.field + built.dike;
    s.transformed = this.soil.transformedRatio;
    s.generationMax = this.generationMax;

    let living = 0;
    for (const sp of this.species.list) {
      if (sp.count > 0) {
        living++;
        sp.avgAge = sp._age / sp.count;
        sp.avgSpeed = sp._speed / sp.count;
        sp.avgSize = sp._size / sp.count;
        sp.avgVision = sp._vision / sp.count;
        sp.avgEnergy = sp._energy / sp.count;
        if (sp.count > sp.peak) sp.peak = sp.count;
      }
      sp.history.push(sp.count);
      if (sp.history.length > HISTORY_MAX) sp.history.shift();
    }
    s.speciesCount = living;

    const window = Math.max(1e-6, force ? 1 : this.options.statsInterval);
    s.birthsPerMin = (this._birthWindow / window) * 60;
    s.deathsPerMin = (this._deathWindow / window) * 60;
    this._birthWindow = 0;
    this._deathWindow = 0;

    const h = this.history;
    h.time.push(this.time);
    h.population.push(n);
    h.biomass.push(s.biomass);
    h.species.push(living);
    h.avgAge.push(s.avgAge);
    h.herbivores.push(herb + omni);
    h.carnivores.push(carn);
    for (const key in h) if (h[key].length > HISTORY_MAX) h[key].shift();
  }

  emit(type, x, y, source = null) {
    if (this.events.length >= EVENT_MAX) return;
    // Aux vitesses élevées, seuls les événements marquants sont conservés.
    if (!this.env.allowEffects && type !== 'speciation') return;
    this.events.push({
      type, x, y,
      hue: source && source.genome ? source.genome.hue : 0,
      size: source && source.genome ? source.genome.size : 1,
    });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  drainNotices() {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  /**
   * Créature la plus proche d'un point (sélection à la souris).
   * La tolérance de clic est le maximum entre le rayon demandé et la taille
   * de la créature : les gros animaux restent faciles à attraper de loin.
   */
  pick(x, y, radius = 26) {
    let best = null, bestD = Infinity;
    const found = this.grid.query(x, y, radius + 24);
    for (let i = 0; i < found.length; i++) {
      const c = found[i];
      const dx = c.x - x, dy = c.y - y;
      const d = dx * dx + dy * dy;
      const hit = Math.max(radius, c.radius + 6);
      if (d <= hit * hit && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ sauvegarde

  serialize() {
    return {
      version: 2,
      seed: this.seed,
      time: this.time,
      tick: this.tick,
      options: this.options,
      rng: this.rng.save(),
      climate: this.climate.serialize(),
      totals: {
        births: this.totalBirths,
        deaths: this.totalDeaths,
        causes: this.deathCauses,
        generationMax: this.generationMax,
      },
      species: this.species.list.map((s) => ({ ...s.serialize(), archetype: genomeToArray(s.archetype) })),
      nextSpeciesId: this.species.nextId,
      creatures: this.creatures.map((c) => [...c.serialize(), genomeToArray(c.genome)]),
      plants: bytesToBase64(this.food.serialize()),
      soil: bytesToBase64(this.soil.serialize()),
      structures: this.structures.serialize(),
      history: this.history,
    };
  }

  /** Reconstruit un écosystème complet depuis une sauvegarde. */
  static deserialize(data) {
    const eco = new Ecosystem({ ...data.options, seed: data.seed });
    eco.rng.load(data.rng);
    eco.time = data.time || 0;
    eco.tick = data.tick || 0;
    eco.climate.deserialize(data.climate);
    eco.food.deserialize(base64ToBytes(data.plants));
    // Le sol se recharge avant les ouvrages : les digues rejouent ensuite
    // leur remblai par-dessus l'humidité restituée.
    if (data.soil) eco.soil.deserialize(base64ToBytes(data.soil));
    if (data.structures) eco.structures.deserialize(data.structures, data.time || 0);

    eco.species.list.length = 0;
    eco.species.byId.clear();
    for (const sd of data.species) {
      const genome = Array.isArray(sd.archetype) ? genomeFromArray(sd.archetype) : makeGenome(sd.archetype);
      const sp = eco.species.create(genome, {
        name: sd.name, parentId: sd.parentId, bornAt: sd.bornAt, hue: sd.hue,
      });
      sp.id = sd.id;
      eco.species.byId.delete(sp.id);
      eco.species.byId.set(sd.id, sp);
      sp.pinned = !!sd.pinned;
      sp.totalBorn = sd.totalBorn || 0;
      sp.totalDied = sd.totalDied || 0;
      sp.peak = sd.peak || 0;
      sp.generationMax = sd.generationMax || 0;
      sp.extinctAt = sd.extinctAt ?? null;
      sp.history = sd.history || [];
    }
    eco.species.nextId = data.nextSpeciesId || eco.species.list.length + 1;

    resetCreatureIds(1);
    for (const cd of data.creatures) {
      const [speciesId, x, y, heading, energy, age, generation, lifespan, cooldown, genomeArr] = cd;
      const genome = genomeFromArray(genomeArr);
      const c = eco._acquireCreature(genome, x, y, speciesId, { energy, age, generation });
      c.heading = heading;
      c.lifespan = lifespan;
      c.reproCooldown = cooldown;
      eco.creatures.push(c);
    }

    const t = data.totals || {};
    eco.totalBirths = t.births || 0;
    eco.totalDeaths = t.deaths || 0;
    eco.deathCauses = t.causes || eco.deathCauses;
    eco.generationMax = t.generationMax || 0;
    if (data.history) eco.history = data.history;
    eco.sampleStats(true);
    return eco;
  }
}
