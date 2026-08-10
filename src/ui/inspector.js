/**
 * Fiche détaillée de la créature sélectionnée : portrait animé, jauges
 * vitales, génome comparé à l'échelle de l'espèce et état comportemental.
 */
import { TRAITS } from '../sim/genome.js';
import { STATE_LABEL } from '../sim/creature.js';
import { drawPortrait } from '../render/portrait.js';
import { clamp01 } from '../core/utils.js';

const SHOWN = ['speed', 'vision', 'size', 'metabolism', 'fertility', 'carnivory'];

export class Inspector {
  constructor(deps) {
    this.deps = deps;
    this.root = document.querySelector('#inspector');
    this.portrait = document.querySelector('#inspectorPortrait');
    this.pctx = this.portrait.getContext('2d');
    this.nameEl = document.querySelector('#inspName');
    this.metaEl = document.querySelector('#inspMeta');
    this.stateEl = document.querySelector('#inspState');
    this.energyEl = document.querySelector('#gaugeEnergy');
    this.ageEl = document.querySelector('#gaugeAge');
    this.traitHost = document.querySelector('#inspTraits');
    this.target = null;
    this._acc = 0;

    this.traits = {};
    const frag = document.createDocumentFragment();
    for (const key of SHOWN) {
      const t = TRAITS.find((x) => x.key === key);
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${t.icon} ${t.label}</span><div class="bar"><i style="--c:#8fd0ff"></i></div><b>0</b>`;
      frag.appendChild(row);
      this.traits[key] = { fill: row.querySelector('i'), value: row.querySelector('b'), trait: t };
    }
    this.traitHost.appendChild(frag);

    document.querySelector('#btnCloseInspector').addEventListener('click', () => this.deps.select(null));
    document.querySelector('#btnFollow').addEventListener('click', () => this.deps.toggleFollow());
  }

  setTarget(creature) {
    this.target = creature;
    this.root.classList.toggle('hidden', !creature);
    if (creature) this._refresh(true);
  }

  update(dt, time) {
    if (!this.target) return;
    if (!this.target.alive) {
      // La créature vient de mourir : on referme la fiche en douceur.
      this.deps.select(null);
      return;
    }
    this._drawPortrait(time);
    this._acc += dt;
    if (this._acc < 0.15) return;
    this._acc = 0;
    this._refresh(false);
  }

  _drawPortrait(time) {
    const c = this.target;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.portrait.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.portrait.width !== w || this.portrait.height !== h) {
      this.portrait.width = w;
      this.portrait.height = h;
    }
    this.pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPortrait(this.pctx, c.genome, time, {
      width: rect.width,
      height: rect.height,
      energy: c.energy / c.maxEnergy,
      showAura: false,
    });
  }

  _refresh(full) {
    const c = this.target;
    const eco = this.deps.getEco();
    const sp = eco.species.get(c.speciesId);

    this.nameEl.textContent = sp ? sp.name : 'Inconnu';
    const ageRatio = clamp01(c.age / c.lifespan);
    const stage = c.age < c.maturity ? 'juvénile' : ageRatio > 0.75 ? 'sénescent' : 'adulte';
    this.metaEl.textContent =
      `${sp ? sp.dietLabel : '—'} · ${stage} · génération ${c.generation} · #${c.id}`;

    this.energyEl.style.width = `${(c.energy / c.maxEnergy) * 100}%`;
    this.energyEl.style.setProperty('--c',
      c.energy / c.maxEnergy > 0.4 ? '#7ef0a0' : c.energy / c.maxEnergy > 0.2 ? '#ffd06e' : '#ef6461');
    this.ageEl.style.width = `${ageRatio * 100}%`;

    for (const key of SHOWN) {
      const { fill, value, trait } = this.traits[key];
      const v = c.genome[key];
      fill.style.width = `${clamp01((v - trait.min) / (trait.max - trait.min)) * 100}%`;
      value.textContent = trait.max <= 3 ? v.toFixed(2) : Math.round(v);
    }

    const target = c.state === 2 && c.prey ? ' → proie repérée'
      : c.state === 3 && c.threat ? ' → prédateur détecté'
      : c.state === 4 && c.mate ? ' → partenaire trouvé' : '';
    this.stateEl.textContent =
      `${STATE_LABEL[c.state]}${target} · ${Math.round(c.speed)} u/s · ${Math.round(c.age)} / ${Math.round(c.lifespan)} s`;
  }
}
