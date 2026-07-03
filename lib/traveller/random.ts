// Randomness. The primary abstraction is an explicit, ownable `Rng` object so a
// chargen run OWNS its stream instead of relying on hidden global state. An
// unseeded Rng draws from Math.random (non-deterministic, the production
// default); a seeded one runs a mulberry32 stream whose whole state is a single
// uint32, and clone() forks an independent stream at the same position (used by
// cloneCharacter and the seed+action replay log to reproduce a run exactly).
//
// `rndInt` / `arnd` / `roll` are free helpers over a fixed unseeded ambient
// default, kept so existing Math.random-mocking tests keep working; engine and
// chargen-replay code owns explicit Character.rng streams instead.

export class Rng {
  // null → draw from Math.random (unseeded). A number → mulberry32 state.
  private state: number | null;

  constructor(seed?: number) {
    this.state = seed === undefined ? null : seed >>> 0;
  }

  get seeded(): boolean {
    return this.state !== null;
  }

  /** An independent Rng at the same stream position. */
  clone(): Rng {
    const r = new Rng();
    r.state = this.state;
    return r;
  }

  /** One uniform draw in [0, 1). */
  next(): number {
    if (this.state === null) return Math.random();
    // mulberry32: fast, seedable, single-word state.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(a: readonly T[]): T {
    if (a.length === 0) throw new Error("Rng.pick called with empty array");
    return a[Math.floor(this.next() * a.length)] as T;
  }

  /** Sum of `rolls` six-sided dice. */
  roll(rolls: number): number {
    let total = 0;
    for (let i = 0; i < rolls; i++) total += Math.floor(this.next() * 6 + 1);
    return total;
  }
}

// Fixed ambient default backing the free helpers below. Unseeded (draws from
// Math.random) so existing Math.random-mocking tests keep working; engine and
// chargen-replay code owns explicit Rng streams (Character.rng) instead.
const defaultRng = new Rng();

export function rndInt(min: number, max: number): number {
  return defaultRng.int(min, max);
}

export function arnd<T>(a: readonly T[]): T {
  return defaultRng.pick(a);
}

/** Roll `rolls` six-sided dice and return the total. */
export function roll(rolls: number): number {
  return defaultRng.roll(rolls);
}
