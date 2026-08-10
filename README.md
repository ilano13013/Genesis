# 🌍 Genesis — simulation d'écosystème vivant

Un monde qui vit dans le navigateur : un terrain généré procéduralement, une
végétation qui pousse au rythme des saisons, et des centaines de créatures qui
cherchent leur nourriture, se fuient, se chassent, se reproduisent, vieillissent
et meurent — en transmettant à leur descendance un génome légèrement muté.

**HTML, CSS et JavaScript natifs. Aucun framework, aucune dépendance, aucune
étape de compilation.**

---

## Démarrage

Le projet utilise les modules ES : il doit être servi en HTTP (l'ouverture
directe du fichier `index.html` en `file://` est bloquée par la politique CORS
des navigateurs).

```bash
# au choix
python3 -m http.server 8080     # puis http://localhost:8080
npx serve .
php -S localhost:8080
```

Tests du noyau de simulation (sans navigateur, Node ≥ 18) :

```bash
npm test
```

---

## Ce que fait la simulation

### Le monde

Le relief est produit par un bruit de gradient fractal avec *domain warping*,
normalisé puis atténué vers les bords — d'où une île cernée d'océan, qui donne
des frontières naturelles aux créatures. Le croisement de l'altitude et de
l'humidité détermine huit biomes : eau profonde, hauts-fonds, plage, désert,
prairie, forêt, montagne et sommets enneigés. Chaque biome porte une fertilité
et un coefficient de déplacement propres.

Le terrain est peint **une seule fois** au chargement sur un canvas hors écran :
une couche colorée suréchantillonnée (frontières organiques, écume de côte),
puis une passe de décors vectoriels — arbres, tufs d'herbe, dunes, cactus,
rochers, congères, galets. La boucle d'animation n'en fait plus qu'un
`drawImage`.

### Le climat

- **Jour/nuit** — la lumière suit une courbe solaire ; les nuits raccourcissent
  en été. Les espèces diurnes se mettent au repos la nuit pour économiser leur
  énergie, et les lucioles sortent au-dessus des forêts.
- **Saisons** — printemps, été, automne, hiver s'enchaînent (4 jours chacune par
  défaut) et pilotent la température et la croissance végétale. L'hiver fait
  reculer la végétation et coûte de l'énergie aux petits gabarits.
- **Météo** — ciel dégagé, nuageux, pluie, orage, brume, neige, avec transitions
  progressives, vent dérivant, ombres de nuages qui balaient le sol et éclairs
  qui font trembler la caméra. Les probabilités dépendent de la saison : pas de
  neige en été, peu d'orages en hiver.

### La végétation

Une densité par cellule, en croissance logistique bornée par la fertilité du
sol et modulée par saison, météo et lumière. La grille est mise à jour par
tranches (un huitième par pas) : le coût reste constant même sur 25 000
cellules. Les herbivores broutent, les cadavres se décomposent et fertilisent
le sol.

### Les créatures

Chaque individu porte un génome de dix gènes : vitesse, vision, taille,
métabolisme, fertilité, longévité, carnivorie, agressivité, sociabilité et
teinte. Tout le reste en découle — énergie maximale, rayon, âge de maturité,
coût métabolique, efficacité digestive.

Le comportement combine des pulsions pondérées : fuir un prédateur, chasser une
proie, rejoindre la meilleure parcelle de végétation, rejoindre un partenaire,
rester avec ses congénères, s'écarter des voisins trop proches, explorer, et
éviter l'eau profonde. La pulsion dominante détermine l'effort fourni — et donc
la dépense énergétique : fuir coûte cher, brouter tranquillement ne coûte rien.

À la reproduction, les gènes des deux parents se mélangent puis mutent
(gaussienne par gène, plus de rares mutations de grande amplitude). Quand un
nouveau-né s'écarte trop de l'archétype de son espèce, il fonde une **espèce
fille** : c'est la spéciation, annoncée par une onde colorée et une
notification.

La population est régulée par la **densité locale** plutôt que par un plafond
global : au-delà d'environ 1,5 congénère par carré de 100×100 unités, la
reproduction devient improbable. Une espèce prospère sature son propre
territoire et laisse de la place aux autres, ce qui produit des cycles
proie/prédateur au lieu d'une monoculture.

---

## Interface

| Élément | Rôle |
|---|---|
| Bandeau supérieur | Jour et heure, saison, météo, température, luminosité, FPS et vitesse effective |
| Panneau gauche | Population, espèces, âge moyen, ressources, courbes, régimes alimentaires, génome moyen, causes de mortalité |
| Panneau droit | Liste vivante des espèces (effectif, régime, générations, courbe), introduction et retrait d'espèces |
| Inspecteur | Fiche de la créature sélectionnée : portrait animé, énergie, âge, génome, état comportemental |
| Dock | Lecture/pause, pas à pas, vitesse ×1 → ×1000, sauvegardes, nouveau monde, réglages, aide |
| Minicarte | Vue d'ensemble, répartition des créatures par régime, cadre de la vue — cliquable |

### Raccourcis

| Touche | Action |
|---|---|
| `Espace` | Pause / reprise |
| `→` | Avancer d'un pas |
| `+` / `−` | Vitesse (paliers) |
| `Molette` / `Glisser` | Zoom / déplacement |
| `Clic` / `Double-clic` | Sélectionner / suivre |
| `F` | Suivre la créature sélectionnée |
| `Tab` | Masquer les panneaux |
| `S` / `L` | Sauvegarde / chargement rapide |
| `N` | Nouveau monde |
| `V` / `M` | Champs de vision / minicarte |
| `?` | Guide |

### Sauvegardes

Trois emplacements locaux (`localStorage`) plus l'export/import de fichiers
`.json`. La sauvegarde contient la graine du monde, l'horloge, le climat, toutes
les espèces, tous les génomes et la densité végétale quantifiée sur 8 bits —
le monde reprend exactement où il s'était arrêté.

---

## Performance

La boucle est à **pas fixe avec budget de temps**. La simulation avance par pas
de durée constante (stabilité numérique) et le nombre de pas exécutés par image
est plafonné à ~11 ms. Le rendu garde donc ses 60 images par seconde ; si la
vitesse demandée dépasse ce que la machine peut calculer, c'est la vitesse
*effective* qui baisse — elle s'affiche alors en orange dans le bandeau.

Coût mesuré par image (Chromium, rendu logiciel, 1600×900) :

| Créatures | Rendu | Simulation | Total | Budget 60 FPS |
|---:|---:|---:|---:|---:|
| 300 | 2,0 ms | 0,5 ms | **2,5 ms** | 16,7 ms |
| 600 | 4,2 ms | 1,1 ms | **5,4 ms** | 16,7 ms |
| 900 | 5,4 ms | 1,7 ms | **7,0 ms** | 16,7 ms |

Les principaux leviers :

- **Partitionnement spatial** — une grille uniforme reconstruite à chaque pas
  ramène la recherche de voisins de O(n²) à O(n·k).
- **Perception échelonnée** — chaque créature ne « réfléchit » qu'un pas sur
  trois ou quatre, décalé par identifiant, et mémorise ses cibles entre-temps.
  Une seule requête de voisinage alimente fuite, chasse, reproduction et
  grégarisme.
- **Recyclage** — créatures, cadavres et particules vivent dans des pools ;
  aucune allocation en régime permanent.
- **Tableaux typés** — terrain, végétation et particules sont stockés dans des
  `Float32Array` / `Uint8Array` parallèles.
- **Pré-rendu** — terrain, sprite d'ombre de nuage et minicarte sont calculés
  une fois pour toutes.
- **Niveaux de détail** — au-delà d'un certain dézoom, les créatures passent du
  dessin complet (corps, queue, pattes, tête, yeux, crocs) au simple disque.

---

## Organisation du code

```
index.html                 structure de l'interface
styles/main.css            thème sombre, panneaux en verre dépoli, animations
src/
  main.js                  assemblage et boucle d'animation
  core/
    rng.js                 générateur déterministe (mulberry32) + lois usuelles
    utils.js               maths, couleurs, formatage, base64
  world/
    noise.js               bruit de gradient, fBm, ridged, domain warping
    terrain.js             relief, humidité, biomes, fertilité, requêtes
    climate.js             jour/nuit, saisons, météo, vent
    food.js                végétation en croissance logistique amortie
  sim/
    genome.js              gènes, mutation, croisement, distance génétique
    creature.js            perception, décision, déplacement, métabolisme
    species.js             registre des espèces et spéciation
    spatialhash.js         grille de partitionnement spatial
    ecosystem.js           orchestration du temps (sans dépendance au DOM)
  render/
    camera.js              panoramique, zoom, suivi, secousses
    terrainpainter.js      pré-rendu du terrain et des décors
    renderer.js            couches de rendu, météo, jour/nuit, minicarte
    particles.js           système de particules à pool fixe
    portrait.js            portrait animé d'un génome
  ui/
    hud.js                 bandeau et panneau de statistiques
    charts.js              graphiques canvas (aires empilées, sparklines)
    speciespanel.js        liste des espèces et éditeur de création
    inspector.js           fiche de la créature sélectionnée
    controls.js            dock, modales, clavier, souris, tactile
    toast.js               notifications
  persistence/
    save.js                emplacements locaux, export/import, préférences
tests/
  simulation.test.mjs      tests headless du noyau
```

Le noyau de simulation (`src/sim`, `src/world`, `src/core`) ne touche jamais au
DOM : il tourne tel quel sous Node, ce dont profitent les tests.

---

## Compatibilité

Navigateurs de bureau et mobiles récents (Chrome, Edge, Firefox, Safari)
supportant les modules ES, `backdrop-filter` et les événements *pointer*.
L'interface s'adapte aux petits écrans ; le zoom par pincement et le
déplacement au doigt sont pris en charge.

## Licence

MIT.
