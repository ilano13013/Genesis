/**
 * Panneau des espèces : liste vivante (population, régime, courbe) et
 * éditeur de création d'espèce avec aperçu animé du génome.
 */
import { TRAITS, makeGenome, randomGenome, dietOf, DIET_LABEL } from '../sim/genome.js';
import { drawSparkline } from './charts.js';
import { drawPortrait } from '../render/portrait.js';
import { toast } from './toast.js';
import { Rng } from '../core/rng.js';

const EDITABLE = ['speed', 'vision', 'size', 'metabolism', 'fertility', 'lifespan', 'carnivory', 'aggression', 'sociability'];

const DIET_PRESETS = {
  herbivore: { carnivory: 0.05, aggression: 0.12, speed: 62, size: 1.0, vision: 130, hue: 120 },
  omnivore: { carnivory: 0.45, aggression: 0.45, speed: 72, size: 1.15, vision: 150, hue: 42 },
  carnivore: { carnivory: 0.88, aggression: 0.8, speed: 92, size: 1.5, vision: 190, hue: 8 },
};

export class SpeciesPanel {
  /**
   * @param {object} deps {getEco, focusSpecies, onChanged}
   */
  constructor(deps) {
    this.deps = deps;
    this.listEl = document.querySelector('#speciesList');
    this.countEl = document.querySelector('#speciesCount');
    this.hintEl = document.querySelector('#extinctHint');
    this.cards = new Map();
    this.selectedId = null;
    this._acc = 0;

    this.rng = new Rng(Date.now() & 0xffff);
    this._initEditor();

    document.querySelector('#btnAddSpecies').addEventListener('click', () => this.openEditor());
  }

  // ------------------------------------------------------------------ liste

  update(eco, dt) {
    this._acc += dt;
    if (this._acc < 0.35) return;
    this._acc = 0;

    const list = eco.species.list
      .filter((s) => s.count > 0 || s.pinned)
      .sort((a, b) => b.count - a.count);

    const seen = new Set();
    let extinct = 0;
    for (const sp of list) {
      seen.add(sp.id);
      let card = this.cards.get(sp.id);
      if (!card) {
        card = this._createCard(sp);
        this.cards.set(sp.id, card);
        this.listEl.appendChild(card.root);
      }
      this._refreshCard(card, sp);
      if (sp.count === 0) extinct++;
    }

    for (const [id, card] of this.cards) {
      if (!seen.has(id)) {
        card.root.remove();
        this.cards.delete(id);
      }
    }

    // Ordre d'affichage aligné sur le tri par population.
    list.forEach((sp, i) => {
      const card = this.cards.get(sp.id);
      if (card && this.listEl.children[i] !== card.root) {
        this.listEl.insertBefore(card.root, this.listEl.children[i] || null);
      }
    });

    this.countEl.textContent = eco.stats.speciesCount;
    this.hintEl.textContent = extinct
      ? `${extinct} espèce(s) introduite(s) actuellement éteinte(s) — elles restent listées pour pouvoir être réintroduites.`
      : 'Cliquez sur une espèce pour la localiser dans le monde.';
  }

  _createCard(sp) {
    const root = document.createElement('div');
    root.className = 'species-card';
    root.innerHTML = `
      <div class="sc-top">
        <i class="sc-swatch"></i>
        <span class="sc-name"></span>
        <span class="sc-count">0</span>
      </div>
      <div class="sc-meta">
        <span class="sc-tag"></span>
        <span class="sc-gen"></span>
        <span class="sc-peak"></span>
      </div>
      <canvas class="sc-spark" height="22"></canvas>
      <div class="sc-actions">
        <button class="loc" title="Centrer la caméra sur cette espèce">📍 Localiser</button>
        <button class="add" title="Ajouter 15 individus">＋15</button>
        <button class="rm" title="Retirer l'espèce du monde">✕</button>
      </div>`;

    const card = {
      root,
      swatch: root.querySelector('.sc-swatch'),
      name: root.querySelector('.sc-name'),
      count: root.querySelector('.sc-count'),
      tag: root.querySelector('.sc-tag'),
      gen: root.querySelector('.sc-gen'),
      peak: root.querySelector('.sc-peak'),
      spark: root.querySelector('.sc-spark'),
      id: sp.id,
      lastCount: -1,
    };

    root.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.selectedId = this.selectedId === sp.id ? null : sp.id;
      this.deps.focusSpecies(this.selectedId);
      for (const [, c] of this.cards) c.root.classList.toggle('selected', c.id === this.selectedId);
    });
    root.querySelector('.loc').addEventListener('click', () => this.deps.focusSpecies(sp.id));
    root.querySelector('.add').addEventListener('click', () => {
      const eco = this.deps.getEco();
      const species = eco.species.get(sp.id);
      if (!species) return;
      eco.spawnMembers(species, 15);
      eco.sampleStats(true);
      toast(`15 ${species.name} introduits`, 'species');
    });
    root.querySelector('.rm').addEventListener('click', () => {
      const eco = this.deps.getEco();
      const species = eco.species.get(sp.id);
      if (!species) return;
      eco.removeSpecies(sp.id);
      eco.sampleStats(true);
      toast(`${species.name} retirée du monde`, 'warn');
      this.deps.onChanged?.();
    });

    return card;
  }

  _refreshCard(card, sp) {
    const color = sp.color;
    const css = `hsl(${Math.round(color.h)} ${Math.round(color.s)}% ${Math.round(color.l)}%)`;
    card.root.style.setProperty('--sp-color', css);
    card.name.textContent = sp.name;
    card.count.textContent = sp.count;
    card.root.classList.toggle('extinct', sp.count === 0);

    const diet = sp.diet;
    card.tag.textContent = DIET_LABEL[diet];
    card.tag.className = `sc-tag ${diet}`;
    card.gen.textContent = `gén. ${sp.generationMax}`;
    card.peak.textContent = `pic ${sp.peak}`;

    if (card.lastCount !== sp.count || sp.history.length % 4 === 0) {
      drawSparkline(card.spark, sp.history.slice(-90), css);
      card.lastCount = sp.count;
    }
  }

  // ---------------------------------------------------------------- éditeur

  _initEditor() {
    this.modal = document.querySelector('#modalSpecies');
    this.preview = document.querySelector('#speciesPreview');
    this.previewCtx = this.preview.getContext('2d');
    this.nameInput = document.querySelector('#fieldName');
    this.countInput = document.querySelector('#fieldCount');
    this.countOut = document.querySelector('#outCount');
    this.hueInput = document.querySelector('#fieldHue');
    this.hueOut = document.querySelector('#outHue');
    this.traitHost = document.querySelector('#traitEditor');

    this.draft = makeGenome(DIET_PRESETS.herbivore);
    this.sliders = {};

    const frag = document.createDocumentFragment();
    for (const key of EDITABLE) {
      const t = TRAITS.find((x) => x.key === key);
      const row = document.createElement('div');
      row.className = 'trait-row';
      row.innerHTML = `
        <span>${t.icon} ${t.label}</span>
        <input type="range" min="0" max="1000" value="500" data-trait="${key}">
        <output></output>`;
      const input = row.querySelector('input');
      const out = row.querySelector('output');
      input.addEventListener('input', () => {
        const v = t.min + (input.value / 1000) * (t.max - t.min);
        this.draft[key] = v;
        this._syncOutputs();
      });
      this.sliders[key] = { input, out, trait: t };
      frag.appendChild(row);
    }
    this.traitHost.appendChild(frag);

    this.countInput.addEventListener('input', () => {
      this.countOut.textContent = this.countInput.value;
    });
    this.hueInput.addEventListener('input', () => {
      this.draft.hue = Number(this.hueInput.value);
      this._syncOutputs();
    });

    for (const btn of document.querySelectorAll('#dietPresets button')) {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dietPresets button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.draft = makeGenome({ ...this.draft, ...DIET_PRESETS[btn.dataset.diet] });
        this._syncSliders();
      });
    }

    document.querySelector('#btnRandomSpecies').addEventListener('click', () => {
      this.draft = randomGenome(this.rng);
      this._syncSliders();
      this._syncDietButtons();
    });

    document.querySelector('#btnCreateSpecies').addEventListener('click', () => this._create());
  }

  openEditor() {
    this._syncSliders();
    this.nameInput.value = '';
    this.deps.openModal('modalSpecies');
  }

  _syncSliders() {
    for (const key of EDITABLE) {
      const { input, trait } = this.sliders[key];
      input.value = Math.round(((this.draft[key] - trait.min) / (trait.max - trait.min)) * 1000);
    }
    this.hueInput.value = Math.round(this.draft.hue);
    this._syncOutputs();
    this._syncDietButtons();
  }

  _syncDietButtons() {
    const diet = dietOf(this.draft);
    document.querySelectorAll('#dietPresets button').forEach((b) => {
      b.classList.toggle('active', b.dataset.diet === diet);
    });
  }

  _syncOutputs() {
    for (const key of EDITABLE) {
      const { out, trait } = this.sliders[key];
      const v = this.draft[key];
      out.textContent = trait.max <= 3
        ? v.toFixed(2)
        : `${Math.round(v)}${trait.unit === 's' ? ' s' : ''}`;
    }
    this.hueOut.textContent = `${Math.round(this.draft.hue)}°`;
    this.countOut.textContent = this.countInput.value;
  }

  /** Animation de l'aperçu (appelée par la boucle principale). */
  renderPreview(time) {
    if (this.modal.classList.contains('hidden')) return;
    const c = this.preview;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPortrait(this.previewCtx, this.draft, time, { width: rect.width, height: rect.height });
  }

  _create() {
    const eco = this.deps.getEco();
    const count = Number(this.countInput.value);
    const name = this.nameInput.value.trim();
    const sp = eco.addSpecies({
      count,
      genome: this.draft,
      name: name || null,
      hue: this.draft.hue,
    });
    eco.sampleStats(true);
    toast(`${sp.name} — ${count} individus introduits`, 'species');
    this.deps.closeModal();
    this.deps.onChanged?.();
  }
}
