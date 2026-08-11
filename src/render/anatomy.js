/**
 * Dessin d'une créature à partir de son génome.
 *
 * Chaque gène de morphologie a ici sa traduction graphique : l'élancement
 * étire le corps, les pattes battent, la carapace se plaque en écailles, les
 * nageoires s'ouvrent, les cornes se recourbent, la crête se hérisse et le
 * motif zèbre la peau. Comme ces mêmes gènes pèsent sur la survie, ce qu'on
 * voit à l'écran *est* ce que la sélection est en train de fabriquer.
 *
 * La fonction est partagée par le rendu du monde et par les portraits de
 * l'interface : une créature ne peut pas se dessiner de deux façons.
 *
 * Le contexte doit déjà être translaté sur la créature et tourné dans son
 * sens de marche (l'axe +x pointe vers l'avant).
 */
import { TAU } from '../core/utils.js';

/** Niveaux de détail. */
export const LOD = { DOT: 0, SIMPLE: 1, FULL: 2 };

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} g génome
 * @param {number} r rayon de référence
 * @param {number} phase phase d'animation
 * @param {object} opts {detail, hue, sat, light, fine}
 */
export function drawAnatomy(ctx, g, r, phase, opts) {
  const detail = opts.detail ?? LOD.FULL;
  const hue = opts.hue, sat = opts.sat, light = opts.light;
  const fine = opts.fine !== false && detail === LOD.FULL;

  const elong = g.elongation;
  const len = r * 1.05 * elong;                 // demi-longueur du corps
  const wid = (r * 0.88) / Math.sqrt(elong);    // demi-largeur
  const body = `hsl(${hue} ${sat}% ${light}%)`;
  const dark = `hsl(${hue} ${sat}% ${Math.max(10, light - 14)}%)`;

  // ── ombre portée
  ctx.fillStyle = 'rgba(8, 14, 22, 0.28)';
  ctx.beginPath();
  ctx.ellipse(r * 0.14, r * 0.42, len * 1.02, wid * 0.72, 0, 0, TAU);
  ctx.fill();

  const swing = Math.sin(phase * 1.6);

  // ── queue et nageoire caudale
  const tailLen = len * (1.5 + g.fins * 0.5);
  ctx.strokeStyle = body;
  ctx.lineWidth = wid * 0.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len * 0.78, 0);
  ctx.quadraticCurveTo(-tailLen * 0.75, swing * wid * 0.7, -tailLen, swing * wid * 1.15);
  ctx.stroke();

  if (g.fins > 0.18) {
    // Caudale : deux lobes qui s'ouvrent avec le gène.
    const f = g.fins;
    const tx = -tailLen, ty = swing * wid * 1.15;
    ctx.fillStyle = `hsla(${hue} ${sat + 12}% ${light + 14}% / 0.8)`;
    ctx.beginPath();
    ctx.moveTo(tx + wid * 0.3, ty);
    ctx.lineTo(tx - wid * 0.9 * f, ty - wid * (0.5 + f * 1.3));
    ctx.lineTo(tx - wid * 0.35, ty);
    ctx.lineTo(tx - wid * 0.9 * f, ty + wid * (0.5 + f * 1.3));
    ctx.closePath();
    ctx.fill();

    // Dorsale
    if (detail === LOD.FULL) {
      ctx.beginPath();
      ctx.moveTo(-len * 0.1, -wid * 0.8);
      ctx.lineTo(len * 0.05, -wid * (0.9 + f * 1.5));
      ctx.lineTo(len * 0.45, -wid * 0.75);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── pattes
  const pairs = Math.max(0, Math.round(g.limbs));
  if (pairs > 0 && detail >= LOD.SIMPLE) {
    const legSwing = Math.sin(phase * 2.2) * wid * 0.5;
    ctx.fillStyle = dark;
    ctx.beginPath();
    for (let i = 0; i < pairs; i++) {
      // Réparties de l'épaule à la hanche.
      const t = pairs === 1 ? 0 : i / (pairs - 1) - 0.5;
      const lx = t * len * 0.95;
      const alt = i % 2 === 0 ? 1 : -1;
      const off = legSwing * alt;
      ctx.ellipse(lx + off * 0.5, -wid * 0.95, wid * 0.42, wid * 0.2, 0.5, 0, TAU);
      ctx.ellipse(lx - off * 0.5, wid * 0.95, wid * 0.42, wid * 0.2, -0.5, 0, TAU);
    }
    ctx.fill();
  }

  // ── corps
  const breathe = Math.sin(phase) * 0.06;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, len * (1 + breathe), wid * (1 - breathe), 0, 0, TAU);
  ctx.fill();

  // ── motif de camouflage
  if (fine && g.pattern > 0.22) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, len, wid, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = `hsla(${hue} ${Math.min(90, sat + 18)}% ${Math.max(8, light - 20)}% / ${(g.pattern * 0.5).toFixed(2)})`;
    if (g.pattern > 0.6) {
      // Rayures : franches, pour les fortes valeurs.
      const bands = 3 + Math.round(g.pattern * 3);
      for (let i = 0; i < bands; i++) {
        const x = -len + ((i + 0.5) / bands) * len * 2;
        ctx.fillRect(x - len * 0.06, -wid, len * 0.12, wid * 2);
      }
    } else {
      // Taches : plus discrètes.
      for (let i = 0; i < 5; i++) {
        const x = -len * 0.7 + (i / 4) * len * 1.4;
        const y = (i % 2 ? 1 : -1) * wid * 0.38;
        ctx.beginPath();
        ctx.ellipse(x, y, wid * 0.28, wid * 0.22, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── ventre clair
  ctx.fillStyle = `hsla(${hue} ${sat}% ${Math.min(90, light + 24)}% / 0.5)`;
  ctx.beginPath();
  ctx.ellipse(-len * 0.08, wid * 0.28, len * 0.72, wid * 0.44, 0, 0, TAU);
  ctx.fill();

  // ── carapace : écailles plaquées sur le dos
  if (g.armor > 0.12) {
    const plates = 2 + Math.round(g.armor * 4);
    const a = 0.35 + g.armor * 0.5;
    ctx.strokeStyle = `hsla(${(hue + 200) % 360} 12% ${28 + g.armor * 22}% / ${a.toFixed(2)})`;
    ctx.lineWidth = wid * (0.16 + g.armor * 0.2);
    ctx.beginPath();
    for (let i = 0; i < plates; i++) {
      const x = -len * 0.75 + (i / (plates - 1 || 1)) * len * 1.4;
      const h = wid * (0.85 + g.armor * 0.25);
      ctx.moveTo(x, -h);
      ctx.quadraticCurveTo(x + len * 0.1, 0, x, h);
    }
    ctx.stroke();
  }

  // ── crête de parade
  if (fine && g.crest > 0.18) {
    const spikes = 3 + Math.round(g.crest * 4);
    ctx.fillStyle = `hsl(${(hue + 42) % 360} ${Math.min(95, sat + 28)}% ${Math.min(78, light + 22)}%)`;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const x = -len * 0.5 + (i / (spikes - 1 || 1)) * len * 1.1;
      const h = wid * (0.5 + g.crest * 1.4) * (1 - Math.abs(i / (spikes - 1 || 1) - 0.5));
      ctx.moveTo(x - wid * 0.16, -wid * 0.75);
      ctx.lineTo(x, -wid * 0.75 - h);
      ctx.lineTo(x + wid * 0.16, -wid * 0.75);
    }
    ctx.fill();
  }

  if (detail < LOD.SIMPLE) return;

  // ── tête
  const hx = len * 0.86;
  const hr = wid * 0.66;
  ctx.fillStyle = `hsl(${hue} ${sat}% ${Math.min(92, light + 8)}%)`;
  ctx.beginPath();
  ctx.arc(hx, 0, hr, 0, TAU);
  ctx.fill();

  // ── cornes
  if (g.horns > 0.12) {
    const hl = hr * (0.9 + g.horns * 2.2);
    ctx.strokeStyle = '#f0e6d2';
    ctx.lineWidth = Math.max(0.6, hr * (0.2 + g.horns * 0.22));
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(hx + hr * 0.1, side * hr * 0.55);
      ctx.quadraticCurveTo(hx + hl * 0.7, side * hr * (0.9 + g.horns), hx + hl, side * hr * 0.35);
    }
    ctx.stroke();
  }

  if (detail < LOD.FULL) return;

  // ── yeux
  const eyeR = Math.max(0.7, hr * 0.28);
  ctx.fillStyle = '#f7fbff';
  ctx.beginPath();
  ctx.arc(hx + hr * 0.34, -hr * 0.42, eyeR, 0, TAU);
  ctx.arc(hx + hr * 0.34, hr * 0.42, eyeR, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#14181f';
  ctx.beginPath();
  ctx.arc(hx + hr * 0.44, -hr * 0.42, eyeR * 0.55, 0, TAU);
  ctx.arc(hx + hr * 0.44, hr * 0.42, eyeR * 0.55, 0, TAU);
  ctx.fill();

  // ── crocs
  if (g.carnivory > 0.62) {
    ctx.fillStyle = '#fff7e8';
    ctx.beginPath();
    ctx.moveTo(hx + hr * 0.75, -hr * 0.2);
    ctx.lineTo(hx + hr * 1.3, 0);
    ctx.lineTo(hx + hr * 0.75, hr * 0.2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.lineCap = 'butt';
}
