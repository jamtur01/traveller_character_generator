// Randomness. The primary abstraction is an explicit, ownable `Rng` object so
// a chargen run can OWN its stream (the replayable log seeds one and snapshots
// its state to reproduce a run exactly) instead of relying on hidden global
// state. An unseeded Rng draws from Math.random (non-deterministic, the
// production default); a seeded one runs a mulberry32 stream whose whole state
// is a single uint32, so snapshot()/restore() capture and rewind it.
//
// `rndInt` / `arnd` / `roll` remain as free helpers over an ambient default
// Rng for call sites not yet threaded to an explicit stream (and so existing
// Math.random-mocking tests keep working). As the engine migrates to an
// explicitly-owned Rng (Character / chargen replay), the ambient shim retires.

export class Rng {
  // null → draw from Math.random (unseeded). A number → mulberry32 state.
  private state: number | null;

  constructor(seed?: number) {
    this.state = seed === undefined ? null : seed >>> 0;
  }

  get seeded(): boolean {
    return this.state !== null;
  }

  /** Capture the stream state (null when unseeded) for later replay. */
  snapshot(): number | null {
    return this.state;
  }

  /** Rewind the stream to a previously captured state. */
  restore(s: number | null): void {
    this.state = s;
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

// Ambient default backing the free helpers below, pending migration of call
// sites to an explicitly-owned Rng.
let defaultRng = new Rng();

/** Replace the ambient default (e.g. install a chargen run's owned stream). */
export function setDefaultRng(rng: Rng): void {
  defaultRng = rng;
}

/** Seed the ambient default with a deterministic stream. */
export function seedRng(seed: number): void {
  defaultRng = new Rng(seed);
}

/** Revert the ambient default to the non-deterministic Math.random source. */
export function clearRng(): void {
  defaultRng = new Rng();
}

/** Snapshot / restore the ambient default's stream state (for replay). */
export function rngState(): number | null {
  return defaultRng.snapshot();
}
export function setRngState(s: number | null): void {
  defaultRng.restore(s);
}

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
