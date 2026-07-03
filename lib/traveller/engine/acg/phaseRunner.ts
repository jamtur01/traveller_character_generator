// Declarative pathway phase runner. Pathways describe their per-year
// resolution as an ordered list of PhaseDef entries; this module walks
// them, applies the sub-step cache + applyOnce machinery uniformly, and
// halts on chargen-ending failures. Removes ~60% of the
// rollPhaseDice/applyOnce/tryMitigate boilerplate that each pathway's
// resolveAssignment was duplicating.

import type { Character } from "@/lib/traveller/character";
import { tryMitigate, type MitigationRequest } from "./awards";
import {
  applyOnce, markComplete, resetIfComplete, rollPhaseDice,
  type SubStepKey,
} from "./subStepCache";
import type { AssignmentResolution, ResolutionTarget } from "./state";

/** Structural type for the per-pathway assignment-resolution table.
 *  Each pathway declares its own concrete shape (with sub-table-specific
 *  columns and row payloads); the runner only needs the column list and
 *  the row map for its diagnostics. */
export interface AssignmentLikeTable {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  dms?: ReadonlyArray<unknown>;
  notes?: string[];
}

/** Per-assignment context passed to each phase callback. Pathways
 *  pre-compute DMs and resolution-target lookups before invoking
 *  runPhases. */
export interface ResolveContext {
  ch: Character;
  assignment: string;
  resTable: AssignmentLikeTable;
  res: AssignmentResolution;
  /** Per-phase DM contributions, summed and ready to apply. Pathways
   *  compute these once before running phases — applies all service-
   *  specific DM rules. All except `survival` and `skills` are
   *  optional: scout has no decoration phase (PM p. 59 tables omit it),
   *  merchant has no promotion phase (exam is end-of-term). The
   *  matching phase entries are simply absent from the JSON
   *  `resolveAssignment.phases` list; the runner reads only the dms
   *  the configured phases need. */
  dms: {
    survival: number;
    skills: number;
    promotion?: number;
    decoration?: number;
    bonus?: number;
  };
}

/** Dice outcome returned by rollPhaseDice — re-exposed for phase
 *  callbacks that need to inspect the actual roll value. */
export interface PhaseRoll {
  roll: number;
  margin: number;
  success: boolean;
  dm: number;
}

/** Outcome of a phase's onFail callback. Returning `endChargen`
 *  terminates the phase chain immediately and fires the corresponding
 *  Character helper (wrapped in applyOnce for idempotence). */
export interface PhaseFailResult {
  endChargen?: {
    kind: "retired" | "deceased";
    reason: string;
    withPension?: boolean;
  };
}

export interface PhaseDef {
  /** Stable name — used as the cache key. */
  phase: SubStepKey;
  /** True if this phase should be skipped for the current context.
   *  Common reasons: target === "none", officer barred from promotion,
   *  already promoted this term, etc. */
  skip?(ctx: ResolveContext): boolean;
  /** Resolution target (e.g., `7` or `"auto"` or `"none"`). */
  target(ctx: ResolveContext): ResolutionTarget;
  /** Effective DM for the dice roll. May incorporate per-character
   *  modifiers beyond ctx.dms (e.g., promotion penalty consumption). */
  dm(ctx: ResolveContext): number;
  /** Side effect that runs ONCE after the dice are rolled — typically
   *  ch.log(ev.roll(...)). Gated by applyOnce keyed by phase. */
  logRoll?(ctx: ResolveContext, roll: PhaseRoll): void;
  /** Configuration for an optional brownie-point mitigation attempt
   *  on failure. Returning null skips the mitigation (e.g., skills
   *  phase without a mitigation policy). */
  mitigation?(ctx: ResolveContext, roll: PhaseRoll): MitigationRequest | null;
  /** Side effect when the (possibly mitigated) margin is ≥ 0. Wrapped
   *  in applyOnce. */
  onPass?(ctx: ResolveContext, roll: PhaseRoll): void;
  /** Side effect when the (possibly mitigated) margin is < 0. Wrapped
   *  in applyOnce. Returning `endChargen` halts the phase chain and
   *  ends chargen via the matching Character.endChargen* helper. */
  onFail?(ctx: ResolveContext, roll: PhaseRoll): PhaseFailResult | void;
  /** Side effect when the dice rolled exactly the target (margin
   *  === 0). Wrapped in applyOnce. Common case: combat-assignment
   *  Purple Heart on a survival just-pass. */
  onExact?(ctx: ResolveContext, roll: PhaseRoll): void;
}

export interface PathwaySpec {
  /** Phases in resolution order. */
  phases: ReadonlyArray<PhaseDef>;
  /** Pre-phase setup (e.g., interactive decoration-DM tradeoff prompt
   *  for mercenary/navy). Runs once before the phase loop. */
  preRun?(ctx: ResolveContext): void;
  /** Final side effects after all phases (combat ribbons, command
   *  clusters, assignmentHistory.push). Wrapped in applyOnce. */
  finalize?(ctx: ResolveContext): void;
}

/** Walk a pathway's phase list. Manages the sub-step cache (so
 *  pause/resume returns to the right point with consistent dice),
 *  applyOnce gates around side effects, and short-circuits on
 *  end-of-chargen failures. Call from a pathway's resolveAssignment
 *  after computing the ResolveContext. */
export function runPhases(spec: PathwaySpec, ctx: ResolveContext): void {
  resetIfComplete(ctx.ch);
  if (spec.preRun) spec.preRun(ctx);
  for (const phase of spec.phases) {
    if (phase.skip?.(ctx)) continue;
    const target = phase.target(ctx);
    if (target === "none") continue;
    const r = rollPhaseDice(ctx.ch, phase.phase, target, phase.dm(ctx));
    // Use the cached dm from rollPhaseDice — on resume, phase.dm(ctx)
    // can return a different value if its inputs were mutated by a
    // logRoll closure (e.g., promotion penalty consumption). The
    // cached value matches what the cached roll was computed against.
    const roll: PhaseRoll = { roll: r.roll, margin: r.margin, success: r.success, dm: r.dm };
    if (phase.logRoll) {
      applyOnce(ctx.ch, `${phase.phase}-logged`, () => phase.logRoll!(ctx, roll));
    }
    let effectiveMargin = roll.margin;
    if (!roll.success && phase.mitigation) {
      const req = phase.mitigation(ctx, roll);
      if (req) {
        const mit = tryMitigate(ctx.ch, req);
        effectiveMargin = mit.newMargin;
      }
    }
    if (effectiveMargin >= 0) {
      if (phase.onPass) {
        applyOnce(ctx.ch, `${phase.phase}-applied`, () => phase.onPass!(ctx, roll));
      }
    } else if (phase.onFail) {
      let halt: PhaseFailResult | undefined;
      applyOnce(ctx.ch, `${phase.phase}-failed`, () => {
        halt = phase.onFail!(ctx, roll) ?? undefined;
      });
      // applyOnce only runs the callback the first time; on resume
      // halt is undefined but endChargen state (if any) was already
      // applied. Use chargenStatus to detect the halt path.
      if (ctx.ch.isChargenEnded) {
        finalizeAndComplete(spec, ctx);
        return;
      }
      if (halt?.endChargen) {
        const failure = halt.endChargen;
        applyOnce(ctx.ch, `${phase.phase}-endChargen`, () => {
          if (failure.kind === "deceased") ctx.ch.endChargenDeceased(failure.reason);
          else ctx.ch.endChargenRetired(failure.reason, failure.withPension);
        });
        finalizeAndComplete(spec, ctx);
        return;
      }
    }
    // onExact fires when the EFFECTIVE margin lands exactly on 0 —
    // either the raw roll matched the target, or post-mitigation
    // pushed a failed roll back to 0 (BP-saved). Both cases count as
    // "wounded but survived" for the Purple Heart pattern.
    if (effectiveMargin === 0 && phase.onExact) {
      applyOnce(ctx.ch, `${phase.phase}-exact`, () => phase.onExact!(ctx, roll));
    }
  }
  finalizeAndComplete(spec, ctx);
}

/** Run the pathway's finalize hook (if any) and mark the year complete.
 *  Called on both clean phase exhaust AND halt paths — a character
 *  invalided out on a combat assignment still served on it; finalize
 *  records the Combat Ribbon and pushes to assignmentHistory. */
function finalizeAndComplete(spec: PathwaySpec, ctx: ResolveContext): void {
  if (spec.finalize) {
    // Namespaced key so a future phase named "finalize" can't collide.
    applyOnce(ctx.ch, "pathway-finalize", () => spec.finalize!(ctx));
  }
  markComplete(ctx.ch);
}
