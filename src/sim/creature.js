/**
 * Créature : perception, décision, déplacement, métabolisme, reproduction.
 *
 * Optimisations clés pour tenir 60 FPS avec plusieurs centaines d'agents :
 *  - perception échantillonnée tous les `thinkEvery` pas, décalée par agent
 *    (les cibles sont mémorisées entre deux « réflexions ») ;
 *  - une seule requête de voisinage par réflexion, qui alimente à la fois la
 *    fuite, la chasse, la reproduction et le grégarisme ;
 *  - objets recyclés via un pool (voir ecosystem.js) : zéro allocation en
 *    régime permanent.
 */
import { TAU, clamp, clamp01, turnToward } from '../core/utils.js';
import { dietOf, BUILDER_THRESHOLD } from './genome.js';
import { BIOME } from '../world/terrain.js';

export const STATE = {
  WANDER: 0,
  FORAGE: 1,
  HUNT: 2,
  FLEE: 3,
  MATE: 4,
  REST: 5,
  BUILD: 6,
};

export const STATE_LABEL = [
  'Exploration', 'Recherche de nourriture', 'Chasse', 'Fuite',
  'Reproduction', 'Repos', 'Construction',
];

// Directions d'échantillonnage de la végétation (pré-calculées).
const SAMPLE_DIRS = 8;
const SAMPLE_COS = new Float32Array(SAMPLE_DIRS);
const SAMPLE_SIN = new Float32Array(SAMPLE_DIRS);
for (let i = 0; i < SAMPLE_DIRS; i++) {
  const a = (i / SAMPLE_DIRS) * TAU;
  SAMPLE_COS[i] = Math.cos(a);
  SAMPLE_SIN[i] = Math.sin(a);
}
const SAMPLE_RINGS = [0.34, 0.72];

// Rotation ±0.6 rad pour les antennes d'évitement (évite 4 appels trigo/pas).
const AV_COS = Math.cos(0.6);
const AV_SIN = Math.sin(0.6);

// Rayon minimal servant de référence à la mesure de densité locale.
const CROWDING_REF = 110;

/**
 * Constantes de prédation, regroupées pour pouvoir être ajustées
 * (équilibrage, tests d'écologie) sans toucher à la logique.
 *  - `bitePower` : dégâts par seconde de contact ;
 *  - `biteGain`  : part des dégâts convertie en énergie pour le prédateur ;
 *  - `mealScale` : bonus de mise à mort, proportionnel au carré de la taille.
 */
export const PREDATION = { bitePower: 34, biteGain: 0.55, mealScale: 50 };

let NEXT_ID = 1;

export class Creature {
  constructor() {
    this.id = 0;
    this.alive = false;
    this.genome = null;
    this.reset(null, 0, 0, 0, null);
  }

  /** (Ré)initialise une créature — utilisé aussi bien à la naissance qu'au recyclage. */
  reset(genome, x, y, speciesId, rng, { energy = null, generation = 0, age = 0 } = {}) {
    this.id = NEXT_ID++;
    this.alive = true;
    this.genome = genome;
    this.speciesId = speciesId;
    this.x = x;
    this.y = y;
    this.generation = generation;

    if (genome) {
      this.diet = dietOf(genome);
      this.radius = 3.2 + genome.size * 5.2;
      this.maxEnergy = 40 + 62 * Math.pow(genome.size, 1.75);
      this.lifespan = genome.lifespan * (rng ? rng.range(0.88, 1.12) : 1);
      // Histoire de vie lente chez les prédateurs : maturité tardive et
      // portées espacées. C'est ce qui amortit les cycles proie-prédateur —
      // un carnivore qui se reproduit aussi vite que ses proies provoque
      // des explosions suivies d'effondrements dont rien ne se relève.
      this.maturity = this.lifespan * (0.16 + genome.carnivory * 0.12);
      // L'intelligence prolonge la portée utile des sens : reconnaître un
      // danger de plus loin vaut mieux qu'un œil plus gros.
      this.senseRadius = Math.min(genome.vision * (0.92 + genome.intellect * 0.3), 280);
      this.plantEfficiency = Math.pow(1 - genome.carnivory, 1.3);
      this.meatEfficiency = 0.3 + 0.7 * Math.pow(genome.carnivory, 0.8);
      this.turnRate = 4.6 - genome.size * 0.75;
      this.thinkEvery = genome.vision > 220 ? 3 : 4;
      this._deriveMorphology(genome);
    }

    this.heading = rng ? rng.range(0, TAU) : 0;
    this.speed = 0;
    this.energy = energy === null ? this.maxEnergy * 0.62 : energy;
    // Moyenne lente de l'état nutritionnel. La reproduction s'y adosse plutôt
    // qu'à l'énergie instantanée : sans cette inertie, toute la population se
    // reproduit au même pic d'abondance, dépasse la capacité du milieu et
    // s'effondre en bloc. Avec elle, la croissance suit la tendance.
    this.condition = this.energy / this.maxEnergy;
    this.age = age;
    this.state = STATE.WANDER;

    this.reproCooldown = genome ? (8 + genome.carnivory * 14) / genome.fertility : 10;
    this.mateSearch = 0;
    this.attackCooldown = 0;
    this.wanderAngle = this.heading;
    this.phase = rng ? rng.range(0, TAU) : 0;
    this.flash = 0;              // impulsion visuelle (morsure, naissance)

    // Cibles mémorisées entre deux réflexions
    this.threat = null;
    this.prey = null;
    this.mate = null;
    this.crowding = 0;
    this.foodX = 0;
    this.foodY = 0;
    this.hasFoodTarget = false;
    this.flockX = 0;
    this.flockY = 0;
    this.sepX = 0;
    this.sepY = 0;

    // Cité de rattachement (peuples conscients), mise à jour par la couche
    // civilisationnelle. Un villageois s'éloigne peu de chez lui.
    this.settlement = null;
    this.sapient = false;

    // Chantier en cours (espèces bâtisseuses)
    this.buildTarget = null;
    this.buildCooldown = rng ? rng.range(0, 8) : 4;
    this.buildContributed = 0;

    this.causeOfDeath = null;
    return this;
  }

  /**
   * Traduit les gènes de morphologie en capacités.
   *
   * Chaque pièce d'anatomie est un compromis, sans quoi elle dériverait vers
   * son maximum sans rien apprendre : la carapace protège mais alourdit, les
   * nageoires ouvrent l'eau mais gênent sur terre, la crête séduit mais se
   * repère de loin, le camouflage cache aux prédateurs *et* aux partenaires.
   */
  _deriveMorphology(g) {
    this.legPairs = Math.max(0, Math.round(g.limbs));

    // Locomotion
    this.landSpeedMul = clamp(1 + g.limbs * 0.07 - g.fins * 0.2 - g.armor * 0.22, 0.35, 1.4);
    this.waterSpeedMul = 0.4 + g.fins * 1.15;
    this.canSwim = g.fins > 0.55;

    // Combat
    this.damageResist = 1 / (1 + g.armor * 2.1);
    this.thornDamage = g.horns * 13;
    this.biteBonus = 1 + g.horns * 0.35;

    // Détection : le camouflage éloigne le regard, la crête le rapproche.
    this.concealment = 1 + g.pattern * 1.7 - g.crest * 0.75;
    this.matingAppeal = 1 - g.crest * 0.5 + g.pattern * 0.6;

    // Entretien permanent de l'anatomie (énergie par seconde).
    // Volontairement modeste : les prédateurs vivent déjà à l'équilibre
    // énergétique, et un surcoût même faible les fait basculer. L'armure
    // reste le poste le plus lourd — c'est là qu'est le compromis.
    this.upkeep =
      g.armor * 0.3 * Math.pow(g.size, 1.4) +
      g.horns * 0.12 * Math.pow(g.size, 1.2) +
      g.crest * 0.1 +
      g.limbs * 0.022;

    this.isBuilder = g.builder > BUILDER_THRESHOLD;

    // L'intelligence se paie avant de rapporter : elle améliore la récolte
    // et la conduite du corps, mais un cerveau consomme en permanence. C'est
    // ce compromis qui la maintient basse tant que rien ne la récompense —
    // et qui la fait décoller dès qu'une colonie lui donne prise.
    // Trois bénéfices modestes plutôt qu'un seul décisif : mieux récolter,
    // mieux se déplacer, mieux voir venir. Un cerveau coûte en permanence,
    // mais il paie dans assez de situations pour que la sélection le pousse —
    // sans quoi aucune lignée n'atteindrait jamais le seuil de conscience.
    this.forageSkill = 0.72 + g.intellect * 0.75;
    this.moveEfficiency = 1 - g.intellect * 0.16;
    this.upkeep += g.intellect * 0.1;
  }

  /**
   * Protection offerte par la cité : gardes, enceintes, simple nombre.
   * C'est le mécanisme par lequel une civilisation échappe au cycle
   * proie-prédateur qui gouverne le reste du vivant — non par décret, mais
   * parce qu'un prédateur préfère une proie isolée à une proie entourée.
   */
  get shelter() {
    const s = this.settlement;
    if (!s || s.abandoned) return 0;
    const walls = s.buildings.wall || 0;
    return clamp01(0.2 + s.population / 160 + walls * 0.06);
  }

  get isAdult() {
    return this.age >= this.maturity;
  }

  get hunger() {
    return 1 - this.energy / this.maxEnergy;
  }

  /** Déclin des capacités en fin de vie. */
  get vigor() {
    const t = this.age / this.lifespan;
    if (t < 0.6) return Math.min(1, 0.55 + (this.age / this.maturity) * 0.45);
    return 1 - (t - 0.6) * 0.85;
  }

  get readyToBreed() {
    return (
      this.isAdult &&
      this.reproCooldown <= 0 &&
      this.energy > this.maxEnergy * 0.6 &&
      this.condition > 0.6 &&
      this.age < this.lifespan * 0.88
    );
  }

  // ------------------------------------------------------------- perception

  sense(env) {
    const { grid, food, terrain } = env;
    const g = this.genome;
    const r = this.senseRadius;

    this.threat = null;
    this.prey = null;
    this.mate = null;
    let bestThreat = Infinity, bestPrey = Infinity, bestMate = Infinity;

    let flockCount = 0, fx = 0, fy = 0, sx = 0, sy = 0;
    const wantsMate = this.readyToBreed;
    const canHunt = g.carnivory > 0.28;
    const r2 = r * r;

    const candidates = grid.query(this.x, this.y, r);
    for (let i = 0; i < candidates.length; i++) {
      const o = candidates[i];
      if (o === this || !o.alive) continue;
      const dx = o.x - this.x, dy = o.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      // Séparation : évite les empilements, quelle que soit l'espèce.
      const minD = this.radius + o.radius + 2;
      if (d2 < minD * minD && d2 > 0.01) {
        const inv = 1 / Math.sqrt(d2);
        sx -= dx * inv;
        sy -= dy * inv;
      }

      const sameSpecies = o.speciesId === this.speciesId;

      // Distance *perçue* : le camouflage l'allonge, la crête la raccourcit.
      // Un animal bien camouflé peut se trouver physiquement proche sans
      // jamais être repéré — c'est là que le gène gagne sa place.
      const seen = d2 * o.concealment;

      // Prédateur : plus carnivore et sensiblement plus gros que moi.
      if (!sameSpecies && seen <= r2 && o.genome.carnivory > 0.32 && o.genome.size > g.size * 0.82) {
        const danger = seen / (o.genome.carnivory * o.genome.size);
        if (danger < bestThreat) { bestThreat = danger; this.threat = o; }
      }

      // Proie : plus petite, et pas de ma propre espèce. Une carapace épaisse
      // dissuade — et une cité peuplée encore davantage.
      if (canHunt && !sameSpecies && seen <= r2 && o.genome.size < g.size * 1.12) {
        const gain = (seen * (1 + o.genome.armor * 1.4 + o.genome.horns * 0.9 + o.shelter * 3))
          / (0.4 + o.genome.size);
        if (gain < bestPrey) { bestPrey = gain; this.prey = o; }
      }

      if (sameSpecies) {
        flockCount++;
        fx += o.x;
        fy += o.y;
        if (wantsMate && o.readyToBreed) {
          // La parade nuptiale se voit : la crête attire, le camouflage isole.
          const appeal = d2 * o.matingAppeal;
          if (appeal < bestMate) {
            bestMate = appeal;
            this.mate = o;
          }
        }
      }
    }

    // Densité locale de congénères, ramenée à un carré de 100×100 unités.
    // Elle sert de régulation dépendante de la densité : une espèce qui
    // sature son territoire se reproduit moins, ce qui laisse de la place
    // aux autres au lieu de saturer un plafond global.
    // Le rayon de référence est plancherné : sans cela, un animal myope
    // mesurerait une densité énorme au moindre voisin et la myopie
    // deviendrait une stérilité de fait.
    const ref = r < CROWDING_REF ? CROWDING_REF : r;
    this.crowding = (flockCount / (ref * ref)) * 1e4;

    if (flockCount > 0) {
      this.flockX = fx / flockCount - this.x;
      this.flockY = fy / flockCount - this.y;
    } else {
      this.flockX = this.flockY = 0;
    }
    this.sepX = sx;
    this.sepY = sy;

    // Végétation : échantillonnage en couronnes autour de l'agent.
    // Inutile de chercher tant que le ventre est plein : on économise
    // 16 sondages de grille par réflexion.
    if (this.plantEfficiency > 0.12 && this.energy < this.maxEnergy * 0.9) {
      let best = 0.05, bx = 0, by = 0;
      let found = false;
      const here = food.densityAt(this.x, this.y);
      if (here > best) { best = here; bx = this.x; by = this.y; found = true; }
      const offset = this.id % SAMPLE_DIRS;
      for (let ring = 0; ring < SAMPLE_RINGS.length; ring++) {
        const rad = r * SAMPLE_RINGS[ring];
        const penalty = 0.14 * SAMPLE_RINGS[ring];
        for (let d = 0; d < SAMPLE_DIRS; d++) {
          const k = (d + offset) & (SAMPLE_DIRS - 1);
          const px = this.x + SAMPLE_COS[k] * rad;
          const py = this.y + SAMPLE_SIN[k] * rad;
          const idx = terrain.indexAt(px, py);
          if (terrain.biome[idx] === BIOME.DEEP_WATER) continue;
          const v = food.plants[idx] - penalty;
          if (v > best) { best = v; bx = px; by = py; found = true; }
        }
      }
      this.hasFoodTarget = found;
      this.foodX = bx;
      this.foodY = by;
    } else {
      this.hasFoodTarget = false;
    }
  }

  // ---------------------------------------------------------------- décision

  /**
   * Combine les pulsions en une direction désirée + une intensité d'effort.
   * @returns {number} throttle (0..1)
   */
  decide(env) {
    const g = this.genome;
    let dx = 0, dy = 0;
    let throttle = 0.42;
    let state = STATE.WANDER;

    // 1. Fuir : priorité absolue.
    if (this.threat) {
      const tx = this.x - this.threat.x, ty = this.y - this.threat.y;
      const d = Math.sqrt(tx * tx + ty * ty) || 1;
      const urgency = clamp01(1 - d / this.senseRadius) * (0.6 + (1 - g.aggression) * 0.8);
      const w = 3.4 * urgency;
      dx += (tx / d) * w;
      dy += (ty / d) * w;
      throttle = Math.max(throttle, 0.75 + urgency * 0.25);
      state = STATE.FLEE;
    }

    // 2. Chasser (si la faim ou l'agressivité le justifie).
    if (this.prey && (this.hunger > 0.25 || g.aggression > 0.7)) {
      const tx = this.prey.x - this.x, ty = this.prey.y - this.y;
      const d = Math.sqrt(tx * tx + ty * ty) || 1;
      const w = 2.1 * (0.4 + this.hunger) * (0.5 + g.aggression * 0.9) * (this.threat ? 0.25 : 1);
      dx += (tx / d) * w;
      dy += (ty / d) * w;
      if (!this.threat) {
        throttle = Math.max(throttle, 0.72 + this.hunger * 0.28);
        state = STATE.HUNT;
      }
    }

    // 3. Brouter.
    if (this.hasFoodTarget && this.plantEfficiency > 0.12) {
      const tx = this.foodX - this.x, ty = this.foodY - this.y;
      const d = Math.sqrt(tx * tx + ty * ty);
      if (d > 1) {
        const w = 1.9 * (0.25 + this.hunger * 1.5) * this.plantEfficiency * (this.threat ? 0.2 : 1);
        dx += (tx / d) * w;
        dy += (ty / d) * w;
        if (!this.threat && state !== STATE.HUNT) {
          throttle = Math.max(throttle, 0.5 + this.hunger * 0.4);
          state = STATE.FORAGE;
        }
      } else if (!this.threat && state === STATE.WANDER) {
        state = STATE.FORAGE;
        throttle = 0.2; // sur place : on broute
      }
    }

    // 4. Rejoindre un partenaire.
    if (this.mate && this.mate.alive && !this.threat) {
      const tx = this.mate.x - this.x, ty = this.mate.y - this.y;
      const d = Math.sqrt(tx * tx + ty * ty) || 1;
      const w = 1.7 * (1 - this.hunger * 0.6);
      dx += (tx / d) * w;
      dy += (ty / d) * w;
      if (state === STATE.WANDER || state === STATE.FORAGE) {
        state = STATE.MATE;
        throttle = Math.max(throttle, 0.6);
      }
    }

    // 4 bis. Rejoindre son chantier. Une créature qui bâtit renonce à
    // manger et à se reproduire pendant ce temps : le geste a un prix.
    if (this.buildTarget && !this.threat) {
      const tx = this.buildTarget.x - this.x, ty = this.buildTarget.y - this.y;
      const d = Math.sqrt(tx * tx + ty * ty);
      if (d > 4) {
        const w = 2.0 * g.builder * (1 - this.hunger * 0.8);
        dx += (tx / d) * w;
        dy += (ty / d) * w;
        if (state === STATE.WANDER || state === STATE.FORAGE) {
          state = STATE.BUILD;
          throttle = Math.max(throttle, 0.6);
        }
      } else {
        state = STATE.BUILD;
        throttle = 0.05;   // sur place : on travaille
      }
    }

    // 4 ter. Attachement au territoire. Un habitant qui sort des limites de
    // sa cité est rappelé vers elle : c'est ce qui fait qu'une cité se *voit*
    // comme un lieu, au lieu d'une espèce diluée sur la carte.
    if (this.settlement && !this.threat) {
      const sx = this.settlement.x - this.x, sy = this.settlement.y - this.y;
      const d = Math.sqrt(sx * sx + sy * sy);
      const r = this.settlement.radius;
      if (d > r * 0.75) {
        const w = 1.5 * clamp01((d - r * 0.75) / r);
        dx += (sx / d) * w;
        dy += (sy / d) * w;
      }
    }

    // 5. Grégarisme (cohésion douce entre congénères).
    if (g.sociability > 0.15 && (this.flockX || this.flockY)) {
      const d = Math.sqrt(this.flockX * this.flockX + this.flockY * this.flockY) || 1;
      const w = g.sociability * 0.75;
      dx += (this.flockX / d) * w;
      dy += (this.flockY / d) * w;
    }

    // 6. Séparation.
    if (this.sepX || this.sepY) {
      const d = Math.sqrt(this.sepX * this.sepX + this.sepY * this.sepY) || 1;
      dx += (this.sepX / d) * 1.25;
      dy += (this.sepY / d) * 1.25;
    }

    // 7. Errance : marche aléatoire lissée sur l'angle courant.
    this.wanderAngle += (env.rng.next() - 0.5) * 0.42;
    dx += Math.cos(this.wanderAngle) * 0.85;
    dy += Math.sin(this.wanderAngle) * 0.85;

    // 8. Repos nocturne des espèces diurnes : économie d'énergie.
    const night = env.climate.sunlight < 0.18;
    if (night && g.carnivory < 0.5 && !this.threat && this.hunger < 0.55) {
      throttle = Math.min(throttle, 0.22);
      state = STATE.REST;
    }

    // 9. Répulsion des eaux profondes et des bords du monde.
    this._avoidObstacles(env, throttle, (ax, ay, w) => {
      dx += ax * w;
      dy += ay * w;
    });

    const len = Math.hypot(dx, dy);
    if (len > 0.0001) {
      this.desiredAngle = Math.atan2(dy, dx);
    } else {
      this.desiredAngle = this.heading;
    }
    this.state = state;
    return throttle;
  }

  _avoidObstacles(env, throttle, add) {
    const { terrain } = env;
    const look = this.radius + 14 + this.speed * 0.28;
    // Trois antennes (devant, avant-gauche, avant-droite) obtenues par
    // rotation du vecteur de cap : deux appels trigonométriques au total.
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    for (let k = -1; k <= 1; k++) {
      let ax, ay;
      if (k === 0) { ax = ch; ay = sh; }
      else if (k === -1) { ax = ch * AV_COS + sh * AV_SIN; ay = sh * AV_COS - ch * AV_SIN; }
      else { ax = ch * AV_COS - sh * AV_SIN; ay = sh * AV_COS + ch * AV_SIN; }
      const b = terrain.biome[terrain.indexAt(this.x + ax * look, this.y + ay * look)];
      // Un animal doté de nageoires ne craint plus le large : l'eau profonde
      // cesse d'être un mur et devient un territoire à coloniser.
      if (b === BIOME.DEEP_WATER) { if (!this.canSwim) add(-ax, -ay, 2.6); }
      else if (b === BIOME.WATER && this.genome.fins < 0.3 && this.genome.carnivory < 0.9) add(-ax, -ay, 0.5);
    }
    const m = 26;
    if (this.x < m) add(1, 0, 2.5);
    else if (this.x > terrain.width - m) add(-1, 0, 2.5);
    if (this.y < m) add(0, 1, 2.5);
    else if (this.y > terrain.height - m) add(0, -1, 2.5);
  }

  // ------------------------------------------------------------------ update

  /**
   * Un pas de simulation.
   * @param {number} dt
   * @param {object} env {terrain, food, grid, climate, rng, tick, ecosystem}
   */
  update(dt, env) {
    const g = this.genome;
    this.age += dt;
    this.reproCooldown -= dt;
    this.attackCooldown -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);

    // Perception décalée dans le temps pour lisser la charge CPU.
    if ((env.tick + this.id) % this.thinkEvery === 0) this.sense(env);
    else if (this.threat && !this.threat.alive) this.threat = null;

    const throttle = this.decide(env);

    // --- déplacement
    const vigor = clamp(this.vigor, 0.3, 1);
    const biome = env.terrain.biome[env.terrain.indexAt(this.x, this.y)];
    const inWater = biome <= BIOME.WATER;
    // Pattes sur la terre ferme, nageoires dans l'eau : la morphologie décide
    // du milieu où l'animal est à son avantage.
    const terrainSpeed = inWater
      ? this.waterSpeedMul * (biome === BIOME.DEEP_WATER ? 0.85 : 1)
      : (env.terrain.speedFactor(this.x, this.y) || 0.35) * this.landSpeedMul;
    const energyFactor = this.energy < this.maxEnergy * 0.15 ? 0.62 : 1;
    const target = g.speed * throttle * vigor * terrainSpeed * energyFactor;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);

    const turn = this.turnRate * (this.state === STATE.FLEE ? 1.6 : 1) * dt;
    this.heading = turnToward(this.heading, this.desiredAngle, turn);

    const nx = this.x + Math.cos(this.heading) * this.speed * dt;
    const ny = this.y + Math.sin(this.heading) * this.speed * dt;
    this._moveTo(nx, ny, env.terrain);

    this.phase += this.speed * dt * 0.16 + dt * 0.8;

    // --- métabolisme
    const v = this.speed / 60;
    const cold = Math.max(0, 0.42 - env.climate.temperature) / Math.sqrt(g.size);
    // La carapace, les cornes et la crête se paient à chaque seconde de vie ;
    // le froid pèse moins sur un animal cuirassé.
    const insulation = 1 - g.armor * 0.35;
    const cost =
      g.metabolism *
      (0.5 * Math.pow(g.size, 1.55) +
        0.0013 * g.vision * Math.sqrt(g.size) +
        1.15 * v * v * Math.pow(g.size, 1.25) * this.moveEfficiency +
        cold * 0.9 * insulation +
        this.upkeep) *
      dt;
    this.energy -= cost;
    // Inertie nutritionnelle : environ trente secondes de mémoire.
    this.condition += (this.energy / this.maxEnergy - this.condition) * Math.min(1, dt / 30);

    // --- alimentation végétale
    if (this.plantEfficiency > 0.12 && this.energy < this.maxEnergy * 0.985) {
      const rate = 0.5 * Math.pow(g.size, 1.15) * this.plantEfficiency * this.forageSkill * dt;
      const gained = env.food.consume(this.x, this.y, rate);
      if (gained > 0) {
        this.energy = Math.min(this.maxEnergy, this.energy + gained * this.plantEfficiency);
        if (gained > 1.2 && env.allowEffects && env.rng.chance(0.09)) {
          env.ecosystem.emit('graze', this.x, this.y, this);
        }
      }
    }

    // --- prédation
    if (this.prey && this.prey.alive && g.carnivory > 0.28) {
      const px = this.prey.x - this.x, py = this.prey.y - this.y;
      const d2 = px * px + py * py;
      const reach = this.radius + this.prey.radius + 2;
      if (d2 < reach * reach) this._bite(this.prey, dt, env);
      else if (d2 > (this.senseRadius * 1.3) ** 2) this.prey = null;
    }

    // --- vie de colonie : grenier puis chantier
    if ((env.tick + this.id) % 6 === 0) env.ecosystem.useNest(this, dt * 6);
    if (this.isBuilder || this.sapient) this._build(dt, env);

    // --- charognage
    if (g.carnivory > 0.3 && this.energy < this.maxEnergy * 0.9) {
      env.ecosystem.tryScavenge(this, dt);
    }

    // --- fin de vie
    if (this.energy <= 0) {
      this.causeOfDeath = 'famine';
      this.alive = false;
    } else if (this.age >= this.lifespan) {
      this.causeOfDeath = 'vieillesse';
      this.alive = false;
    }
  }

  /** L'eau profonde n'arrête que ceux qui ne savent pas nager. */
  _blocked(terrain, x, y) {
    return !this.canSwim && terrain.isBlocked(x, y);
  }

  /**
   * Travail de construction : cherche un chantier quand on a de quoi, y
   * verse son énergie quand on y est. Un bâtisseur affamé abandonne.
   */
  _build(dt, env) {
    this.buildCooldown -= dt;
    const g = this.genome;

    if (this.buildTarget) {
      if (this.buildTarget.done || this.hunger > 0.6) {
        this.buildTarget = null;
        this.buildCooldown = 6;
        return;
      }
      const dx = this.buildTarget.x - this.x, dy = this.buildTarget.y - this.y;
      const reach = this.radius + 10;
      if (dx * dx + dy * dy > reach * reach) return;
      // Le chantier avance à la vitesse du gène, aux frais du bâtisseur.
      const effort = Math.min(14 * g.builder * dt, this.energy * 0.25);
      if (effort <= 0) return;
      this.energy -= effort;
      this.buildContributed += effort;
      env.ecosystem.investInBuild(this, this.buildTarget, effort);
      return;
    }

    if (this.buildCooldown > 0) return;
    this.buildCooldown = 4 + env.rng.next() * 6;
    if (!this.isAdult || this.hunger > 0.42) return;
    this.buildTarget = env.ecosystem.requestBuildSite(this);
  }

  _moveTo(nx, ny, terrain) {
    const w = terrain.width - 1, h = terrain.height - 1;
    nx = clamp(nx, 1, w);
    ny = clamp(ny, 1, h);
    if (!this._blocked(terrain, nx, ny)) {
      this.x = nx;
      this.y = ny;
      return;
    }
    // Glissement le long de l'obstacle plutôt qu'un arrêt net.
    if (!this._blocked(terrain, nx, this.y)) {
      this.x = nx;
    } else if (!this._blocked(terrain, this.x, ny)) {
      this.y = ny;
    } else {
      this.heading += Math.PI * 0.65;
      this.wanderAngle = this.heading;
      this.speed *= 0.4;
    }
  }

  _bite(prey, dt, env) {
    if (this.attackCooldown > 0) return;
    const g = this.genome;
    const power = PREDATION.bitePower * (0.5 + g.aggression) * this.biteBonus
      * Math.pow(g.size / prey.genome.size, 0.8);
    // La carapace encaisse une part des dégâts, qui est perdue pour tout le
    // monde : le prédateur peine, la proie survit.
    const dmg = Math.min(prey.energy, power * dt * prey.damageResist * (1 - prey.shelter));
    prey.energy -= dmg;
    prey.flash = 1;
    prey.threat = this;
    this.energy = Math.min(this.maxEnergy, this.energy + dmg * PREDATION.biteGain * this.meatEfficiency);
    this.flash = Math.max(this.flash, 0.6);

    // Les cornes rendent les coups : attaquer un animal armé se paie.
    if (prey.thornDamage > 0) {
      const back = prey.thornDamage * dt * this.damageResist;
      this.energy -= back;
      if (back > 0.4) this.flash = 1;
      if (this.energy <= 0) {
        this.causeOfDeath = 'prédation';
        this.alive = false;
        this.killedBy = prey.speciesId;
      }
    }

    if (env.allowEffects && env.rng.chance(0.35)) {
      env.ecosystem.emit('bite', prey.x, prey.y, prey);
    }
    if (prey.energy <= 0) {
      prey.causeOfDeath = 'prédation';
      prey.alive = false;
      prey.killedBy = this.speciesId;
      const meal = PREDATION.mealScale * Math.pow(prey.genome.size, 2) * this.meatEfficiency;
      this.energy = Math.min(this.maxEnergy, this.energy + meal);
      this.attackCooldown = 1.2;
      this.prey = null;
    }
  }

  /** Coût énergétique d'une reproduction pour ce parent. */
  breedingCost(asexual) {
    return this.maxEnergy * (asexual ? 0.5 : 0.36);
  }

  serialize() {
    return [
      this.speciesId,
      Math.round(this.x * 10) / 10,
      Math.round(this.y * 10) / 10,
      Math.round(this.heading * 100) / 100,
      Math.round(this.energy * 10) / 10,
      Math.round(this.age * 10) / 10,
      this.generation,
      Math.round(this.lifespan * 10) / 10,
      Math.round(this.reproCooldown * 10) / 10,
    ];
  }
}

export function resetCreatureIds(value = 1) {
  NEXT_ID = value;
}
