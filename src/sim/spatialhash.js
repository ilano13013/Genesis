/**
 * Grille de partitionnement spatial uniforme.
 *
 * Reconstruite à chaque pas de simulation (O(n)), elle réduit la recherche de
 * voisins de O(n²) à O(n·k). Les tableaux de cellules sont réutilisés pour
 * éviter toute allocation en régime permanent.
 */
export class SpatialHash {
  constructor(width, height, cellSize = 128) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this._result = [];
  }

  clear() {
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].length) cells[i].length = 0;
    }
  }

  _cellIndex(x, y) {
    let cx = (x / this.cellSize) | 0;
    let cy = (y / this.cellSize) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(entity) {
    this.cells[this._cellIndex(entity.x, entity.y)].push(entity);
  }

  build(entities) {
    this.clear();
    for (let i = 0; i < entities.length; i++) this.insert(entities[i]);
  }

  /**
   * Candidats situés dans les cellules recouvrant le cercle (x, y, radius).
   * Le tableau retourné est réutilisé : à consommer avant l'appel suivant.
   */
  query(x, y, radius) {
    const out = this._result;
    out.length = 0;
    const cs = this.cellSize;
    let x0 = ((x - radius) / cs) | 0;
    let x1 = ((x + radius) / cs) | 0;
    let y0 = ((y - radius) / cs) | 0;
    let y1 = ((y + radius) / cs) | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1;
    if (y1 >= this.rows) y1 = this.rows - 1;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells[row + cx];
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }

  /** Variante sans tableau intermédiaire : applique `fn` à chaque candidat. */
  forEachNear(x, y, radius, fn) {
    const cs = this.cellSize;
    let x0 = ((x - radius) / cs) | 0;
    let x1 = ((x + radius) / cs) | 0;
    let y0 = ((y - radius) / cs) | 0;
    let y1 = ((y + radius) / cs) | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1;
    if (y1 >= this.rows) y1 = this.rows - 1;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells[row + cx];
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
    }
  }
}
