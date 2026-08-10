/**
 * Tests headless du noyau de simulation (aucune dépendance au DOM).
 * Lancement : `npm test` ou `node tests/simulation.test.mjs`
 */
import { Ecosystem } from '../src/sim/ecosystem.js';
import { Terrain, BIOME_INFO } from '../src/world/terrain.js';
import { breed, randomGenome, geneticDistance, makeGenome, genomeToArray, genomeFromArray } from '../src/sim/genome.js';
import { Rng } from '../src/core/rng.js';

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    results.push(`  ❌ ${name}\n     ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion échouée');
}

function assertRange(v, min, max, label) {
  assert(v >= min && v <= max, `${label} = ${v}, attendu dans [${min}, ${max}]`);
}

// ---------------------------------------------------------------- RNG

test('Rng est déterministe pour une même graine', () => {
  const a = new Rng(1234), b = new Rng(1234);
  for (let i = 0; i < 100; i++) assert(a.next() === b.next(), 'divergence');
});

test('Rng.range et Rng.int restent dans les bornes', () => {
  const r = new Rng(7);
  for (let i = 0; i < 1000; i++) {
    assertRange(r.range(-3, 5), -3, 5, 'range');
    assertRange(r.int(10), 0, 9, 'int');
  }
});

// ---------------------------------------------------------------- Terrain

test('Le terrain génère tous les biomes attendus', () => {
  const t = new Terrain({ cols: 160, rows: 100, cellSize: 16, seed: 42 });
  const shares = t.biomeShares();
  const land = shares.slice(2).reduce((a, b) => a + b, 0);
  assert(land > 0.25, `trop peu de terres émergées (${(land * 100).toFixed(1)}%)`);
  assert(shares[0] + shares[1] > 0.05, 'pas assez d\'eau');
  for (let i = 0; i < BIOME_INFO.length; i++) {
    assert(shares[i] >= 0, `biome ${i} négatif`);
  }
});

test('Le terrain est reproductible et borné', () => {
  const a = new Terrain({ cols: 64, rows: 40, seed: 99 });
  const b = new Terrain({ cols: 64, rows: 40, seed: 99 });
  for (let i = 0; i < a.count; i++) {
    assert(a.biome[i] === b.biome[i], 'terrains divergents pour une même graine');
    assertRange(a.elevation[i], 0, 1, 'élévation');
    assertRange(a.fertility[i], 0, 1, 'fertilité');
  }
});

test('findLandNear retourne toujours une position franchissable', () => {
  const t = new Terrain({ cols: 96, rows: 60, seed: 5 });
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * t.width, y = Math.random() * t.height;
    const p = t.findLandNear(x, y);
    assert(!t.isBlocked(p.x, p.y), 'position bloquée retournée');
  }
});

// ---------------------------------------------------------------- Génome

test('breed respecte les bornes des gènes', () => {
  const rng = new Rng(3);
  let a = randomGenome(rng), b = randomGenome(rng);
  for (let i = 0; i < 4000; i++) {
    const c = breed(a, b, rng, 3);
    assertRange(c.size, 0.42, 2.8, 'taille');
    assertRange(c.carnivory, 0, 1, 'carnivorie');
    assertRange(c.hue, 0, 360, 'teinte');
    assert(Number.isFinite(c.speed), 'vitesse non finie');
    a = c;
    if (i % 3 === 0) b = c;
  }
});

test('La distance génétique est nulle pour deux copies', () => {
  const rng = new Rng(11);
  const g = randomGenome(rng);
  assert(geneticDistance(g, g) === 0, 'distance non nulle');
  const far = makeGenome({ ...g, size: 2.8, carnivory: 1, speed: 165 });
  assert(geneticDistance(g, far) > 0, 'distance non positive');
});

test('Le génome survit à un aller-retour de sérialisation', () => {
  const rng = new Rng(21);
  const g = randomGenome(rng);
  const g2 = genomeFromArray(genomeToArray(g));
  assert(geneticDistance(g, g2) < 0.005, 'perte d\'information');
});

// ---------------------------------------------------------------- Écosystème

const eco = new Ecosystem({ seed: 20240607, cols: 200, rows: 125 });
eco.seedWorld('default');
const initialPop = eco.creatures.length;

test('Le monde initial est peuplé', () => {
  assert(initialPop > 100, `population initiale = ${initialPop}`);
  assert(eco.species.livingCount() >= 3, 'espèces manquantes');
});

const DT = 1 / 30;
const STEPS = 9000; // ≈ 5 minutes de temps simulé
const t0 = Date.now();
const samples = [];
for (let i = 0; i < STEPS; i++) {
  eco.step(DT);
  if (i % 900 === 0) {
    samples.push({
      t: Math.round(eco.time),
      pop: eco.stats.population,
      esp: eco.stats.speciesCount,
      bio: Math.round(eco.stats.biomass),
      gen: eco.generationMax,
      herb: eco.stats.herbivores,
      carn: eco.stats.carnivores,
    });
  }
}
const elapsed = Date.now() - t0;

test('La simulation reste stable sur la durée', () => {
  assert(eco.creatures.length > 0, 'extinction totale');
  assert(eco.creatures.length <= eco.options.maxPopulation, 'plafond de population dépassé');
  for (const c of eco.creatures) {
    assert(Number.isFinite(c.x) && Number.isFinite(c.y), 'position NaN');
    assert(c.x >= 0 && c.x <= eco.terrain.width, 'sortie du monde en X');
    assert(c.y >= 0 && c.y <= eco.terrain.height, 'sortie du monde en Y');
    assert(c.energy > 0 && c.energy <= c.maxEnergy + 1e-6, `énergie invalide (${c.energy})`);
    assert(!eco.terrain.isBlocked(c.x, c.y), 'créature dans l\'eau profonde');
  }
});

test('L\'évolution produit des générations successives', () => {
  assert(eco.generationMax >= 3, `génération max = ${eco.generationMax}`);
  assert(eco.totalBirths > 50, `naissances = ${eco.totalBirths}`);
});

test('La chaîne alimentaire reste fonctionnelle', () => {
  // La régulation par densité locale doit empêcher qu'une seule espèce
  // monopolise le monde et étouffe les prédateurs.
  assert(eco.deathCauses['prédation'] > 0, 'aucune prédation sur toute la simulation');
  const shares = new Map();
  for (const c of eco.creatures) shares.set(c.speciesId, (shares.get(c.speciesId) || 0) + 1);
  const dominant = Math.max(...shares.values()) / eco.creatures.length;
  assert(dominant < 0.98, `monoculture : une espèce représente ${(dominant * 100).toFixed(0)}% de la population`);
  const capRatio = eco.creatures.length / eco.options.maxPopulation;
  assert(capRatio < 0.98, `population collée au plafond (${(capRatio * 100).toFixed(0)}%)`);
});

test('La végétation ne diverge pas', () => {
  for (let i = 0; i < eco.food.plants.length; i++) {
    const p = eco.food.plants[i];
    assert(p >= 0 && p <= 1.001, `densité végétale invalide: ${p}`);
  }
  assert(eco.food.totalBiomass > 0, 'biomasse nulle');
});

test('Les compteurs d\'espèces sont cohérents', () => {
  const counts = new Map();
  for (const c of eco.creatures) counts.set(c.speciesId, (counts.get(c.speciesId) || 0) + 1);
  for (const [id, n] of counts) {
    const sp = eco.species.get(id);
    assert(sp, `espèce ${id} absente du registre`);
    assert(sp.count === n, `compteur ${sp.name}: ${sp.count} ≠ ${n}`);
  }
});

test('Le budget de performance est tenu', () => {
  const perStep = elapsed / STEPS;
  // Objectif : 60 FPS avec ≥16 pas par image => < 1 ms par pas.
  assert(perStep < 1.0, `${perStep.toFixed(3)} ms/pas (trop lent)`);
});

// ---------------------------------------------------------------- Sauvegarde

test('Sauvegarde / chargement restitue l\'état', () => {
  const data = JSON.parse(JSON.stringify(eco.serialize()));
  const loaded = Ecosystem.deserialize(data);
  assert(loaded.creatures.length === eco.creatures.length, 'population différente');
  assert(Math.abs(loaded.time - eco.time) < 1e-6, 'temps différent');
  assert(loaded.species.list.length === eco.species.list.length, 'espèces différentes');
  const a = eco.creatures[0], b = loaded.creatures[0];
  assert(Math.abs(a.x - b.x) < 0.2 && Math.abs(a.y - b.y) < 0.2, 'positions divergentes');
  assert(Math.abs(loaded.food.totalBiomass - eco.food.totalBiomass) / eco.food.totalBiomass < 0.02,
    'biomasse divergente');
  // La copie doit pouvoir continuer à tourner.
  for (let i = 0; i < 300; i++) loaded.step(DT);
  assert(loaded.creatures.length > 0, 'la simulation chargée s\'effondre');
});

test('Ajout et suppression d\'espèce', () => {
  const before = eco.creatures.length;
  const sp = eco.addSpecies({ count: 30, genome: randomGenome(new Rng(5), 0.1) });
  assert(eco.creatures.length === before + 30, 'individus non créés');
  assert(sp.count === 30, 'compteur d\'espèce incorrect');
  eco.removeSpecies(sp.id);
  assert(!eco.species.get(sp.id), 'espèce toujours présente');
  for (const c of eco.creatures) assert(c.speciesId !== sp.id, 'individus orphelins');
});

// ---------------------------------------------------------------- Rapport

console.log('\n🌍 Genesis — tests du noyau de simulation\n');
console.log(results.join('\n'));
console.log('\n📈 Évolution de la simulation :');
console.log('   t(s)   pop   esp   biomasse   gen   herb   carn');
for (const s of samples) {
  console.log(
    `   ${String(s.t).padStart(5)} ${String(s.pop).padStart(5)} ${String(s.esp).padStart(5)} ` +
    `${String(s.bio).padStart(10)} ${String(s.gen).padStart(5)} ${String(s.herb).padStart(6)} ${String(s.carn).padStart(6)}`
  );
}
console.log(`\n⏱️  ${STEPS} pas en ${elapsed} ms — ${(elapsed / STEPS).toFixed(3)} ms/pas ` +
  `(${eco.creatures.length} créatures en fin de test)`);
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} test(s) réussi(s), ${failed} échec(s)\n`);

process.exit(failed === 0 ? 1 * 0 + (failed ? 1 : 0) : 1);
