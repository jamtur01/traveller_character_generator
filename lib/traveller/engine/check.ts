// Mongoose 2e's two pervasive resolution primitives, kept edition-agnostic in
// the engine core: a characteristic -> dice-modifier band lookup, and the
// unified 2D + DM vs target task check with an Effect (margin) result.
//
// The band VALUES (the Characteristic Modifiers table, PM/Core p.9) and the
// difficulty TARGETS (Core pp.60-61) are game rules and live in the edition
// JSON (data/editions/*.json). These functions are pure interpreters of that
// data — they bake in no game constants, per the rules-as-JSON design.

import type { Rng } from "@/lib/traveller/random";

/** A characteristic-DM band: scores in [min, max] (inclusive) map to `dm`.
 *  Sourced from the edition JSON's characteristic-modifier table. */
export interface DmBand {
  readonly min: number;
  readonly max: number;
  readonly dm: number;
}

/** Look up the dice modifier for a characteristic `score` against an ordered
 *  band table. Fail-loud: a score matched by no band means the JSON table is
 *  incomplete — never silently default to 0. */
export function characteristicDm(score: number, bands: readonly DmBand[]): number {
  for (const band of bands) {
    if (score >= band.min && score <= band.max) return band.dm;
  }
  throw new Error(
    `characteristicDm: no band matches score ${score} (${bands.length} bands)`,
  );
}

/** Outcome of a task check. `effect` is the signed margin (total - target);
 *  callers classify it into Mongoose's named tiers (Exceptional / Average /
 *  Marginal) via the edition's effect table. */
export interface CheckResult {
  readonly roll: number;
  readonly total: number;
  readonly target: number;
  readonly success: boolean;
  readonly effect: number;
}

/** Unified 2D + DM vs target task check (Mongoose 2e, Core pp.12, 60-62).
 *  `dms` are summed (characteristic DM, skill level, situational DMs); success
 *  is total >= target; effect is the margin. `target` is the difficulty's
 *  target number, supplied by the caller from the edition JSON (the model
 *  substitutes the declared default when a check lists no difficulty). */
export function rollCheck(
  rng: Rng,
  dms: readonly number[],
  target: number,
): CheckResult {
  const roll = rng.roll(2);
  const total = roll + dms.reduce((sum, dm) => sum + dm, 0);
  return { roll, total, target, success: total >= target, effect: total - target };
}
