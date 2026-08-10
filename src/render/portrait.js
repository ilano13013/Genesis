/**
 * Portrait animé d'une créature, à partir de son seul génome.
 * Partagé par l'inspecteur et l'éditeur d'espèces.
 */
import { TAU, clamp01 } from '../core/utils.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} genome
 * @param {number} time  secondes (anime la queue et les pattes)
 * @param {object} opts  {width, height, energy, showAura}
 */
export function drawPortrait(ctx, genome, time, opts = {}) {
  const w = opts.width || ctx.canvas.width;
  const h = opts.height || ctx.canvas.height;
  const energy = opts.energy === undefined ? 1 : clamp01(opts.energy);

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const r = Math.min(w, h) * 0.19 * (0.62 + genome.size * 0.3);
  const hue = genome.hue | 0;
  const sat = (40 + genome.carnivory * 32 + energy * 18) | 0;
  const light = (34 + energy * 22) | 0;
  const body = `hsl(${hue} ${sat}% ${light}%)`;
  const phase = time * (1.2 + genome.speed / 90);

  ctx.translate(w / 2, h / 2 + r * 0.1);

  // Aura : rayon de vision suggéré
  if (opts.showAura !== false) {
    const vision = Math.min(w, h) * 0.46 * (genome.vision / 360);
    const grd = ctx.createRadialGradient(0, 0, r, 0, 0, Math.max(r + 1, vision));
    grd.addColorStop(0, `hsla(${hue} 80% 60% / 0.18)`);
    grd.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(r + 1, vision), 0, TAU);
    ctx.fill();
  }

  ctx.rotate(Math.sin(time * 0.5) * 0.12);

  const stretch = genome.carnivory > 0.55 ? 1.28 : 1.06;

  // Ombre
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(r * 0.2, r * 0.9, r * 1.1, r * 0.34, 0, 0, TAU);
  ctx.fill();

  // Queue
  const swing = Math.sin(phase * 1.6) * r * 0.6;
  ctx.strokeStyle = body;
  ctx.lineWidth = r * 0.42;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * stretch * 0.8, 0);
  ctx.quadraticCurveTo(-r * stretch * 1.4, swing * 0.6, -r * stretch * 1.95, swing);
  ctx.stroke();

  // Pattes
  const legSwing = Math.sin(phase * 2.2) * r * 0.42;
  ctx.fillStyle = `hsl(${hue} ${sat}% ${Math.max(12, light - 12)}%)`;
  ctx.beginPath();
  ctx.ellipse(legSwing * 0.4, -r * 0.74, r * 0.44, r * 0.22, 0.5, 0, TAU);
  ctx.ellipse(-legSwing * 0.4, r * 0.74, r * 0.44, r * 0.22, -0.5, 0, TAU);
  ctx.fill();

  // Corps
  const wobble = Math.sin(phase) * 0.07;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * stretch * (1 + wobble), r * (0.82 - wobble), 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = `hsla(${hue} ${sat}% ${Math.min(88, light + 24)}% / 0.55)`;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, r * 0.22, r * stretch * 0.72, r * 0.42, 0, 0, TAU);
  ctx.fill();

  // Tête
  const hx = r * stretch * 0.84;
  ctx.fillStyle = `hsl(${hue} ${sat}% ${Math.min(92, light + 8)}%)`;
  ctx.beginPath();
  ctx.arc(hx, 0, r * 0.58, 0, TAU);
  ctx.fill();

  // Yeux
  const eyeR = Math.max(1, r * 0.18);
  const blink = Math.sin(time * 1.3) > 0.985 ? 0.15 : 1;
  ctx.fillStyle = '#f7fbff';
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.24, -r * 0.27, eyeR, eyeR * blink, 0, 0, TAU);
  ctx.ellipse(hx + r * 0.24, r * 0.27, eyeR, eyeR * blink, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#14181f';
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.31, -r * 0.27, eyeR * 0.55, eyeR * 0.55 * blink, 0, 0, TAU);
  ctx.ellipse(hx + r * 0.31, r * 0.27, eyeR * 0.55, eyeR * 0.55 * blink, 0, 0, TAU);
  ctx.fill();

  // Crocs
  if (genome.carnivory > 0.62) {
    ctx.fillStyle = '#fff7e8';
    ctx.beginPath();
    ctx.moveTo(hx + r * 0.5, -r * 0.13);
    ctx.lineTo(hx + r * 0.82, 0);
    ctx.lineTo(hx + r * 0.5, r * 0.13);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
