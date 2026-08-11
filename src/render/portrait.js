/**
 * Portrait animé d'une créature, à partir de son seul génome.
 * Partagé par l'inspecteur et l'éditeur d'espèces.
 */
import { TAU, clamp01 } from '../core/utils.js';
import { drawAnatomy, LOD } from './anatomy.js';

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

  // Même fonction de dessin que dans le monde : le portrait ne peut pas
  // montrer une anatomie que la simulation ne rendrait pas.
  drawAnatomy(ctx, genome, r, phase, { detail: LOD.FULL, fine: true, hue, sat, light });

  ctx.restore();
}
