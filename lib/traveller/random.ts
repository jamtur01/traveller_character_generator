// Random helpers. Plain Math.random under the hood; injecting a seedable PRNG
// would be a single-point change here if we ever want deterministic runs in
// production.

export function rndInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function arnd<T>(a: readonly T[]): T {
  if (a.length === 0) throw new Error("arnd called with empty array");
  return a[Math.floor(Math.random() * a.length)] as T;
}

/** Roll `rolls` six-sided dice and return the total. */
export function roll(rolls: number): number {
  let total = 0;
  for (let i = 0; i < rolls; i++) {
    total += Math.floor(Math.random() * 6 + 1);
  }
  return total;
}
