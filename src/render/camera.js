/** Caméra 2D : panoramique, zoom, suivi de cible et secousses. */
import { clamp, damp } from '../core/utils.js';

export class Camera {
  constructor(worldWidth, worldHeight) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.x = worldWidth / 2;
    this.y = worldHeight / 2;
    this.zoom = 0.5;
    this.targetZoom = 0.5;
    this.minZoom = 0.18;
    // Le terrain est pré-rendu à raison d'un pixel par unité monde :
    // au-delà de ×4, l'agrandissement deviendrait visiblement flou.
    this.maxZoom = 4;
    this.follow = null;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.viewWidth = 1;
    this.viewHeight = 1;
  }

  setViewport(w, h) {
    this.viewWidth = w;
    this.viewHeight = h;
    this.minZoom = Math.min(0.18, Math.min(w / this.worldWidth, h / this.worldHeight) * 0.9);
  }

  /**
   * Cadrage initial. Un ajustement strict laisserait de larges bandes vides
   * dès que le format de l'écran s'éloigne de celui du monde : on interpole
   * donc entre « tout voir » et « tout remplir ».
   */
  fitWorld(fill = 0.55) {
    const fit = Math.min(this.viewWidth / this.worldWidth, this.viewHeight / this.worldHeight);
    const cover = Math.max(this.viewWidth / this.worldWidth, this.viewHeight / this.worldHeight);
    this.targetZoom = clamp(fit + (cover - fit) * fill, this.minZoom, this.maxZoom);
    this.zoom = this.targetZoom;
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
  }

  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    // Applique immédiatement pour ancrer le point sous le curseur.
    const prev = this.zoom;
    this.zoom = this.targetZoom;
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.zoom = prev;
    this.clampPosition();
  }

  panByScreen(dx, dy) {
    this.follow = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampPosition();
  }

  clampPosition() {
    // On autorise un débord d'un quart d'écran pour éviter l'effet « mur ».
    const halfW = this.viewWidth / (2 * this.zoom);
    const halfH = this.viewHeight / (2 * this.zoom);
    const marginX = Math.max(0, halfW * 0.25);
    const marginY = Math.max(0, halfH * 0.25);
    this.x = clamp(this.x, -marginX, this.worldWidth + marginX);
    this.y = clamp(this.y, -marginY, this.worldHeight + marginY);
  }

  update(dt) {
    if (this.follow) {
      if (!this.follow.alive) {
        this.follow = null;
      } else {
        this.x = damp(this.x, this.follow.x, 7, dt);
        this.y = damp(this.y, this.follow.y, 7, dt);
      }
    }
    this.zoom = damp(this.zoom, this.targetZoom, 9, dt);
    if (this.shake > 0.001) {
      this.shake = damp(this.shake, 0, 4, dt);
      this.shakeX = (Math.random() - 0.5) * this.shake * 26;
      this.shakeY = (Math.random() - 0.5) * this.shake * 26;
    } else {
      this.shakeX = this.shakeY = 0;
    }
    this.clampPosition();
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Applique la transformation monde -> écran sur un contexte 2D. */
  apply(ctx) {
    ctx.translate(this.viewWidth / 2 + this.shakeX, this.viewHeight / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewHeight / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewHeight / 2,
    };
  }

  /** Rectangle du monde actuellement visible (avec marge). */
  visibleBounds(margin = 60) {
    const halfW = this.viewWidth / (2 * this.zoom) + margin;
    const halfH = this.viewHeight / (2 * this.zoom) + margin;
    return {
      minX: this.x - halfW,
      maxX: this.x + halfW,
      minY: this.y - halfH,
      maxY: this.y + halfH,
    };
  }
}
