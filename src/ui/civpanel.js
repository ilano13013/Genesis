/**
 * Panneaux « Peuples » et « Chronique ».
 *
 * La chronique est la seule narration du projet : elle n'invente rien, elle
 * restitue les événements que la simulation a produits. C'est ce qui permet
 * de lire après coup l'histoire d'une partie — et de constater que deux
 * graines n'en racontent jamais la même.
 */
import { CHRONICLE_KINDS } from '../sim/chronicle.js';
import { ERAS, TECH_MAP } from '../sim/tech.js';

const KIND_COLORS = {
  sapience: '#9b8cff', founding: '#7ef0d0', tech: '#8fd0ff', era: '#ffd06e',
  trade: '#e0a458', growth: '#7ef0a0', famine: '#c9a227', raid: '#ef6461',
  collapse: '#94a3b8', schism: '#c58cff', extinction: '#64748b', nature: '#68c98a',
};

export class CivPanel {
  constructor(deps) {
    this.deps = deps;
    this.tabs = [...document.querySelectorAll('.tab')];
    this.panels = new Map();
    for (const t of this.tabs) {
      this.panels.set(t.dataset.tab, document.querySelector(`#${t.dataset.tab}`));
      t.addEventListener('click', () => this.select(t.dataset.tab));
    }
    this.active = 'tabSpecies';

    this.el = {
      peopleCount: document.querySelector('#peopleCount'),
      settlements: document.querySelector('#civSettlements'),
      population: document.querySelector('#civPopulation'),
      techs: document.querySelector('#civTechs'),
      ruins: document.querySelector('#civRuins'),
      era: document.querySelector('#civEra'),
      peopleList: document.querySelector('#peopleList'),
      chronicle: document.querySelector('#chronicleList'),
      filters: document.querySelector('#chronicleFilters'),
    };

    this.hidden = new Set();
    this._buildFilters();
    this._acc = 0;
    this._lastEntry = 0;
  }

  select(id) {
    this.active = id;
    for (const t of this.tabs) t.classList.toggle('active', t.dataset.tab === id);
    for (const [key, panel] of this.panels) panel.classList.toggle('hidden', key !== id);
    // Un onglet qu'on vient d'ouvrir doit être à jour immédiatement.
    this._acc = 99;
  }

  _buildFilters() {
    for (const [key, info] of Object.entries(CHRONICLE_KINDS)) {
      const b = document.createElement('button');
      b.textContent = `${info.icon} ${info.label}`;
      b.title = `Afficher ou masquer : ${info.label}`;
      b.addEventListener('click', () => {
        if (this.hidden.has(key)) this.hidden.delete(key);
        else this.hidden.add(key);
        b.classList.toggle('off', this.hidden.has(key));
        this._lastEntry = -1;
        this._renderChronicle(this.deps.getEco());
      });
      this.el.filters.appendChild(b);
    }
  }

  update(eco, dt) {
    this._acc += dt;
    if (this._acc < 0.6) return;
    this._acc = 0;

    const c = eco.civ.stats;
    this.el.peopleCount.textContent = c.peoples;
    if (this.active === 'tabCiv') this._renderPeoples(eco, c);
    else if (this.active === 'tabChronicle') this._renderChronicle(eco);
  }

  _renderPeoples(eco, c) {
    this.el.settlements.textContent = c.settlements;
    this.el.population.textContent = c.population;
    this.el.techs.textContent = c.techs;
    this.el.ruins.textContent = c.ruins;

    const peoples = eco.peoples.list;
    if (!peoples.length) {
      this.el.era.textContent = 'Aucune conscience n\'a encore émergé.';
    } else {
      const era = ERAS[c.era];
      this.el.era.textContent = c.settlements
        ? `${era.name} — ${c.peoples} peuple(s) vivant(s), ${c.routes} route(s) commerciale(s).`
        : 'Les peuples n\'ont plus de cité debout.';
    }

    const frag = document.createDocumentFragment();
    for (const p of [...peoples].reverse()) {
      const alive = p.endedAt === null;
      const cities = p.settlements.filter((s) => !s.abandoned);
      const card = document.createElement('div');
      card.className = `people-card${alive ? '' : ' gone'}`;
      card.style.setProperty('--sp-color', `hsl(${Math.round(p.hue)} 62% 62%)`);

      const pop = cities.reduce((a, s) => a + s.population, 0);
      const era = cities.length ? Math.max(...cities.map((s) => s.era)) : 0;
      const techs = [...p.knownTechs].slice(-6);

      card.innerHTML = `
        <div class="pc-top">
          <span class="pc-name"></span>
          <span class="pc-era"></span>
        </div>
        <div class="pc-meta"></div>
        <div class="pc-cities"></div>
        <div class="pc-techs"></div>`;
      card.querySelector('.pc-name').textContent = p.name;
      card.querySelector('.pc-era').textContent = alive ? ERAS[era].name : 'disparu';
      card.querySelector('.pc-meta').textContent =
        `${p.characterLabel} · ${pop} citadins · ${cities.length} cité(s) · apogée ${p.peakPopulation} · ${p.knownTechs.size} savoirs`;

      const cityBox = card.querySelector('.pc-cities');
      for (const s of p.settlements.slice(-8)) {
        const chip = document.createElement('button');
        chip.className = `pc-city${s.abandoned ? ' ruin' : ''}`;
        chip.textContent = `${s.name} · ${s.abandoned ? 'ruines' : s.population}`;
        chip.addEventListener('click', () => this.deps.focusPoint(s.x, s.y));
        cityBox.appendChild(chip);
      }

      const techBox = card.querySelector('.pc-techs');
      for (const id of techs) {
        const t = TECH_MAP.get(id);
        if (!t) continue;
        const chip = document.createElement('span');
        chip.className = 'pc-tech';
        chip.textContent = t.name;
        techBox.appendChild(chip);
      }
      frag.appendChild(card);
    }
    this.el.peopleList.replaceChildren(frag);
  }

  _renderChronicle(eco) {
    const entries = eco.chronicle.entries;
    const last = entries.length ? entries[entries.length - 1].id : 0;
    if (last === this._lastEntry) return;
    this._lastEntry = last;

    const kinds = this.hidden.size
      ? new Set(Object.keys(CHRONICLE_KINDS).filter((k) => !this.hidden.has(k)))
      : null;
    const list = eco.chronicle.latest(70, kinds);

    if (!list.length) {
      this.el.chronicle.innerHTML =
        '<p class="hint">Rien n\'est encore arrivé qui mérite d\'être écrit.</p>';
      return;
    }

    const dayLength = eco.climate.dayLength;
    const frag = document.createDocumentFragment();
    for (const e of list) {
      const info = CHRONICLE_KINDS[e.kind] || CHRONICLE_KINDS.nature;
      const el = document.createElement('div');
      el.className = 'chron-entry';
      el.style.setProperty('--c', KIND_COLORS[e.kind] || '#64748b');
      el.innerHTML = '<span class="chron-icon"></span><span class="chron-text"></span>';
      el.querySelector('.chron-icon').textContent = info.icon;
      const text = el.querySelector('.chron-text');
      text.textContent = e.text;
      const time = document.createElement('span');
      time.className = 'chron-time';
      time.textContent = `Jour ${Math.floor(e.time / dayLength)}`;
      text.appendChild(time);
      if (e.x !== null) {
        el.title = 'Aller voir sur la carte';
        el.addEventListener('click', () => this.deps.focusPoint(e.x, e.y));
      } else {
        el.style.cursor = 'default';
      }
      frag.appendChild(el);
    }
    this.el.chronicle.replaceChildren(frag);
  }
}
