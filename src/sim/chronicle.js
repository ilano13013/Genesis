/**
 * Chronique du monde.
 *
 * Le simulateur ne raconte rien de lui-même : il se contente d'enregistrer ce
 * qui arrive. La chronique est donc la seule « narration » du projet, et elle
 * est entièrement dérivée de l'état — fondations, découvertes, famines,
 * raids, effondrements. C'est ce qui fait qu'une partie se lit après coup.
 */

export const CHRONICLE_KINDS = {
  sapience: { icon: '✨', label: 'Éveil', weight: 5 },
  founding: { icon: '🏛️', label: 'Fondation', weight: 4 },
  tech: { icon: '💡', label: 'Découverte', weight: 3 },
  era: { icon: '🌅', label: 'Âge', weight: 5 },
  trade: { icon: '🐫', label: 'Commerce', weight: 2 },
  growth: { icon: '📈', label: 'Essor', weight: 2 },
  famine: { icon: '🍂', label: 'Famine', weight: 3 },
  raid: { icon: '⚔️', label: 'Conflit', weight: 4 },
  collapse: { icon: '🕯️', label: 'Effondrement', weight: 5 },
  schism: { icon: '🧬', label: 'Schisme', weight: 4 },
  extinction: { icon: '💀', label: 'Extinction', weight: 5 },
  nature: { icon: '🌍', label: 'Nature', weight: 1 },
};

const MAX_ENTRIES = 400;

export class Chronicle {
  constructor() {
    this.entries = [];
    this.nextId = 1;
    this._pending = [];   // ce que l'interface n'a pas encore lu
  }

  /**
   * @param {string} kind clé de CHRONICLE_KINDS
   * @param {string} text phrase déjà rédigée
   * @param {object} [meta] {time, x, y, peopleId, settlementId}
   */
  add(kind, text, meta = {}) {
    const entry = {
      id: this.nextId++,
      kind,
      text,
      time: meta.time ?? 0,
      x: meta.x ?? null,
      y: meta.y ?? null,
      peopleId: meta.peopleId ?? null,
      settlementId: meta.settlementId ?? null,
      hue: meta.hue ?? null,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    // Seuls les événements marquants remontent en notification.
    if ((CHRONICLE_KINDS[kind]?.weight ?? 0) >= 3) this._pending.push(entry);
    return entry;
  }

  /** Événements notables non encore affichés. */
  drainPending(limit = 3) {
    if (this._pending.length === 0) return [];
    const out = this._pending.slice(-limit);
    this._pending.length = 0;
    return out;
  }

  /** Les `n` derniers événements, du plus récent au plus ancien. */
  latest(n = 60, kinds = null) {
    const out = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < n; i--) {
      const e = this.entries[i];
      if (kinds && !kinds.has(e.kind)) continue;
      out.push(e);
    }
    return out;
  }

  serialize() {
    return this.entries.slice(-200).map((e) => [
      e.kind, e.text, Math.round(e.time), e.x === null ? null : Math.round(e.x),
      e.y === null ? null : Math.round(e.y), e.peopleId, e.hue === null ? null : Math.round(e.hue),
    ]);
  }

  deserialize(rows) {
    this.entries.length = 0;
    this.nextId = 1;
    for (const [kind, text, time, x, y, peopleId, hue] of rows || []) {
      this.entries.push({
        id: this.nextId++, kind, text, time, x, y, peopleId, hue, settlementId: null,
      });
    }
    this._pending.length = 0;
  }
}
