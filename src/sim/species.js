/**
 * Registre des espèces et logique de spéciation.
 *
 * Une espèce est définie par un génome « archétype ». Quand un nouveau-né
 * s'écarte trop de l'archétype de ses parents (distance génétique), il fonde
 * une espèce fille : c'est le mécanisme de spéciation par dérive.
 */
import { cloneGenome, geneticDistance, dietOf, DIET_LABEL } from './genome.js';

const GENUS = [
  'Vela', 'Cursor', 'Umbra', 'Silva', 'Petra', 'Nyx', 'Chloro', 'Rapax',
  'Zephyr', 'Lumen', 'Terra', 'Vora', 'Mira', 'Ferox', 'Gracil', 'Aqui',
  'Noct', 'Sola', 'Dryo', 'Thero', 'Pyro', 'Cryo', 'Xantho', 'Cyano',
];
const EPITHET = [
  'ptera', 'don', 'pus', 'rhinus', 'saura', 'formis', 'ceros', 'gnatha',
  'mimus', 'phaga', 'chelys', 'lopha', 'derma', 'cauda', 'thrix', 'stoma',
];

export class Species {
  constructor(id, genome, { name = null, parentId = null, bornAt = 0, hue = null } = {}) {
    this.id = id;
    this.archetype = cloneGenome(genome);
    this.hue = hue === null ? genome.hue : hue;
    this.name = name || Species.generateName(id);
    this.parentId = parentId;
    this.bornAt = bornAt;
    this.extinctAt = null;
    this.pinned = false;      // espèce créée par l'utilisateur : jamais purgée

    // Compteurs cumulés
    this.totalBorn = 0;
    this.totalDied = 0;
    this.peak = 0;
    this.generationMax = 0;

    // Statistiques rafraîchies par l'écosystème
    this.count = 0;
    this.avgAge = 0;
    this.avgEnergy = 0;
    this.avgSpeed = 0;
    this.avgSize = 0;
    this.avgVision = 0;
    this.history = [];        // population échantillonnée
  }

  static generateName(id, rng = null) {
    const pick = (arr, salt) =>
      rng ? rng.pick(arr) : arr[(id * 7 + salt * 13) % arr.length];
    return `${pick(GENUS, 1)}${pick(EPITHET, 2)}`;
  }

  get diet() {
    return dietOf(this.archetype);
  }

  get dietLabel() {
    return DIET_LABEL[this.diet];
  }

  get alive() {
    return this.count > 0;
  }

  /** Couleur d'affichage : teinte du génome, saturation liée au régime. */
  get color() {
    const c = this.archetype.carnivory;
    return { h: this.hue, s: 55 + c * 25, l: 58 - c * 8 };
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      hue: this.hue,
      parentId: this.parentId,
      bornAt: this.bornAt,
      extinctAt: this.extinctAt,
      pinned: this.pinned,
      totalBorn: this.totalBorn,
      totalDied: this.totalDied,
      peak: this.peak,
      generationMax: this.generationMax,
      archetype: this.archetype,
      history: this.history.slice(-240),
    };
  }
}

export class SpeciesRegistry {
  constructor({ speciationThreshold = 0.19, maxSpecies = 26 } = {}) {
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this.speciationThreshold = speciationThreshold;
    this.maxSpecies = maxSpecies;
  }

  get living() {
    return this.list.filter((s) => s.count > 0);
  }

  create(genome, opts = {}) {
    const sp = new Species(this.nextId++, genome, opts);
    this.list.push(sp);
    this.byId.set(sp.id, sp);
    return sp;
  }

  get(id) {
    return this.byId.get(id);
  }

  remove(id) {
    const sp = this.byId.get(id);
    if (!sp) return false;
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(sp), 1);
    return true;
  }

  /**
   * Détermine l'espèce d'un nouveau-né.
   * @returns {{species: Species, isNew: boolean}}
   */
  assign(childGenome, parentSpecies, time) {
    const d = geneticDistance(childGenome, parentSpecies.archetype);
    if (d < this.speciationThreshold) return { species: parentSpecies, isNew: false };

    // Le petit peut aussi ressembler à une espèce sœur déjà existante :
    // dans ce cas on l'y rattache plutôt que de créer un doublon.
    let best = null, bestD = Infinity;
    for (const sp of this.list) {
      if (sp.count === 0 && !sp.pinned) continue;
      const dd = geneticDistance(childGenome, sp.archetype);
      if (dd < bestD) { bestD = dd; best = sp; }
    }
    if (best && bestD < this.speciationThreshold) return { species: best, isNew: false };

    if (this.livingCount() >= this.maxSpecies) {
      return { species: parentSpecies, isNew: false };
    }

    const hue = (parentSpecies.hue + 28 + (childGenome.hue - parentSpecies.archetype.hue) * 0.5) % 360;
    const sp = this.create(childGenome, {
      parentId: parentSpecies.id,
      bornAt: time,
      hue: (hue + 360) % 360,
    });
    sp.generationMax = parentSpecies.generationMax;
    return { species: sp, isNew: true };
  }

  livingCount() {
    let n = 0;
    for (const s of this.list) if (s.count > 0) n++;
    return n;
  }

  /** Retire les espèces éteintes et sans descendance pour borner la mémoire. */
  prune(time, keepExtinctFor = 400) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.count > 0) { s.extinctAt = null; continue; }
      if (s.pinned) continue;
      if (s.extinctAt === null) { s.extinctAt = time; continue; }
      if (time - s.extinctAt > keepExtinctFor && this.list.length > 6) {
        this.byId.delete(s.id);
        this.list.splice(i, 1);
      }
    }
  }
}
