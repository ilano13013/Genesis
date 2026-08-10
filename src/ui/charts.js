/**
 * Graphiques légers dessinés au canvas (aucune dépendance).
 * Toutes les fonctions gèrent elles-mêmes la densité de pixels.
 */

function prepare(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round((rect.height || canvas.height) * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height || canvas.height / dpr);
  return { ctx, w: rect.width, h: (rect.height || canvas.height / dpr) };
}

const NICE_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceMax(v) {
  if (v <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / base;
  for (const s of NICE_STEPS) if (n <= s) return s * base;
  return 10 * base;
}

function grid(ctx, w, h, max, lines = 3) {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < lines; i++) {
    const y = Math.round((h * i) / lines) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(formatShort(max), 4, 3);
}

function formatShort(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toString();
}

/**
 * Aires empilées + ligne de total.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{data:number[], color:string, fill:string}>} series
 */
export function drawStacked(canvas, series, options = {}) {
  const { ctx, w, h } = prepare(canvas);
  const n = series[0] ? series[0].data.length : 0;
  if (n < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillText('Collecte des données…', 8, h / 2);
    return;
  }

  let max = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const s of series) sum += s.data[i] || 0;
    if (sum > max) max = sum;
  }
  max = niceMax(max * 1.08);
  grid(ctx, w, h, max);

  const dx = w / (n - 1);
  const totals = new Float32Array(n);

  for (const s of series) {
    ctx.beginPath();
    ctx.moveTo(0, h - (totals[0] / max) * h);
    for (let i = 0; i < n; i++) {
      const y = h - ((totals[i] + (s.data[i] || 0)) / max) * h;
      ctx.lineTo(i * dx, y);
    }
    for (let i = n - 1; i >= 0; i--) {
      ctx.lineTo(i * dx, h - (totals[i] / max) * h);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, s.fill);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = h - ((totals[i] + (s.data[i] || 0)) / max) * h;
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * dx, y);
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    for (let i = 0; i < n; i++) totals[i] += s.data[i] || 0;
  }

  if (options.totalColor) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = h - (totals[i] / max) * h;
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * dx, y);
    }
    ctx.strokeStyle = options.totalColor;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Courbe simple remplie. */
export function drawArea(canvas, data, color = '#7ef0d0', fill = 'rgba(126,240,208,0.28)') {
  const { ctx, w, h } = prepare(canvas);
  const n = data.length;
  if (n < 2) return;
  let max = 0;
  for (let i = 0; i < n; i++) if (data[i] > max) max = data[i];
  max = niceMax(max * 1.1);
  grid(ctx, w, h, max, 2);

  const dx = w / (n - 1);
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) ctx.lineTo(i * dx, h - (data[i] / max) * h);
  ctx.lineTo(w, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, fill);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const y = h - (data[i] / max) * h;
    i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * dx, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Mini-courbe des cartes d'espèces. */
export function drawSparkline(canvas, data, color) {
  const { ctx, w, h } = prepare(canvas);
  const n = data.length;
  if (n < 2) return;
  let max = 1;
  for (let i = 0; i < n; i++) if (data[i] > max) max = data[i];
  const dx = w / (n - 1);
  const pad = 2;
  const y = (v) => h - pad - (v / max) * (h - pad * 2);

  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) ctx.lineTo(i * dx, y(data[i]));
  ctx.lineTo(w, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color.replace(')', ' / 0.35)').replace('hsl(', 'hsl('));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    i === 0 ? ctx.moveTo(0, y(data[i])) : ctx.lineTo(i * dx, y(data[i]));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Point de tête
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(w - 1, y(data[n - 1]), 1.8, 0, Math.PI * 2);
  ctx.fill();
}
