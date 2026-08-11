/**
 * Tableau de bord : bandeau supérieur (temps, saison, météo) et panneau
 * de statistiques (compteurs, graphiques, moyennes génétiques).
 * Rafraîchi ~5 fois par seconde pour ne pas peser sur la boucle de rendu.
 */
import { formatNumber, formatSimTime, clamp01 } from '../core/utils.js';
import { TRAITS } from '../sim/genome.js';
import { drawStacked, drawArea } from './charts.js';

const SHOWN_TRAITS = ['speed', 'vision', 'size', 'metabolism', 'fertility', 'lifespan'];
const MORPHO_SHOWN = ['elongation', 'limbs', 'armor', 'horns', 'fins', 'crest', 'pattern'];

export class Hud {
  constructor(root = document) {
    this.el = {
      time: root.querySelector('#chipTime .chip-value'),
      season: root.querySelector('#chipSeason'),
      seasonIcon: root.querySelector('#chipSeason .chip-icon'),
      seasonValue: root.querySelector('#chipSeason .chip-value'),
      weather: root.querySelector('#chipWeather'),
      weatherIcon: root.querySelector('#chipWeather .chip-icon'),
      weatherValue: root.querySelector('#chipWeather .chip-value'),
      temp: root.querySelector('#chipTemp .chip-value'),
      light: root.querySelector('#chipLight .chip-value'),

      perf: root.querySelector('#perf'),
      fps: root.querySelector('#perf .perf-fps'),
      speed: root.querySelector('#perf .perf-speed'),

      population: root.querySelector('#statPopulation .stat-value'),
      populationTrend: root.querySelector('#statPopulation .stat-trend'),
      species: root.querySelector('#statSpecies .stat-value'),
      speciesTrend: root.querySelector('#statSpecies .stat-trend'),
      age: root.querySelector('#statAge .stat-value'),
      biomass: root.querySelector('#statBiomass .stat-value'),

      chartPopulation: root.querySelector('#chartPopulation'),
      chartBiomass: root.querySelector('#chartBiomass'),
      dietBars: root.querySelectorAll('#dietBars .bar-row'),
      traitBars: root.querySelector('#traitBars'),
      morphoBars: root.querySelector('#morphoBars'),
      dynamics: root.querySelector('#dynamicsList'),
      civ: root.querySelector('#civList'),
    };

    this._buildTraitBars();
    this._acc = 0;
    this._lastSeason = -1;
    this._lastWeather = '';
    this._lastPop = 0;
    this._lastSpecies = 0;
    this.dyn = {};
    for (const b of this.el.dynamics.querySelectorAll('b')) {
      this.dyn[b.dataset.k] = b;
    }
    this.civ = {};
    for (const b of this.el.civ.querySelectorAll('b')) {
      this.civ[b.dataset.k] = b;
    }
  }

  _buildTraitBars() {
    this.traitEls = {};
    this._fillBars(this.el.traitBars, SHOWN_TRAITS, '#8fd0ff');
    this._fillBars(this.el.morphoBars, MORPHO_SHOWN, '#c9a6ff');
  }

  _fillBars(host, keys, color) {
    const frag = document.createDocumentFragment();
    for (const key of keys) {
      const t = TRAITS.find((x) => x.key === key);
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${t.icon} ${t.label}</span><div class="bar"><i style="--c:${color}"></i></div><b>0</b>`;
      frag.appendChild(row);
      this.traitEls[key] = { fill: row.querySelector('i'), value: row.querySelector('b'), trait: t };
    }
    host.appendChild(frag);
  }

  /**
   * @param {import('../sim/ecosystem.js').Ecosystem} eco
   * @param {{fps:number, speed:number, effective:number, paused:boolean}} perf
   * @param {number} dt temps réel
   */
  update(eco, perf, dt) {
    // Le bandeau réagit immédiatement, le reste est limité à ~5 Hz.
    this._updateTopbar(eco, perf);
    this._acc += dt;
    if (this._acc < 0.2) return;
    this._acc = 0;
    this._updateStats(eco);
    this._updateCharts(eco);
  }

  _updateTopbar(eco, perf) {
    const c = eco.climate;
    this.el.time.textContent = formatSimTime(c.time, c.dayLength);

    if (c.seasonIndex !== this._lastSeason) {
      this._lastSeason = c.seasonIndex;
      this.el.seasonIcon.textContent = c.season.icon;
      this.el.seasonValue.textContent = c.season.name;
      this.el.season.classList.remove('flash');
      void this.el.season.offsetWidth; // relance l'animation
      this.el.season.classList.add('flash');
    }

    const w = c.weatherBlend < 0.5 ? c.nextWeather : c.weather;
    if (w.key !== this._lastWeather) {
      this._lastWeather = w.key;
      this.el.weatherIcon.textContent = w.icon;
      this.el.weatherValue.textContent = w.name;
      this.el.weather.classList.remove('flash');
      void this.el.weather.offsetWidth;
      this.el.weather.classList.add('flash');
    }

    // Température affichée en degrés « plausibles » : -10 °C à +34 °C.
    const deg = Math.round(-10 + c.temperature * 44);
    this.el.temp.textContent = `${deg} °C`;
    const light = Math.round(c.lightLevel * 100);
    this.el.light.textContent = `${light} %`;

    this.el.fps.textContent = Math.round(perf.fps);
    this.el.perf.classList.toggle('warn', perf.fps < 45);
    this.el.speed.textContent = perf.paused
      ? 'pause'
      : perf.effective < perf.speed * 0.75
        ? `×${formatNumber(perf.effective)}⚠`
        : `×${formatNumber(perf.speed)}`;
    this.el.speed.title = perf.effective < perf.speed * 0.75
      ? `Vitesse demandée ×${Math.round(perf.speed)}, atteinte ×${Math.round(perf.effective)} (limite de calcul)`
      : '';
  }

  _updateStats(eco) {
    const s = eco.stats;

    this.el.population.textContent = s.population;
    this._trend(this.el.populationTrend, s.population - this._lastPop, 'ind.');
    this._lastPop = s.population;

    this.el.species.textContent = s.speciesCount;
    this._trend(this.el.speciesTrend, s.speciesCount - this._lastSpecies, '');
    this._lastSpecies = s.speciesCount;

    this.el.age.textContent = s.avgAge.toFixed(1);
    this.el.biomass.textContent = formatNumber(s.biomass);

    const total = Math.max(1, s.population);
    const diets = [s.herbivores, s.omnivores, s.carnivores];
    this.el.dietBars.forEach((row, i) => {
      row.querySelector('i').style.width = `${(diets[i] / total) * 100}%`;
      row.querySelector('b').textContent = diets[i];
    });

    for (const key of [...SHOWN_TRAITS, ...MORPHO_SHOWN]) {
      const { fill, value, trait } = this.traitEls[key];
      const avg = this._avgTrait(eco, key);
      const ratio = clamp01((avg - trait.min) / (trait.max - trait.min));
      fill.style.width = `${ratio * 100}%`;
      value.textContent = trait.max <= 4.01 ? avg.toFixed(2) : Math.round(avg);
    }

    const civ = this.civ;
    civ.builders.textContent = s.builders;
    civ.swimmers.textContent = s.swimmers;
    civ.nests.textContent = s.nests;
    civ.fields.textContent = s.fields;
    civ.dikes.textContent = s.dikes;
    civ.sites.textContent = s.sites;
    civ.transformed.textContent = `${(s.transformed * 100).toFixed(1)} %`;
    let store = 0;
    for (const n of eco.structures.nests) store += n.store;
    civ.store.textContent = formatNumber(store);

    const d = this.dyn;
    d.births.textContent = Math.round(s.birthsPerMin);
    d.deaths.textContent = Math.round(s.deathsPerMin);
    d.generation.textContent = s.generationMax;
    d.oldest.textContent = `${Math.round(s.oldest)} s`;
    d.famine.textContent = formatNumber(eco.deathCauses.famine || 0);
    d.predation.textContent = formatNumber(eco.deathCauses['prédation'] || 0);
    d.old.textContent = formatNumber(eco.deathCauses.vieillesse || 0);
    d.corpses.textContent = s.corpses;
  }

  _avgTrait(eco, key) {
    const creatures = eco.creatures;
    if (!creatures.length) return 0;
    let sum = 0;
    for (let i = 0; i < creatures.length; i++) sum += creatures[i].genome[key];
    return sum / creatures.length;
  }

  _trend(el, delta, unit) {
    if (!el) return;
    el.classList.remove('up', 'down');
    if (delta > 0) {
      el.textContent = `▲ ${delta} ${unit}`.trim();
      el.classList.add('up');
    } else if (delta < 0) {
      el.textContent = `▼ ${-delta} ${unit}`.trim();
      el.classList.add('down');
    } else {
      el.textContent = unit || '—';
    }
  }

  _updateCharts(eco) {
    const h = eco.history;
    drawStacked(this.el.chartPopulation, [
      { data: h.herbivores, color: '#7ef0a0', fill: 'rgba(126,240,160,0.35)' },
      { data: h.carnivores, color: '#ff8f6b', fill: 'rgba(255,143,107,0.35)' },
    ], { totalColor: 'rgba(143,208,255,0.65)' });
    drawArea(this.el.chartBiomass, h.biomass, '#9be36a', 'rgba(155,227,106,0.3)');
  }
}
