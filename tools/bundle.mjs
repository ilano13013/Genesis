/**
 * Assemble le projet en un fichier HTML autonome.
 *
 * Pourquoi : les modules ES sont bloqués en `file://` par la politique CORS,
 * ce qui oblige normalement à lancer un serveur. En repliant tous les modules
 * dans un seul script en ligne, le fichier produit s'ouvre par simple
 * double-clic — et se transfère tel quel sur un téléphone.
 *
 * Le repliage est volontairement minimal : le code n'utilise que des imports
 * nommés statiques et des exports de déclarations, donc il suffit de trier les
 * modules par dépendances, de retirer les lignes `import` et le mot-clé
 * `export`. Les collisions de noms au niveau module sont détectées et font
 * échouer la construction plutôt que de produire un fichier subtilement faux.
 *
 * Usage : node tools/bundle.mjs
 *   dist/genesis.html          page autonome (double-clic)
 *   dist/genesis.fragment.html corps seul, pour un hébergeur qui fournit
 *                              déjà <!doctype>, <head> et <body>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'src/main.js');

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*\r?\n/gm;
const DECL_RE = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

const modules = new Map();   // chemin absolu -> { code, deps }
const order = [];            // ordre topologique

function load(path) {
  if (modules.has(path)) return;
  const source = readFileSync(path, 'utf8');
  const deps = [];
  let code = source.replace(IMPORT_RE, (_, names, spec) => {
    if (!spec.startsWith('.')) {
      throw new Error(`${relative(ROOT, path)} : import non relatif « ${spec} » non pris en charge`);
    }
    deps.push(resolve(dirname(path), spec));
    return '';
  });

  if (/^\s*import\b/m.test(code)) {
    throw new Error(`${relative(ROOT, path)} : forme d'import non prise en charge (défaut, espace de noms ou dynamique)`);
  }
  if (/^export\s*\{|^export\s+default\b/m.test(code)) {
    throw new Error(`${relative(ROOT, path)} : « export {} » et « export default » ne sont pas pris en charge`);
  }

  // Marque le module comme en cours de résolution avant de descendre dans ses
  // dépendances : un cycle éventuel ne provoquerait pas de récursion infinie.
  modules.set(path, null);
  for (const dep of deps) load(dep);

  code = code.replace(/^export\s+/gm, '');
  modules.set(path, { code, deps });
  order.push(path);
}

load(ENTRY);

// --- détection des collisions de noms au niveau module ----------------------
const owners = new Map();
const collisions = [];
for (const path of order) {
  const seen = new Set();
  for (const m of modules.get(path).code.matchAll(DECL_RE)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (owners.has(name)) collisions.push(`${name} (${relative(ROOT, owners.get(name))} et ${relative(ROOT, path)})`);
    else owners.set(name, path);
  }
}
if (collisions.length) {
  console.error('Collision de noms au niveau module :\n  ' + collisions.join('\n  '));
  process.exit(1);
}

// --- assemblage du script ---------------------------------------------------
const script = order
  .map((path) => `// ── ${relative(ROOT, path)} ${'─'.repeat(Math.max(0, 62 - relative(ROOT, path).length))}\n${modules.get(path).code.trim()}`)
  .join('\n\n');

const css = readFileSync(resolve(ROOT, 'styles/main.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error('index.html : <body> introuvable');
const body = bodyMatch[1].replace(/\s*<script type="module"[\s\S]*?<\/script>\s*/g, '\n');

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
const title = titleMatch ? titleMatch[1].trim() : 'Genesis';

for (const marker of ['</style', '</script']) {
  if (css.includes(marker) || script.includes(marker)) {
    throw new Error(`Le contenu referme prématurément une balise (${marker})`);
  }
}

const banner = `<!--\n  Genesis — écosystème vivant. Fichier autonome engendré par tools/bundle.mjs.\n  Sources : https://github.com/ilano13013/Genesis — ne pas modifier ici.\n-->`;

const fragment = `${banner}
<title>${title}</title>
<style>
${css}
</style>
${body}
<script type="module">
${script}
</script>
`;

const standalone = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070b12">
<meta name="description" content="Genesis — simulation d'un écosystème vivant : évolution, génétique, terrain procédural, saisons et météo dynamique.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌍</text></svg>">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script type="module">
${script}
</script>
</body>
</html>
`;

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
writeFileSync(resolve(ROOT, 'dist/genesis.html'), standalone);
writeFileSync(resolve(ROOT, 'dist/genesis.fragment.html'), fragment);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' ko';
console.log(`${order.length} modules assemblés`);
console.log(`  dist/genesis.html          ${kb(standalone)}`);
console.log(`  dist/genesis.fragment.html ${kb(fragment)}`);
