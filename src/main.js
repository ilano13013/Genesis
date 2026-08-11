/**
 * Genesis — point d'entrée.
 *
 * Assemble le moteur (écosystème), le rendu et l'interface, puis pilote la
 * boucle d'animation.
 *
 * Boucle à pas fixe avec budget de temps : la simulation avance par pas de
 * durée constante (stabilité numérique), et le nombre de pas exécutés par
 * image est plafonné par un budget en millisecondes. Le rendu conserve ainsi
 * ses 60 images/seconde ; si la vitesse demandée dépasse ce que la machine
 * peut calculer, c'est la vitesse *effective* qui baisse — elle est affichée
 * dans le bandeau supérieur.
 */
import { Ecosystem } from './sim/ecosystem.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { Controls } from './ui/controls.js';
import { SpeciesPanel } from './ui/speciespanel.js';
import { Inspector } from './ui/inspector.js';
import { initToasts, toast } from './ui/toast.js';
import { prefs } from './persistence/save.js';
import { hashSeed } from './core/rng.js';
import { clamp } from './core/utils.js';

const SIM_BUDGET_MS = 11;   // temps de calcul maximal par image
const MIN_STEP = 1 / 30;    // pas de simulation le plus fin
const MAX_STEP = 0.12;      // pas le plus grossier (vitesses extrêmes)

/**
 * Profil d'appareil.
 *
 * Sur téléphone, deux contraintes changent la donne : le processeur est
 * plusieurs fois plus lent, et le canvas de terrain pré-rendu (un pixel par
 * unité monde) pèse directement sur la mémoire graphique. On réduit donc le
 * monde et le plafond de population — la densité d'animaux à l'écran, elle,
 * reste la même.
 */
function deviceProfile() {
  const smallScreen = window.matchMedia('(max-width: 900px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const weakCpu = (navigator.hardwareConcurrency || 8) <= 4;
  if (smallScreen && coarse) {
    return { name: 'mobile', cols: 140, rows: 88, maxPopulation: 420, particles: 700 };
  }
  if (coarse || weakCpu) {
    return { name: 'tablette', cols: 170, rows: 106, maxPopulation: 650, particles: 1000 };
  }
  return { name: 'bureau', cols: 200, rows: 125, maxPopulation: 1000, particles: 1500 };
}

const app = {
  canvas: document.querySelector('#view'),
  eco: null,
  camera: null,
  renderer: null,
  hud: null,
  controls: null,
  speciesPanel: null,
  inspector: null,

  paused: false,
  speed: 1,
  effectiveSpeed: 1,
  fps: 60,
  time: 0,
};

// ---------------------------------------------------------------- démarrage

const loadingEl = document.querySelector('#loading');
const loadingText = document.querySelector('#loadingText');

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  initToasts(document.querySelector('#toasts'));

  const saved = prefs.read({
    panelsHidden: false,
    speed: 1,
    display: {},
  });

  loadingText.textContent = 'Formation du relief…';
  await nextFrame();

  app.profile = deviceProfile();
  app.eco = new Ecosystem({
    seed: (Math.random() * 0xffffffff) >>> 0,
    cols: app.profile.cols,
    rows: app.profile.rows,
    maxPopulation: app.profile.maxPopulation,
  });

  loadingText.textContent = 'Ensemencement de la végétation…';
  await nextFrame();
  app.eco.seedWorld('default');

  loadingText.textContent = 'Peinture du monde…';
  await nextFrame();

  app.camera = new Camera(app.eco.terrain.width, app.eco.terrain.height);
  app.renderer = new Renderer(app.canvas, saved.display);
  app.renderer.particles.resize(app.profile.particles);
  app.renderer.attach(app.eco);

  app.hud = new Hud();
  app.inspector = new Inspector({
    getEco: () => app.eco,
    select: (c) => app.select(c),
    toggleFollow: () => app.toggleFollow(),
  });
  app.speciesPanel = new SpeciesPanel({
    getEco: () => app.eco,
    focusSpecies: (id) => app.focusSpecies(id),
    openModal: (id) => app.controls.openModal(id),
    closeModal: () => app.controls.closeModal(),
    onChanged: () => app.controls.syncSettings(),
  });
  app.controls = new Controls(app);

  if (saved.panelsHidden) document.body.classList.add('panels-hidden');
  app.setSpeed(saved.speed || 1);
  app.controls.syncSettings();
  app.controls.syncPlayback();

  handleResize();
  app.camera.fitWorld();
  window.addEventListener('resize', handleResize);

  loadingText.textContent = 'Le monde s\'éveille…';
  await nextFrame();
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 900);

  toast('Bienvenue dans Genesis — appuyez sur ? pour le guide', 'world', 5200);
  requestAnimationFrame(loop);
}

function handleResize() {
  const { width, height } = app.renderer.resize();
  app.camera.setViewport(width, height);
  app.updateInsets();
}

/** Décale la minicarte pour qu'elle reste dégagée des panneaux et du dock. */
app.updateInsets = () => {
  const compact = window.matchMedia('(max-width: 900px)').matches;
  const hidden = document.body.classList.contains('panels-hidden');
  const panelWidth = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-w'), 10) || 306;
  app.renderer.insets.left = compact || hidden ? 0 : panelWidth + 18;
  app.renderer.insets.bottom = window.matchMedia('(max-width: 660px)').matches ? 76 : 0;
};

// ------------------------------------------------------------------- boucle

let lastTime = performance.now();
let accumulator = 0;
let fpsAccum = 0;
let fpsFrames = 0;

function loop(now) {
  requestAnimationFrame(loop);

  const realDt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  app.time += realDt;

  // --- lissage du compteur d'images
  fpsAccum += realDt;
  fpsFrames++;
  if (fpsAccum >= 0.4) {
    app.fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  // --- avancement de la simulation
  if (!app.paused) {
    const eco = app.eco;
    // Au-delà d'un certain rythme, les effets ponctuels (particules de
    // broutage, morsures) n'ont plus de sens visuel : on les coupe.
    eco.allowEffects = app.speed <= 40;

    const dt = clamp(app.speed / 300, MIN_STEP, MAX_STEP);
    accumulator += realDt * app.speed;
    // Garde-fou : on ne rattrape jamais plus d'un quart de seconde de retard.
    accumulator = Math.min(accumulator, app.speed * 0.25 + dt);

    const budgetStart = performance.now();
    let advanced = 0;
    while (accumulator >= dt) {
      eco.step(dt);
      accumulator -= dt;
      advanced += dt;
      if (performance.now() - budgetStart > SIM_BUDGET_MS) {
        accumulator = 0; // le retard est abandonné, pas accumulé
        break;
      }
    }
    const instant = realDt > 0 ? advanced / realDt : 0;
    app.effectiveSpeed += (instant - app.effectiveSpeed) * 0.15;
    drainNotices(eco);
  }

  // --- rendu
  app.camera.update(realDt);
  app.renderer.render(app.camera, realDt);

  // --- interface
  app.hud.update(app.eco, {
    fps: app.fps,
    speed: app.speed,
    effective: app.paused ? 0 : app.effectiveSpeed,
    paused: app.paused,
  }, realDt);
  app.speciesPanel.update(app.eco, realDt);
  app.speciesPanel.renderPreview(app.time);
  app.inspector.update(realDt, app.time);
}

function drainNotices(eco) {
  const notices = eco.drainNotices();
  for (const n of notices) {
    if (n.type === 'speciation') toast(n.text, 'speciation', 4200);
    else if (n.type === 'repopulate') toast(n.text, 'warn', 3400);
    else if (n.type === 'species-added') toast(n.text, 'species', 3000);
  }
}

// --------------------------------------------------------------- actions app

// `window.genesis` est exposé dès le chargement du module, donc avant la fin
// de l'amorçage : ces actions doivent tolérer une interface pas encore prête.
app.setPaused = (paused) => {
  app.paused = paused;
  accumulator = 0;
  app.controls?.syncPlayback();
};

app.setSpeed = (speed) => {
  app.speed = clamp(speed, 1, 1000);
  accumulator = 0;
  app.controls?.syncPlayback();
  if (app.renderer) app.savePrefs();
};

app.stepOnce = () => {
  app.paused = true;
  app.eco.allowEffects = true;
  app.eco.step(MIN_STEP);
  drainNotices(app.eco);
  app.controls.syncPlayback();
};

app.select = (creature) => {
  app.renderer.selected = creature || null;
  app.inspector.setTarget(creature || null);
  if (!creature) app.camera.follow = null;
};

app.toggleFollow = () => {
  const c = app.renderer.selected;
  if (!c) return toast('Sélectionnez d\'abord une créature', 'warn');
  if (app.camera.follow === c) {
    app.camera.follow = null;
    toast('Suivi désactivé');
  } else {
    app.camera.follow = c;
    app.camera.targetZoom = Math.max(app.camera.targetZoom, 1.6);
    toast('Suivi activé');
  }
};

app.focusSpecies = (id) => {
  if (!id) return;
  const members = app.eco.creatures.filter((c) => c.speciesId === id);
  if (!members.length) return toast('Cette espèce n\'a plus d\'individu vivant', 'warn');
  // Centre la caméra sur le barycentre du groupe.
  let x = 0, y = 0;
  for (const m of members) { x += m.x; y += m.y; }
  app.camera.follow = null;
  app.camera.x = x / members.length;
  app.camera.y = y / members.length;
  app.camera.targetZoom = Math.max(app.camera.targetZoom, 0.85);
};

app.newWorld = async ({ seed = null, preset = 'default' } = {}) => {
  loadingEl.classList.remove('done');
  document.body.appendChild(loadingEl);
  loadingText.textContent = 'Formation du relief…';
  await nextFrame();

  const numericSeed = seed === null || seed === ''
    ? (Math.random() * 0xffffffff) >>> 0
    : (/^\d+$/.test(seed) ? Number(seed) >>> 0 : hashSeed(seed));

  const options = { ...app.eco.options };
  delete options.seed;
  app.eco = new Ecosystem({ ...options, seed: numericSeed });

  loadingText.textContent = 'Ensemencement de la végétation…';
  await nextFrame();
  app.eco.seedWorld(preset);

  loadingText.textContent = 'Peinture du monde…';
  await nextFrame();
  app.attachWorld();

  loadingEl.classList.add('done');
  toast(`Nouveau monde — graine ${numericSeed}`, 'world', 4000);
};

app.loadWorld = (data) => {
  try {
    const eco = Ecosystem.deserialize(data.world);
    app.eco = eco;
    app.attachWorld();
    toast(`Monde restauré — jour ${Math.floor(eco.time / eco.climate.dayLength)}`, 'success');
  } catch (err) {
    console.error(err);
    toast('Chargement impossible : ' + (err.message || err), 'danger', 5000);
  }
};

/** Relie un nouvel écosystème au rendu et à l'interface. */
app.attachWorld = () => {
  app.select(null);
  app.renderer.attach(app.eco);
  app.camera = new Camera(app.eco.terrain.width, app.eco.terrain.height);
  handleResize();
  app.camera.fitWorld();
  app.speciesPanel.cards.forEach((c) => c.root.remove());
  app.speciesPanel.cards.clear();
  app.speciesPanel.selectedId = null;
  app.controls.syncSettings();
  app.eco.sampleStats(true);
  accumulator = 0;
};

app.savePrefs = () => {
  prefs.write({
    panelsHidden: document.body.classList.contains('panels-hidden'),
    speed: app.speed,
    display: { ...app.renderer.options },
  });
};

// Expose l'application pour l'inspection depuis la console du navigateur.
window.genesis = app;

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = 'Erreur au démarrage : ' + (err.message || err);
});
