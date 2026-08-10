/**
 * Sauvegarde / chargement : emplacements locaux (localStorage) et
 * import/export de fichiers `.genesis.json`.
 */
const PREFIX = 'genesis.save.';
export const SLOT_COUNT = 3;

function keyOf(slot) {
  return `${PREFIX}${slot}`;
}

function buildPayload(ecosystem, meta = {}) {
  return {
    app: 'genesis',
    format: 2,
    savedAt: new Date().toISOString(),
    meta: {
      population: ecosystem.stats.population,
      species: ecosystem.stats.speciesCount,
      day: Math.floor(ecosystem.time / ecosystem.climate.dayLength),
      season: ecosystem.climate.season.name,
      ...meta,
    },
    world: ecosystem.serialize(),
  };
}

/** @returns {{ok: boolean, error?: string, meta?: object}} */
export function saveToSlot(slot, ecosystem, meta = {}) {
  try {
    const payload = buildPayload(ecosystem, meta);
    localStorage.setItem(keyOf(slot), JSON.stringify(payload));
    return { ok: true, meta: payload.meta, savedAt: payload.savedAt };
  } catch (err) {
    // QuotaExceededError sur les très grosses populations.
    return { ok: false, error: err && err.name === 'QuotaExceededError'
      ? 'Espace de stockage insuffisant — exportez plutôt un fichier.'
      : String(err && err.message || err) };
  }
}

export function loadFromSlot(slot) {
  const raw = localStorage.getItem(keyOf(slot));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return validate(data) ? data : null;
  } catch {
    return null;
  }
}

export function deleteSlot(slot) {
  localStorage.removeItem(keyOf(slot));
}

/** Métadonnées de chaque emplacement, pour l'affichage des boutons. */
export function listSlots() {
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const raw = localStorage.getItem(keyOf(i));
    if (!raw) { out.push({ slot: i, empty: true }); continue; }
    try {
      const data = JSON.parse(raw);
      out.push({
        slot: i,
        empty: false,
        savedAt: data.savedAt,
        meta: data.meta || {},
        bytes: raw.length,
      });
    } catch {
      out.push({ slot: i, empty: true, corrupted: true });
    }
  }
  return out;
}

export function validate(data) {
  return !!(data && data.app === 'genesis' && data.world && data.world.creatures && data.world.species);
}

/** Déclenche le téléchargement d'un fichier de sauvegarde. */
export function exportToFile(ecosystem, meta = {}) {
  const payload = buildPayload(ecosystem, meta);
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `genesis-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return payload;
}

/** @param {File} file @returns {Promise<object>} */
export function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!validate(data)) throw new Error('Fichier de sauvegarde invalide');
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsText(file);
  });
}

/** Préférences d'interface (panneaux, options d'affichage). */
export const prefs = {
  read(defaults = {}) {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('genesis.prefs') || '{}') };
    } catch {
      return { ...defaults };
    }
  },
  write(value) {
    try {
      localStorage.setItem('genesis.prefs', JSON.stringify(value));
    } catch { /* stockage indisponible : on ignore */ }
  },
};
