/**
 * Climat : cycle jour/nuit, saisons et météo dynamique.
 * Tout est exprimé en « secondes de simulation ».
 */
import { clamp01, lerp, damp, TAU } from '../core/utils.js';

export const SEASONS = [
  { key: 'spring', name: 'Printemps', icon: '🌱', growth: 1.35, temp: 0.58, tint: [120, 210, 150] },
  { key: 'summer', name: 'Été', icon: '☀️', growth: 1.1, temp: 0.9, tint: [255, 226, 150] },
  { key: 'autumn', name: 'Automne', icon: '🍂', growth: 0.75, temp: 0.45, tint: [232, 150, 88] },
  { key: 'winter', name: 'Hiver', icon: '❄️', growth: 0.3, temp: 0.12, tint: [170, 205, 255] },
];

export const WEATHER = {
  clear: { key: 'clear', name: 'Ciel dégagé', icon: '☀️', growth: 1.0, light: 1.0, weight: 3.2 },
  cloudy: { key: 'cloudy', name: 'Nuageux', icon: '☁️', growth: 0.92, light: 0.78, weight: 2.4 },
  rain: { key: 'rain', name: 'Pluie', icon: '🌧️', growth: 1.45, light: 0.6, weight: 1.7 },
  storm: { key: 'storm', name: 'Orage', icon: '⛈️', growth: 1.25, light: 0.42, weight: 0.7 },
  fog: { key: 'fog', name: 'Brume', icon: '🌫️', growth: 1.02, light: 0.72, weight: 0.9 },
  snow: { key: 'snow', name: 'Neige', icon: '🌨️', growth: 0.25, light: 0.68, weight: 1.0 },
};

export class Climate {
  constructor(rng, { dayLength = 60, daysPerSeason = 4, time = 0 } = {}) {
    this.rng = rng;
    this.dayLength = dayLength;
    this.daysPerSeason = daysPerSeason;
    this.seasonLength = dayLength * daysPerSeason;
    this.yearLength = this.seasonLength * 4;
    this.time = time;

    this.weather = WEATHER.clear;
    this.nextWeather = WEATHER.clear;
    this.weatherBlend = 1;       // 0 -> transition en cours, 1 -> stabilisé
    this.weatherTimer = this.rng.range(20, 60);
    this.intensity = 0.5;
    this.windAngle = this.rng.range(0, TAU);
    this.windSpeed = this.rng.range(0.2, 0.7);
    this.lightning = 0;          // impulsion visuelle décroissante
    this.lightningCooldown = 2;
  }

  // ---------------------------------------------------------------- horloge

  /** Position dans la journée : 0 = minuit, 0.5 = midi. */
  get dayPhase() {
    return (this.time % this.dayLength) / this.dayLength;
  }

  get dayIndex() {
    return Math.floor(this.time / this.dayLength);
  }

  /** Index de saison courant (0..3). */
  get seasonIndex() {
    return Math.floor(this.time / this.seasonLength) % 4;
  }

  get season() {
    return SEASONS[this.seasonIndex];
  }

  /** Progression dans la saison courante (0..1). */
  get seasonProgress() {
    return (this.time % this.seasonLength) / this.seasonLength;
  }

  /** Saison suivante, pour lisser les transitions. */
  get nextSeason() {
    return SEASONS[(this.seasonIndex + 1) % 4];
  }

  /**
   * Lumière solaire 0 (nuit noire) -> 1 (plein midi).
   * Courbe adoucie aux aurores/crépuscules.
   */
  get sunlight() {
    const p = this.dayPhase;
    const raw = Math.sin((p - 0.25) * TAU) * 0.5 + 0.5; // max à 0.5 (midi)
    // Nuits un peu plus courtes en été, plus longues en hiver.
    const seasonBias = lerp(-0.1, 0.1, this.seasonTemp);
    return clamp01(Math.pow(raw, 0.85) * 1.08 + seasonBias * raw);
  }

  /** Température interpolée entre saisons, modulée par le jour et la météo. */
  get seasonTemp() {
    const a = SEASONS[this.seasonIndex].temp;
    const b = SEASONS[(this.seasonIndex + 1) % 4].temp;
    const t = this.seasonProgress;
    // Lissage cosinusoïdal sur la seconde moitié de saison.
    const w = t < 0.5 ? 0 : (t - 0.5) * 2;
    return lerp(a, b, w * w * (3 - 2 * w));
  }

  get temperature() {
    const daily = (this.sunlight - 0.45) * 0.22;
    const weatherMod = this.weather.key === 'snow' ? -0.12 : this.weather.key === 'rain' ? -0.06 : 0;
    return clamp01(this.seasonTemp + daily + weatherMod);
  }

  /** Lumière effective (soleil × météo), utilisée par le rendu et la pousse. */
  get lightLevel() {
    return clamp01(this.sunlight * lerp(this.weather.light, this.nextWeather.light, 1 - this.weatherBlend));
  }

  get isNight() {
    return this.sunlight < 0.22;
  }

  /** Multiplicateur de croissance végétale (saison × météo × lumière). */
  get growthFactor() {
    const w = lerp(this.weather.growth, this.nextWeather.growth, 1 - this.weatherBlend);
    const season = lerp(
      SEASONS[this.seasonIndex].growth,
      SEASONS[(this.seasonIndex + 1) % 4].growth,
      Math.max(0, this.seasonProgress - 0.6) / 0.4
    );
    const light = 0.35 + this.sunlight * 0.85;
    return season * w * light;
  }

  /** Intensité de précipitation utilisée par les effets de particules. */
  get precipitation() {
    const k = this.weather.key;
    if (k === 'rain') return this.intensity;
    if (k === 'storm') return 0.7 + this.intensity * 0.5;
    if (k === 'snow') return this.intensity * 0.85;
    return 0;
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;
    this.weatherTimer -= dt;
    this.lightningCooldown -= dt;
    this.lightning = Math.max(0, this.lightning - dt * 3.5);

    if (this.weatherBlend < 1) {
      this.weatherBlend = Math.min(1, this.weatherBlend + dt * 0.25);
      if (this.weatherBlend >= 1) this.weather = this.nextWeather;
    }

    if (this.weatherTimer <= 0) this._rollWeather();

    // Le vent dérive lentement ; les rafales suivent la violence du temps.
    this.windAngle += this.rng.gauss(0, 0.05) * Math.min(dt, 0.5);
    const targetWind = this.weather.key === 'storm' ? 1.4 : this.weather.key === 'rain' ? 0.8 : 0.4;
    this.windSpeed = damp(this.windSpeed, targetWind, 0.4, Math.min(dt, 1));

    if (this.weather.key === 'storm' && this.lightningCooldown <= 0) {
      if (this.rng.chance(1 - Math.exp(-dt * 0.5))) {
        this.lightning = 1;
        this.lightningCooldown = this.rng.range(1.5, 6);
      }
    }
  }

  _rollWeather() {
    const temp = this.seasonTemp;
    const pool = [];
    for (const key in WEATHER) {
      const w = WEATHER[key];
      let weight = w.weight;
      // La neige n'apparaît que par temps froid, l'inverse pour le ciel clair.
      if (key === 'snow') weight *= Math.max(0, 1 - temp * 3.2);
      if (key === 'clear') weight *= 0.5 + temp;
      if (key === 'rain') weight *= 0.6 + (1 - Math.abs(temp - 0.55) * 1.6);
      if (key === 'storm') weight *= 0.3 + temp * 1.4;
      if (key === 'fog') weight *= 0.6 + (1 - temp) * 0.9;
      if (weight > 0) pool.push([w, weight]);
    }
    let total = 0;
    for (const [, wt] of pool) total += wt;
    let r = this.rng.next() * total;
    let chosen = pool[0][0];
    for (const [w, wt] of pool) {
      r -= wt;
      if (r <= 0) { chosen = w; break; }
    }
    this.nextWeather = chosen;
    this.weatherBlend = 0;
    this.intensity = this.rng.range(0.35, 1);
    this.weatherTimer = this.rng.range(35, 110);
  }

  /** Force une météo donnée (utilisé par l'interface). */
  setWeather(key) {
    const w = WEATHER[key];
    if (!w) return;
    this.nextWeather = w;
    this.weatherBlend = 0;
    this.weatherTimer = this.rng.range(40, 90);
  }

  serialize() {
    return {
      time: this.time,
      dayLength: this.dayLength,
      daysPerSeason: this.daysPerSeason,
      weather: this.weather.key,
      nextWeather: this.nextWeather.key,
      weatherBlend: this.weatherBlend,
      weatherTimer: this.weatherTimer,
      intensity: this.intensity,
      windAngle: this.windAngle,
      windSpeed: this.windSpeed,
    };
  }

  deserialize(d) {
    this.time = d.time || 0;
    this.dayLength = d.dayLength || 60;
    this.daysPerSeason = d.daysPerSeason || 4;
    this.seasonLength = this.dayLength * this.daysPerSeason;
    this.yearLength = this.seasonLength * 4;
    this.weather = WEATHER[d.weather] || WEATHER.clear;
    this.nextWeather = WEATHER[d.nextWeather] || this.weather;
    this.weatherBlend = d.weatherBlend ?? 1;
    this.weatherTimer = d.weatherTimer ?? 30;
    this.intensity = d.intensity ?? 0.5;
    this.windAngle = d.windAngle ?? 0;
    this.windSpeed = d.windSpeed ?? 0.4;
    return this;
  }
}
