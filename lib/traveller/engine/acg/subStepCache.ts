// Per-year sub-step idempotence cache for ACG resolveAssignment / specialAssignment.
//
// Background: pathway resolveAssignment functions are sequences of dice
// rolls + side effects (survival → promotion → decoration → skills →
// bonus). Each phase may call tryMitigate(...) which queues an
// interactive BP-review prompt via pickOrDefer. In interactive mode that
// throws ChoicePendingError and the engine pauses. On resume the runner
// re-invokes resolveAssignment from the top; without a cache, every
// roll re-rolls non-deterministically and BPs spent by autoMitigate get
// double-charged.
//
// This cache lives on AcgState.thisYearOutcomes and is cleared at year
// boundary by runAcgYear. Each phase stores its roll outcome the first
// time it fires; later re-entries read the cached value. Non-idempotent
// side effects (decoration push, rank changes, skill additions) are
// gated by `applied[key]` flags so they fire exactly once per year.

import type { Character } from "@/lib/traveller/character";
import { roll } from "@/lib/traveller/random";
import type {
  ResolutionTarget, SubStepOutcome, ThisYearOutcomes,
} from "./state";

export type SubStepKey =
  "survival" | "promotion" | "decoration" | "skills" | "bonus";

function getCache(ch: Character): ThisYearOutcomes {
  const acg = ch.requireAcgState();
  if (!acg.thisYearOutcomes) acg.thisYearOutcomes = {};
  return acg.thisYearOutcomes;
}

/** Call at the start of each pathway resolveAssignment. If the previous
 *  invocation ran to completion (markComplete fired), the cache is stale
 *  — wipe it before this fresh run. Used so tests that invoke
 *  resolveAssignment directly in a loop (e.g. navyRankCaps) don't get
 *  short-circuited by stale "applied" flags. runAcgYear also clears the
 *  cache at year boundary; this helper is the additional safeguard for
 *  direct invocation. */
export function resetIfComplete(ch: Character): void {
  const acg = ch.acgState;
  if (acg?.thisYearOutcomes?.complete) {
    delete acg.thisYearOutcomes;
  }
}

/** Mark the per-year resolution as complete. Called at the end of each
 *  pathway's resolveAssignment after all side effects fired. */
export function markComplete(ch: Character): void {
  const cache = getCache(ch);
  cache.complete = true;
}

/** Return the (lazily-initialized) sub-step outcome record for a phase. */
export function getSubStep(ch: Character, key: SubStepKey): SubStepOutcome {
  const cache = getCache(ch);
  if (!cache[key]) cache[key] = {};
  return cache[key];
}

/** Run `fn` exactly once per year per `key`. On re-entry (e.g. after a
 *  pause-resume cycle) the closure is skipped. Caller is responsible for
 *  storing the closure's effect on cache or character state if it needs
 *  to be observable on resume. */
export function applyOnce(ch: Character, key: string, fn: () => void): void {
  const cache = getCache(ch);
  if (!cache.applied) cache.applied = {};
  if (cache.applied[key]) return;
  fn();
  cache.applied[key] = true;
}

/** True if the named side effect has already fired this year. */
export function alreadyApplied(ch: Character, key: string): boolean {
  return ch.acgState?.thisYearOutcomes?.applied?.[key] === true;
}

/** Mark a side effect as fired without running anything (used when the
 *  side effect is fired implicitly by another code path and we still
 *  need to gate later applyOnce calls on the same key). */
export function markApplied(ch: Character, key: string): void {
  const cache = getCache(ch);
  if (!cache.applied) cache.applied = {};
  cache.applied[key] = true;
}

/** Roll dice for a resolution sub-step, caching the outcome so that a
 *  pause/resume cycle (e.g. tryMitigate threw ChoicePendingError) uses
 *  the same numeric result on the resumed pass. Mirrors rollVsTarget's
 *  return shape. "auto" / "none" targets bypass the dice and don't
 *  populate the cache (deterministic by definition). */
export function rollPhaseDice(
  ch: Character,
  phase: SubStepKey,
  target: ResolutionTarget,
  dm: number,
): { success: boolean; margin: number; roll: number; dm: number } {
  if (target === "auto") return { success: true, margin: 0, roll: 0, dm };
  if (target === "none") return { success: false, margin: -99, roll: 0, dm };
  const cache = getSubStep(ch, phase);
  if (cache.roll !== undefined && cache.margin !== undefined) {
    // Return the dm cached at first-roll time, NOT the live dm param.
    // The two can diverge if the live dm reads state that's been
    // mutated between the original roll and the resumed pass (e.g.,
    // promotion penalty consumed in logRoll). The cached value is the
    // one the cached margin was computed against.
    return {
      roll: cache.roll,
      success: cache.success ?? cache.margin >= 0,
      margin: cache.margin,
      dm: cache.dm ?? dm,
    };
  }
  const r = roll(2);
  const margin = r + dm - target;
  cache.roll = r;
  cache.dm = dm;
  cache.target = target;
  cache.margin = margin;
  cache.success = margin >= 0;
  return { roll: r, margin, success: margin >= 0, dm };
}

/** Cache the result of an auto-mitigation spend before a queueBpReview
 *  potentially throws. On resume, tryMitigate reads this cache and
 *  returns the same spent/newMargin without re-decrementing brownie
 *  points. Called from tryMitigate. */
export function cacheMitigation(
  ch: Character,
  phase: SubStepKey,
  spent: number,
  newMargin: number,
): void {
  const cache = getSubStep(ch, phase);
  cache.autoMitigated = spent;
  cache.marginAfterMit = newMargin;
}

/** Read cached mitigation for the given phase, or undefined if not yet
 *  recorded. tryMitigate uses this to short-circuit on resume. */
export function getCachedMitigation(
  ch: Character,
  phase: SubStepKey,
): { spent: number; newMargin: number } | undefined {
  const cache = ch.acgState?.thisYearOutcomes?.[phase];
  if (!cache || cache.autoMitigated === undefined) return undefined;
  return {
    spent: cache.autoMitigated,
    newMargin: cache.marginAfterMit ?? 0,
  };
}
