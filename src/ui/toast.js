/** Notifications éphémères empilées en haut de l'écran. */
const ICONS = {
  info: 'ℹ️', success: '✅', warn: '⚠️', danger: '⛔',
  speciation: '🧬', species: '🐾', save: '💾', world: '🌍',
};

let container = null;
const MAX_VISIBLE = 4;

export function initToasts(el) {
  container = el;
}

export function toast(text, type = 'info', duration = 3200) {
  if (!container) return;
  // Évite les avalanches de notifications aux vitesses élevées.
  while (container.children.length >= MAX_VISIBLE) {
    container.firstElementChild.remove();
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ic">${ICONS[type] || ICONS.info}</span><span></span>`;
  el.lastElementChild.textContent = text;
  container.appendChild(el);

  const timer = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 360);
  }, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    el.remove();
  });
  return el;
}

export function clearToasts() {
  if (container) container.innerHTML = '';
}
