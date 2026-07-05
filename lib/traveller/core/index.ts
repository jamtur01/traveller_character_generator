// The edition-agnostic engine boundary. Chargen models (chargen/models/*)
// import mechanics from here, never from deep engine/* paths. Core never
// imports a model or an edition-specific rule — it is pure, shared machinery
// (RNG, cascade/cell resolution, DM/predicate evaluation, muster DMs, strict
// data reads). New shared primitives (characteristic DM, task check) are added
// under core/ and re-exported here.

export { Rng, roll, arnd, rndInt } from "@/lib/traveller/random";
export {
  cascadePoolByKey,
  cascadePoolForLabel,
  cascadeKeyForLabel,
  isCascadeLabel,
} from "@/lib/traveller/engine/cascadeMap";
export { applyCell } from "@/lib/traveller/engine/cellResolver";
export type { CellMode } from "@/lib/traveller/engine/cellResolver";
export { evaluateDM } from "@/lib/traveller/engine/dmEvaluator";
export type { DmContext } from "@/lib/traveller/engine/dmEvaluator";
export {
  evaluatePredicate,
  sumPredicateDms,
  buildPredicateContext,
  normalizeAttr,
  parseRankLetter,
  rankNum,
} from "@/lib/traveller/engine/predicate";
export type {
  Predicate,
  PredicateContext,
  HomeworldFieldTest,
} from "@/lib/traveller/engine/predicate";
export { cashDmFor, benefitDmFor, maxCashRolls } from "@/lib/traveller/engine/musterDm";
export { characteristicDm, rollCheck } from "@/lib/traveller/engine/check";
export type { DmBand, CheckResult } from "@/lib/traveller/engine/check";
export { requireRule, parseDieCount } from "@/lib/traveller/editions/strict";
