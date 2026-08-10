/** Fonctions utilitaires : maths, couleurs, formatage. */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Interpolation exponentielle indépendante du pas de temps. */
export function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Différence d'angles ramenée dans [-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rapproche l'angle `a` de `b` d'au plus `maxStep` radians. */
export function turnToward(a, b, maxStep) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};

/** Conversion HSL -> chaîne CSS (h en degrés). */
export function hsl(h, s, l, a = 1) {
  return a >= 1
    ? `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`
    : `hsla(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}% / ${a.toFixed(3)})`;
}

/** HSL (h:0-360, s/l:0-1) -> [r,g,b] entiers 0-255. */
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Mélange deux couleurs [r,g,b]. */
export function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

export const rgbCss = (c, a = 1) =>
  a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** 1234567 -> "1.23 M" */
export function formatNumber(n) {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' G';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + ' k';
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

/** Durée en secondes de simulation -> "3 j 04:12". */
export function formatSimTime(seconds, dayLength) {
  const days = Math.floor(seconds / dayLength);
  const frac = (seconds % dayLength) / dayLength;
  const hours = Math.floor(frac * 24);
  const minutes = Math.floor(((frac * 24) % 1) * 60);
  return `J${days} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Moyenne d'un tableau (0 si vide). */
export function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** Encodage base64 d'un Uint8Array (navigateur + Node). */
export function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
