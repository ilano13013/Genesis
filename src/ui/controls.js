/**
 * Contrôles : dock (lecture, vitesse, sauvegardes), fenêtres modales,
 * raccourcis clavier et interactions souris/tactiles sur la vue.
 */
import { clamp } from '../core/utils.js';
import { toast } from './toast.js';
import {
  saveToSlot, loadFromSlot, deleteSlot, listSlots, SLOT_COUNT,
  exportToFile, importFromFile, prefs,
} from '../persistence/save.js';

const SPEED_MIN = 1;
const SPEED_MAX = 1000;

/** Curseur logarithmique : la moitié de la course couvre ×1 → ×32. */
const sliderToSpeed = (v) => Math.round(Math.pow(SPEED_MAX, v / 1000) * 100) / 100;
const speedToSlider = (s) => Math.round((Math.log(clamp(s, SPEED_MIN, SPEED_MAX)) / Math.log(SPEED_MAX)) * 1000);

export class Controls {
  constructor(app) {
    this.app = app;
    this.canvas = app.canvas;
    this.openModalId = null;

    this._bindDock();
    this._bindModals();
    this._bindSettings();
    this._bindSaves();
    this._bindNewWorld();
    this._bindPointer();
    this._bindKeyboard();
  }

  // ------------------------------------------------------------------- dock

  _bindDock() {
    this.btnPlay = document.querySelector('#btnPlay');
    this.speedRange = document.querySelector('#speedRange');
    this.speedOut = document.querySelector('#speedOut');
    this.presets = [...document.querySelectorAll('#speedPresets button')];

    this.btnPlay.addEventListener('click', () => this.app.setPaused(!this.app.paused));
    document.querySelector('#btnStep').addEventListener('click', () => this.app.stepOnce());

    this.speedRange.addEventListener('input', () => {
      this.app.setSpeed(sliderToSpeed(Number(this.speedRange.value)));
    });
    for (const b of this.presets) {
      b.addEventListener('click', () => this.app.setSpeed(Number(b.dataset.speed)));
    }

    document.querySelector('#btnSave').addEventListener('click', () => this.openModal('modalSaves'));
    document.querySelector('#btnLoad').addEventListener('click', () => this.openModal('modalSaves'));
    document.querySelector('#btnNewWorld').addEventListener('click', () => this.openModal('modalNewWorld'));
    document.querySelector('#btnSettings').addEventListener('click', () => this.openModal('modalSettings'));
    document.querySelector('#btnHelp').addEventListener('click', () => this.openModal('modalHelp'));
    document.querySelector('#btnTogglePanels').addEventListener('click', () => this.togglePanels());

    for (const btn of document.querySelectorAll('[data-collapse]')) {
      btn.addEventListener('click', () => {
        const panel = document.querySelector(`#${btn.dataset.collapse}`);
        const collapsed = panel.classList.toggle('collapsed');
        btn.textContent = collapsed ? '+' : '−';
      });
    }
  }

  /** Reflète l'état de la simulation dans le dock. */
  syncPlayback() {
    this.btnPlay.textContent = this.app.paused ? '▶' : '⏸';
    this.btnPlay.classList.toggle('active', !this.app.paused);
    const s = this.app.speed;
    this.speedRange.value = speedToSlider(s);
    this.speedOut.textContent = `×${s >= 10 ? Math.round(s) : s.toFixed(1)}`;
    for (const b of this.presets) {
      b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - s) < 0.01);
    }
  }

  // ----------------------------------------------------------------- modales

  _bindModals() {
    this.backdrop = document.querySelector('#modalBackdrop');
    this.backdrop.addEventListener('click', () => this.closeModal());
    for (const btn of document.querySelectorAll('[data-close-modal]')) {
      btn.addEventListener('click', () => this.closeModal());
    }
  }

  openModal(id) {
    this.closeModal();
    const el = document.querySelector(`#${id}`);
    if (!el) return;
    el.classList.remove('hidden');
    this.backdrop.classList.remove('hidden');
    this.openModalId = id;
    if (id === 'modalSaves') this.renderSlots();
  }

  closeModal() {
    if (this.openModalId) {
      document.querySelector(`#${this.openModalId}`)?.classList.add('hidden');
      this.openModalId = null;
    }
    this.backdrop.classList.add('hidden');
  }

  /**
   * Sur grand écran : masque ou révèle les deux panneaux.
   * Sur écran étroit : fait défiler statistiques → espèces → vue dégagée,
   * les panneaux se recouvriraient sinon.
   */
  togglePanels() {
    const body = document.body;
    if (window.matchMedia('(max-width: 900px)').matches) {
      const stats = body.classList.contains('show-stats');
      const species = body.classList.contains('show-species');
      body.classList.remove('show-stats', 'show-species');
      if (!stats && !species) body.classList.add('show-stats');
      else if (stats) body.classList.add('show-species');
      this.app.updateInsets();
      return;
    }
    body.classList.toggle('panels-hidden');
    this.app.updateInsets();
    this.app.savePrefs();
  }

  // ---------------------------------------------------------------- réglages

  _bindSettings() {
    const app = this.app;
    const bindRange = (id, outId, format, apply) => {
      const input = document.querySelector(`#${id}`);
      const out = document.querySelector(`#${outId}`);
      const handler = () => {
        const v = Number(input.value);
        out.textContent = format(v);
        apply(v);
      };
      input.addEventListener('input', handler);
      return { input, out, handler };
    };

    this.setMutation = bindRange('setMutation', 'outMutation',
      (v) => `×${(v / 100).toFixed(2)}`,
      (v) => { app.eco.options.mutationRate = v / 100; });

    this.setMaxPop = bindRange('setMaxPop', 'outMaxPop',
      (v) => String(v),
      (v) => { app.eco.options.maxPopulation = v; });

    this.setSpeciation = bindRange('setSpeciation', 'outSpeciation',
      (v) => (v / 100).toFixed(2),
      (v) => {
        app.eco.options.speciationThreshold = v / 100;
        app.eco.species.speciationThreshold = v / 100;
      });

    this.setCrowding = bindRange('setCrowding', 'outCrowding',
      (v) => (v / 100).toFixed(2),
      (v) => {
        app.eco.options.crowdingSoft = v / 100;
        app.eco.options.crowdingRange = (v / 100) * 1.8;
      });

    const repop = document.querySelector('#setRepopulate');
    repop.addEventListener('change', () => { app.eco.options.autoRepopulate = repop.checked; });
    this.setRepopulate = repop;

    const opts = {
      optVegetation: 'vegetation',
      optParticles: 'particles',
      optWeather: 'weather',
      optDayNight: 'dayNight',
      optClouds: 'cloudShadows',
      optMinimap: 'minimap',
      optVision: 'vision',
    };
    this.displayInputs = {};
    for (const [id, key] of Object.entries(opts)) {
      const input = document.querySelector(`#${id}`);
      this.displayInputs[key] = input;
      input.addEventListener('change', () => {
        app.renderer.options[key] = input.checked;
        app.savePrefs();
      });
    }
  }

  /** Recharge les valeurs des réglages depuis le moteur courant. */
  syncSettings() {
    const eco = this.app.eco;
    this.setMutation.input.value = Math.round(eco.options.mutationRate * 100);
    this.setMutation.out.textContent = `×${eco.options.mutationRate.toFixed(2)}`;
    this.setMaxPop.input.value = eco.options.maxPopulation;
    this.setMaxPop.out.textContent = String(eco.options.maxPopulation);
    this.setSpeciation.input.value = Math.round(eco.options.speciationThreshold * 100);
    this.setSpeciation.out.textContent = eco.options.speciationThreshold.toFixed(2);
    this.setCrowding.input.value = Math.round(eco.options.crowdingSoft * 100);
    this.setCrowding.out.textContent = eco.options.crowdingSoft.toFixed(2);
    this.setRepopulate.checked = !!eco.options.autoRepopulate;
    for (const [key, input] of Object.entries(this.displayInputs)) {
      input.checked = !!this.app.renderer.options[key];
    }
  }

  // -------------------------------------------------------------- sauvegardes

  _bindSaves() {
    this.slotsEl = document.querySelector('#saveSlots');
    document.querySelector('#btnExport').addEventListener('click', () => {
      exportToFile(this.app.eco);
      toast('Fichier exporté', 'save');
    });
    const fileInput = document.querySelector('#fileInput');
    document.querySelector('#btnImport').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const data = await importFromFile(file);
        this.app.loadWorld(data);
        this.closeModal();
        toast('Simulation importée', 'success');
      } catch (err) {
        toast(err.message || 'Import impossible', 'danger', 4200);
      }
    });
  }

  renderSlots() {
    const slots = listSlots();
    this.slotsEl.innerHTML = '';
    for (const s of slots) {
      const el = document.createElement('div');
      el.className = 'slot';
      const label = s.empty
        ? '<strong>Emplacement libre</strong><small>Aucune donnée</small>'
        : `<strong>${s.meta.species ?? '?'} espèces · ${s.meta.population ?? '?'} individus</strong>
           <small>Jour ${s.meta.day ?? 0} · ${s.meta.season ?? ''} · ${formatDate(s.savedAt)} · ${Math.round((s.bytes || 0) / 1024)} ko</small>`;
      el.innerHTML = `
        <div class="slot-info">${label}</div>
        <div class="slot-actions">
          <button class="btn ghost" data-act="save">Sauvegarder</button>
          <button class="btn ghost" data-act="load" ${s.empty ? 'disabled style="opacity:.4"' : ''}>Charger</button>
          <button class="btn ghost danger" data-act="del" ${s.empty ? 'disabled style="opacity:.4"' : ''}>✕</button>
        </div>`;

      el.querySelector('[data-act="save"]').addEventListener('click', () => {
        const res = saveToSlot(s.slot, this.app.eco);
        if (res.ok) {
          toast(`Sauvegardé dans l'emplacement ${s.slot + 1}`, 'save');
          this.renderSlots();
        } else {
          toast(res.error, 'danger', 5000);
        }
      });
      if (!s.empty) {
        el.querySelector('[data-act="load"]').addEventListener('click', () => {
          const data = loadFromSlot(s.slot);
          if (!data) return toast('Sauvegarde illisible', 'danger');
          this.app.loadWorld(data);
          this.closeModal();
          toast(`Emplacement ${s.slot + 1} chargé`, 'success');
        });
        el.querySelector('[data-act="del"]').addEventListener('click', () => {
          deleteSlot(s.slot);
          this.renderSlots();
        });
      }
      this.slotsEl.appendChild(el);
    }
    if (!slots.length) this.slotsEl.innerHTML = `<p class="hint">Stockage local indisponible.</p>`;
  }

  quickSave() {
    const res = saveToSlot(0, this.app.eco);
    toast(res.ok ? 'Sauvegarde rapide (emplacement 1)' : res.error, res.ok ? 'save' : 'danger');
  }

  quickLoad() {
    const data = loadFromSlot(0);
    if (!data) return toast('Aucune sauvegarde rapide', 'warn');
    this.app.loadWorld(data);
    toast('Sauvegarde rapide chargée', 'success');
  }

  // ------------------------------------------------------------ nouveau monde

  _bindNewWorld() {
    this.seedInput = document.querySelector('#fieldSeed');
    this.worldPreset = 'default';
    for (const b of document.querySelectorAll('#worldPresets button')) {
      b.addEventListener('click', () => {
        document.querySelectorAll('#worldPresets button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.worldPreset = b.dataset.preset;
      });
    }
    document.querySelector('#btnDice').addEventListener('click', () => {
      this.seedInput.value = Math.random().toString(36).slice(2, 9);
    });
    document.querySelector('#btnGenerateWorld').addEventListener('click', () => {
      const raw = this.seedInput.value.trim();
      this.closeModal();
      this.app.newWorld({ seed: raw || null, preset: this.worldPreset });
    });
  }

  // ---------------------------------------------------------------- pointeur

  _bindPointer() {
    const canvas = this.canvas;
    const app = this.app;
    const pointers = new Map();
    let dragging = false;
    let moved = 0;
    let last = { x: 0, y: 0 };
    let pinchDist = 0;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        // Clic sur la minicarte : téléportation de la caméra.
        const mm = app.renderer.minimapToWorld(e.clientX, e.clientY);
        if (mm && app.renderer.options.minimap) {
          app.camera.follow = null;
          app.camera.x = mm.x;
          app.camera.y = mm.y;
          return;
        }
        dragging = true;
        moved = 0;
        last = { x: e.clientX, y: e.clientY };
        canvas.classList.add('dragging');
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        dragging = false;
        canvas.classList.remove('dragging');
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          app.camera.zoomAt(mid.x, mid.y, d / pinchDist);
        }
        pinchDist = d;
        return;
      }

      if (dragging) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) app.camera.panByScreen(dx, dy);
        last = { x: e.clientX, y: e.clientY };
      } else {
        // Survol : met en évidence la créature sous le curseur.
        const w = app.camera.screenToWorld(e.clientX, e.clientY);
        app.renderer.hovered = app.eco.pick(w.x, w.y, 22 / app.camera.zoom);
        canvas.classList.toggle('picking', !!app.renderer.hovered);
      }
    });

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (dragging && moved <= 4) {
        const w = app.camera.screenToWorld(e.clientX, e.clientY);
        app.select(app.eco.pick(w.x, w.y, 26 / app.camera.zoom));
      }
      dragging = false;
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      dragging = false;
      canvas.classList.remove('dragging');
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      app.camera.zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      const w = app.camera.screenToWorld(e.clientX, e.clientY);
      const c = app.eco.pick(w.x, w.y, 30 / app.camera.zoom);
      if (c) {
        app.select(c);
        app.camera.follow = c;
        app.camera.targetZoom = Math.max(app.camera.targetZoom, 1.8);
      }
    });
  }

  // ---------------------------------------------------------------- clavier

  _bindKeyboard() {
    const app = this.app;
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') document.activeElement.blur();
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          app.setPaused(!app.paused);
          break;
        case 'ArrowRight':
          app.stepOnce();
          break;
        case '+': case '=':
          app.setSpeed(nextPreset(app.speed, 1));
          break;
        case '-': case '_':
          app.setSpeed(nextPreset(app.speed, -1));
          break;
        case 'f': case 'F':
          app.toggleFollow();
          break;
        case 'v': case 'V':
          app.renderer.options.vision = !app.renderer.options.vision;
          this.syncSettings();
          app.savePrefs();
          break;
        case 'm': case 'M':
          app.renderer.options.minimap = !app.renderer.options.minimap;
          this.syncSettings();
          app.savePrefs();
          break;
        case 'Tab':
          e.preventDefault();
          this.togglePanels();
          break;
        case 's': case 'S':
          e.preventDefault();
          this.quickSave();
          break;
        case 'l': case 'L':
          this.quickLoad();
          break;
        case 'n': case 'N':
          this.openModal('modalNewWorld');
          break;
        case '?':
          this.openModal('modalHelp');
          break;
        case 'Escape':
          if (this.openModalId) this.closeModal();
          else app.select(null);
          break;
      }
    });
  }
}

const PRESETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

function nextPreset(current, dir) {
  if (dir > 0) {
    for (const p of PRESETS) if (p > current + 0.001) return p;
    return SPEED_MAX;
  }
  for (let i = PRESETS.length - 1; i >= 0; i--) if (PRESETS[i] < current - 0.001) return PRESETS[i];
  return SPEED_MIN;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
