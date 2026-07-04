// Declarative pathway phase runner. Pathways describe their per-year
// resolution as an ordered list of PhaseDef entries; this module walks
// them straight through, applies brownie-point mitigation uniformly, and
// halts on chargen-ending failures. Removes the roll/mitigate/log
// boilerplate that each pathway's resolveAssignment was duplicating.
//
// Interactive choices inside a phase (BP review, skill-column picks)
// either consume a recorded decision inline (session decision cursor) or
// throw ChoicePendingError, which unwinds to the session boundary — the
// whole action re-executes from its pre-action base on resolve, so no
// side effect here ever needs an idempotence gate.

import type { Character } from "@/lib/traveller/character";
import { tryMitigate, type MitigationRequest } from "./awards";
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
   *  the configured phases need. Mutable: the interactive decoration-DM
   *  tradeoff preRun adjusts survival/decoration inline when its prompt
   *  resolves. */
  dms: {
    survival: number;
    skills: number;
    promotion?: number;
    decoration?: number;
    bonus?: number;
  };
}

/** Dice outcome for one phase roll. */
export interface PhaseRoll {
  roll: number;
  margin: number;
  success: boolean;
  dm: number;
}

/** Outcome of a phase's onFail callback. Returning `endChargen`
 *  terminates the phase chain immediately and fires the corresponding
 *  Character helper. */
export interface PhaseFailResult {
  endChargen?: {
    kind: "retired" | "deceased";
    reason: string;
    withPension?: boolean;
  };
}

export interface PhaseDef {
  /** Stable name — identifies the phase in JSON configs. */
  phase: "survival" | "promotion" | "decoration" | "skills" | "bonus";
  /** True if this phase should be skipped for the current context.
   *  Common reasons: target === "none", officer barred from promotion,
   *  already promoted this term, etc. */
  skip?(ctx: ResolveContext): boolean;
  /** Resolution target (e.g., `7` or `"auto"` or `"none"`). */
  target(ctx: ResolveContext): ResolutionTarget;
  /** Effective DM for the dice roll. May incorporate per-character
   *  modifiers beyond ctx.dms (e.g., promotion penalty consumption). */
  dm(ctx: ResolveContext): number;
  /** Side effect that runs once after the dice are rolled — typically
   *  ch.log(ev.roll(...)). Receives the RAW roll (pre-mitigation margin). */
  logRoll?(ctx: ResolveContext, roll: PhaseRoll): void;
  /** Configuration for an optional brownie-point mitigation attempt
   *  on failure. Returning null skips the mitigation (e.g., skills
   *  phase without a mitigation policy). */
  mitigation?(ctx: ResolveContext, roll: PhaseRoll): MitigationRequest | null;
  /** Side effect when the (possibly mitigated) margin is ≥ 0. The roll's
   *  `margin` is the EFFECTIVE (post-mitigation) margin. */
  onPass?(ctx: ResolveContext, roll: PhaseRoll): void;
  /** Side effect when the (possibly mitigated) margin is < 0. Returning
   *  `endChargen` halts the phase chain and ends chargen via the matching
   *  Character.endChargen* helper. */
  onFail?(ctx: ResolveContext, roll: PhaseRoll): PhaseFailResult | void;
  /** Side effect when the EFFECTIVE margin lands exactly on 0 — either
   *  the raw roll matched the target, or mitigation pushed a failed roll
   *  back to 0 (BP-saved). Common case: combat-assignment Purple Heart
   *  on a survival just-pass. */
  onExact?(ctx: ResolveContext, roll: PhaseRoll): void;
}

export interface PathwaySpec {
  /** Phases in resolution order. */
  phases: ReadonlyArray<PhaseDef>;
  /** Pre-phase setup (e.g., interactive decoration-DM tradeoff prompt
   *  for mercenary/navy). Runs once before the phase loop. */
  preRun?(ctx: ResolveContext): void;
  /** Final side effects after all phases (combat ribbons, command
   *  clusters, assignmentHistory.push). */
  finalize?(ctx: ResolveContext): void;
}

/** Roll one phase's dice vs `target` (a number — "none" is skipped by the
 *  caller). "auto" succeeds without a roll. */
function rollPhase(
  ch: Character, target: number | "auto", dm: number,
): PhaseRoll {
  if (target === "auto") return { success: true, margin: 0, roll: 0, dm };
  const roll = ch.rng.roll(2);
  const margin = roll + dm - target;
  return { roll, margin, success: margin >= 0, dm };
}

/** Walk a pathway's phase list straight through and short-circuit on
 *  end-of-chargen failures. Call from a pathway's resolveAssignment
 *  after computing the ResolveContext. */
export function runPhases(spec: PathwaySpec, ctx: ResolveContext): void {
  if (spec.preRun) spec.preRun(ctx);
  for (const phase of spec.phases) {
    if (phase.skip?.(ctx)) continue;
    const target = phase.target(ctx);
    if (target === "none") continue;
    const roll = rollPhase(ctx.ch, target, phase.dm(ctx));
    if (phase.logRoll) phase.logRoll(ctx, roll);
    let effectiveMargin = roll.margin;
    if (!roll.success && phase.mitigation) {
      const req = phase.mitigation(ctx, roll);
      if (req) {
        effectiveMargin = tryMitigate(ctx.ch, req).newMargin;
      }
    }
    // Callbacks after the mitigation window see the effective margin.
    const outcome: PhaseRoll = { ...roll, margin: effectiveMargin };
    if (effectiveMargin >= 0) {
      phase.onPass?.(ctx, outcome);
    } else if (phase.onFail) {
      const halt = phase.onFail(ctx, outcome) ?? undefined;
      if (ctx.ch.isChargenEnded) {
        finalizePhases(spec, ctx);
        return;
      }
      if (halt?.endChargen) {
        const failure = halt.endChargen;
        if (failure.kind === "deceased") ctx.ch.endChargenDeceased(failure.reason);
        else ctx.ch.endChargenRetired(failure.reason, failure.withPension);
        finalizePhases(spec, ctx);
        return;
      }
    }
    if (effectiveMargin === 0 && phase.onExact) phase.onExact(ctx, outcome);
  }
  finalizePhases(spec, ctx);
}

/** Run the pathway's finalize hook (if any). Called on both clean phase
 *  exhaust AND halt paths — a character invalided out on a combat
 *  assignment still served on it; finalize records the Combat Ribbon and
 *  pushes to assignmentHistory. */
function finalizePhases(spec: PathwaySpec, ctx: ResolveContext): void {
  spec.finalize?.(ctx);
}
