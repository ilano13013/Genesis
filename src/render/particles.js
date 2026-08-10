/**
 * Système de particules à pool fixe.
 *
 * Tout est stocké dans des tableaux typés parallèles : pas d'allocation par
 * particule, un seul balayage linéaire par image, et un budget de rendu
 * constant quel que soit le nombre d'événements de la simulation.
 */
import { TAU, clamp01, hslToRgb } from '../core/utils.js';

export const PK = {
  SPARK: 0,   // naissance : étincelle qui monte
  PUFF: 1,    // mort : bouffée qui se dissipe
  BLOOD: 2,   // morsure : gouttelettes lourdes
  LEAF: 3,    // broutage : fragments de végétation
  SPLASH: 4,  // eau : gouttes rebondissantes
  FIREFLY: 5, // ambiance nocturne
  DUST: 6,    // course : poussière soulevée
  RING: 7,    // spéciation : onde circulaire
};

export class Particles {
  constructor(capacity = 1400) {
    this.capacity = capacity;
    this.count = 0;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.r = new Uint8Array(capacity);
    this.g = new Uint8Array(capacity);
    this.b = new Uint8Array(capacity);
  }

  get length() {
    return this.count;
  }

  clear() {
    this.count = 0;
  }

  _alloc() {
    if (this.count < this.capacity) return this.count++;
    // Pool saturé : on recycle la particule la plus avancée dans sa vie.
    let worst = 0, worstRatio = 1e9;
    for (let i = 0; i < this.capacity; i += 7) {
      const ratio = this.life[i] / this.maxLife[i];
      if (ratio < worstRatio) { worstRatio = ratio; worst = i; }
    }
    return worst;
  }

  spawn(kind, x, y, vx, vy, life, size, rgb, spin = 0) {
    const i = this._alloc();
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.rot[i] = Math.random() * TAU;
    this.spin[i] = spin;
    this.r[i] = rgb[0];
    this.g[i] = rgb[1];
    this.b[i] = rgb[2];
    return i;
  }

  /** Naissance : gerbe d'étincelles chaudes. */
  birth(x, y, hue) {
    const rgb = hslToRgb(hue, 0.85, 0.72);
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * TAU;
      const s = 18 + Math.random() * 42;
      this.spawn(PK.SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s - 20,
        0.5 + Math.random() * 0.5, 1.6 + Math.random() * 1.8, rgb);
    }
    this.spawn(PK.RING, x, y, 0, 0, 0.55, 5, hslToRgb(hue, 0.9, 0.8));
  }

  /** Mort : bouffée sombre + quelques particules qui retombent. */
  death(x, y, hue, size) {
    const rgb = hslToRgb(hue, 0.35, 0.42);
    for (let k = 0; k < 9; k++) {
      const a = Math.random() * TAU;
      const s = 8 + Math.random() * 26;
      this.spawn(PK.PUFF, x, y, Math.cos(a) * s, Math.sin(a) * s - 6,
        0.9 + Math.random() * 0.8, (2.5 + Math.random() * 4) * size, rgb);
    }
  }

  bite(x, y) {
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * TAU;
      const s = 30 + Math.random() * 70;
      this.spawn(PK.BLOOD, x, y, Math.cos(a) * s, Math.sin(a) * s - 30,
        0.35 + Math.random() * 0.4, 1.4 + Math.random() * 1.6, [206, 58, 66]);
    }
  }

  graze(x, y) {
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * TAU;
      this.spawn(PK.LEAF, x, y, Math.cos(a) * 16, Math.sin(a) * 16 - 14,
        0.6 + Math.random() * 0.5, 1.5 + Math.random() * 1.4,
        [110 + Math.random() * 50 | 0, 170 + Math.random() * 50 | 0, 80], (Math.random() - 0.5) * 8);
    }
  }

  splash(x, y) {
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
      const s = 20 + Math.random() * 50;
      this.spawn(PK.SPLASH, x, y, Math.cos(a) * s, Math.sin(a) * s,
        0.4 + Math.random() * 0.3, 1.2 + Math.random(), [176, 224, 255]);
    }
  }

  dust(x, y, hue = 40) {
    this.spawn(PK.DUST, x, y, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12 - 4,
      0.5 + Math.random() * 0.4, 2 + Math.random() * 2.5, hslToRgb(hue, 0.3, 0.7));
  }

  firefly(x, y) {
    this.spawn(PK.FIREFLY, x, y, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14,
      2.5 + Math.random() * 3, 1.4 + Math.random() * 1.2, [255, 236, 140]);
  }

  speciation(x, y, hue) {
    const rgb = hslToRgb(hue, 0.95, 0.72);
    this.spawn(PK.RING, x, y, 0, 0, 1.1, 8, rgb);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      this.spawn(PK.SPARK, x, y, Math.cos(a) * 60, Math.sin(a) * 60, 0.9, 2.2, rgb);
    }
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Compaction : on remplace par la dernière particule vivante.
        n--;
        if (i !== n) {
          this.x[i] = this.x[n]; this.y[i] = this.y[n];
          this.vx[i] = this.vx[n]; this.vy[i] = this.vy[n];
          this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n];
          this.size[i] = this.size[n]; this.rot[i] = this.rot[n];
          this.spin[i] = this.spin[n]; this.kind[i] = this.kind[n];
          this.r[i] = this.r[n]; this.g[i] = this.g[n]; this.b[i] = this.b[n];
        }
        i--;
        continue;
      }
      const k = this.kind[i];
      let drag = 0.86, gravity = 0;
      switch (k) {
        case PK.SPARK: gravity = -32; drag = 0.9; break;
        case PK.PUFF: gravity = -10; drag = 0.82; break;
        case PK.BLOOD: gravity = 150; drag = 0.94; break;
        case PK.LEAF: gravity = 26; drag = 0.9; break;
        case PK.SPLASH: gravity = 190; drag = 0.96; break;
        case PK.FIREFLY: gravity = 0; drag = 0.99; break;
        case PK.DUST: gravity = -6; drag = 0.88; break;
        case PK.RING: drag = 1; break;
      }
      if (k === PK.FIREFLY) {
        // Vol erratique caractéristique.
        this.vx[i] += (Math.random() - 0.5) * 40 * dt;
        this.vy[i] += (Math.random() - 0.5) * 40 * dt;
      }
      this.vy[i] += gravity * dt;
      const f = Math.pow(drag, dt * 60);
      this.vx[i] *= f;
      this.vy[i] *= f;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
  }

  /** Rendu en espace monde (la transformation caméra est déjà appliquée). */
  draw(ctx, bounds) {
    const n = this.count;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const x = this.x[i], y = this.y[i];
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
      const t = clamp01(this.life[i] / this.maxLife[i]);
      const k = this.kind[i];
      const rgb = `${this.r[i]},${this.g[i]},${this.b[i]}`;

      if (k === PK.RING) {
        const radius = this.size[i] + (1 - t) * 46;
        ctx.globalAlpha = t * 0.6;
        ctx.strokeStyle = `rgba(${rgb},1)`;
        ctx.lineWidth = 1.6 + t * 2.4;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.stroke();
        continue;
      }

      const size = k === PK.PUFF ? this.size[i] * (1.6 - t) : this.size[i] * (0.4 + t * 0.8);
      if (k === PK.FIREFLY) {
        const pulse = 0.55 + 0.45 * Math.sin(this.rot[i] * 6 + i);
        ctx.globalAlpha = t * pulse * 0.9;
        ctx.fillStyle = `rgba(${rgb},1)`;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.4, 0, TAU);
        ctx.globalAlpha = t * pulse * 0.18;
        ctx.fill();
        ctx.globalAlpha = t * pulse;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.8, 0, TAU);
        ctx.fill();
        continue;
      }

      ctx.globalAlpha = k === PK.PUFF ? t * 0.45 : t * 0.92;
      ctx.fillStyle = `rgba(${rgb},1)`;
      if (k === PK.LEAF) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.rot[i]);
        ctx.fillRect(-size, -size * 0.45, size * 2, size * 0.9);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
