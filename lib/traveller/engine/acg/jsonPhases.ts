// JSON-driven pathway phase configuration. Option D in the architecture
// roadmap: encode the per-pathway phase ordering and parameters in the
// edition JSON so game-rule edits don't require TS changes; pathway TS
// modules shrink to enlistment + a callback registry.
//
// The loader compiles a ResolveAssignmentConfig (parsed from JSON) into
// a PathwaySpec for runPhases. Built-in phase semantics handle the
// standard patterns (survival fail → endChargen, promotion penalty
// consumption, decoration tier → award + court-martial); pathway-
// specific side effects (skill roll, promotion, finalize) are dispatched
// through a per-pathway callback registry.

import type { Character } from "../../character";
import {
  awardDecoration, resolveDecorationTier, runCourtMartial,
} from "./awards";
import {
  type PathwaySpec, type PhaseDef, type PhaseFailResult,
  type ResolveContext,
} from "./phaseRunner";
import type { MitigationRequest } from "./browniePoints";

// --- JSON config shape -----------------------------------------------

interface PhaseSurvival {
  kind: "survival";
  /** Mitigation request consequence string. */
  consequence: string;
  /** Player-facing message logged via ev.statusChange("revived", ...). */
  onMitigatedRevive: string;
  /** Fired when post-mitigation margin remains < 0. */
  endChargenOnFail: {
    kind: "retired" | "deceased";
    reason: string;
    withPension?: boolean;
  };
  /** If true and margin === 0 and the assignment is in the pathway's
   *  combatAssignments list, award Purple Heart and set injuredThisYear. */
  purpleHeartOnExactCombat?: boolean;
}

interface PhasePromotion {
  kind: "promotion";
  consequence: string;
  /** Named callback in the pathway's PathwayCallbacks registry. */
  onPass: string;
  /** If true, the phase is skipped when the character is not in the
   *  Bureaucracy division (scout-specific). */
  skipIfNotBureaucracy?: boolean;
  /** If true, the phase reads & consumes acgState.nextPromotionPenalty. */
  consumeNextPromotionPenalty?: boolean;
  /** If true, append the (negative) penalty to the phase's log note. */
  logPenaltyInNote?: boolean;
}

interface PhaseDecoration {
  kind: "decoration";
  /** Used when margin is < 0 but > severe threshold. */
  consequenceMild: string;
  /** Used when margin is ≤ severe threshold (court-martial). */
  consequenceSevere: string;
  /** Margin threshold below (≤) which the severe consequence applies. */
  courtMartialMarginThreshold: number;
}

interface PhaseSkills {
  kind: "skills";
  consequence: string;
  /** Named callback that picks/rolls the actual skill. */
  onPass: string;
}

interface PhaseBonus {
  kind: "bonus";
  consequence: string;
  onPass: string;
}

export type PhaseConfig =
  | PhaseSurvival | PhasePromotion | PhaseDecoration | PhaseSkills | PhaseBonus;

export interface ResolveAssignmentConfig {
  /** Built-in pre-phase setup. `"decorationDmTradeoff"` invokes the
   *  shared interactive prompt; null/omitted skips. */
  preRun?: "decorationDmTradeoff" | null;
  phases: PhaseConfig[];
  /** Named callback run after all phases (combat ribbons, assignment
   *  history, etc.). */
  finalize?: string;
}

// --- Callback registry ----------------------------------------------

/** Per-pathway named callback registry. Loader resolves PhaseConfig.onPass
 *  / finalize / etc. against this map. */
export interface PathwayCallbacks {
  /** Called on phase.onPass with the assignment context. */
  [name: string]: (ctx: ResolveContext) => void;
}

/** Pre-phase hooks the loader recognises by name. */
const PRERUN_HOOKS: Record<string, (ctx: ResolveContext) => void> = {};

/** Register a preRun hook keyed by its JSON identifier. Pathways or
 *  shared modules call this at module load. */
export function registerPreRun(
  name: string,
  fn: (ctx: ResolveContext) => void,
): void {
  PRERUN_HOOKS[name] = fn;
}

// --- Loader ----------------------------------------------------------

interface BuildContext {
  /** Look up combatAssignments for the pathway. Used by the survival
   *  phase's Purple Heart logic. Empty list if N/A. */
  combatAssignments: (ch: Character) => readonly string[];
}

/** Convert a JSON ResolveAssignmentConfig into a PathwaySpec the runner
 *  can execute. Throws if a referenced callback name isn't in the
 *  registry (data ↔ code drift surfaces at edition load, not at run
 *  time). */
export function buildPathwaySpecFromConfig(
  config: ResolveAssignmentConfig,
  callbacks: PathwayCallbacks,
  build: BuildContext,
): PathwaySpec {
  const phases = config.phases.map((p) => buildPhase(p, callbacks, build));
  const spec: PathwaySpec = { phases };
  if (config.preRun) {
    const hook = PRERUN_HOOKS[config.preRun];
    if (!hook) throw new Error(`Unknown preRun hook: ${config.preRun}`);
    spec.preRun = hook;
  }
  if (config.finalize) {
    const fn = callbacks[config.finalize];
    if (!fn) throw new Error(`Unknown finalize callback: ${config.finalize}`);
    spec.finalize = fn;
  }
  return spec;
}

function lookupCallback(name: string, callbacks: PathwayCallbacks): (ctx: ResolveContext) => void {
  const fn = callbacks[name];
  if (!fn) throw new Error(`Unknown pathway callback: ${name}`);
  return fn;
}

function buildPhase(
  p: PhaseConfig,
  callbacks: PathwayCallbacks,
  build: BuildContext,
): PhaseDef {
  switch (p.kind) {
    case "survival": return buildSurvival(p, build);
    case "promotion": return buildPromotion(p, callbacks);
    case "decoration": return buildDecoration(p);
    case "skills": return buildSkills(p, callbacks);
    case "bonus": return buildBonus(p, callbacks);
  }
}

function buildSurvival(p: PhaseSurvival, build: BuildContext): PhaseDef {
  const base: PhaseDef = {
    phase: "survival",
    target: (ctx) => ctx.res.survival,
    dm: (ctx) => ctx.dms.survival,
    logRoll: (ctx, r) => ctx.ch.log(rollEv("Survival", r, ctx.res.survival, ctx.assignment)),
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "survival",
      rollValue: r.roll,
      dm: r.dm,
      target: targetOrZero(ctx.res.survival),
      margin: r.margin,
      consequence: p.consequence,
      onMitigated: (c) => {
        c.resumeActive();
        c.log(reviveStatusChange(p.onMitigatedRevive));
      },
    }),
    onFail: (): PhaseFailResult => ({ endChargen: p.endChargenOnFail }),
  };
  if (p.purpleHeartOnExactCombat) {
    base.onExact = (ctx) => {
      if (typeof ctx.res.survival !== "number") return;
      const combat = build.combatAssignments(ctx.ch);
      if (!combat.includes(ctx.assignment)) return;
      ctx.ch.requireAcgState().decorations.push("Purple Heart");
      ctx.ch.log(decorationEv("Purple Heart", `Wounded in ${ctx.assignment}`));
      ctx.ch.requireAcgState().injuredThisYear = true;
    };
  }
  return base;
}

function buildPromotion(p: PhasePromotion, callbacks: PathwayCallbacks): PhaseDef {
  const onPass = lookupCallback(p.onPass, callbacks);
  return {
    phase: "promotion",
    skip: (ctx) => {
      const acg = ctx.ch.requireAcgState();
      if (ctx.res.promotion === "none") return true;
      if (p.skipIfNotBureaucracy && acg.division !== "bureaucracy") return true;
      if (acg.isOfficer && ctx.res.promotionOfficersBarred === true) return true;
      if (acg.isOfficer && acg.promotedThisTerm) return true;
      return false;
    },
    target: (ctx) => ctx.res.promotion,
    dm: (ctx) => {
      const penalty = p.consumeNextPromotionPenalty
        ? (ctx.ch.requireAcgState().nextPromotionPenalty ?? 0)
        : 0;
      return (ctx.dms.promotion ?? 0) + penalty;
    },
    logRoll: (ctx, r) => {
      const penalty = p.consumeNextPromotionPenalty
        ? (ctx.ch.requireAcgState().nextPromotionPenalty ?? 0)
        : 0;
      const note = (p.logPenaltyInNote && penalty)
        ? `${ctx.assignment} — reprimand penalty ${penalty}`
        : ctx.assignment;
      ctx.ch.log(rollEv("Promotion", r, ctx.res.promotion, note));
      if (p.consumeNextPromotionPenalty && penalty < 0) {
        ctx.ch.requireAcgState().nextPromotionPenalty = 0;
      }
    },
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "promotion",
      rollValue: r.roll, dm: r.dm,
      target: targetOrZero(ctx.res.promotion),
      margin: r.margin,
      consequence: p.consequence,
    }),
    onPass: (ctx) => onPass(ctx),
  };
}

function buildDecoration(p: PhaseDecoration): PhaseDef {
  return {
    phase: "decoration",
    skip: (ctx) => ctx.res.decoration === "none",
    target: (ctx) => ctx.res.decoration,
    dm: (ctx) => ctx.dms.decoration ?? 0,
    logRoll: (ctx, r) => ctx.ch.log(rollEv(
      "Decoration", r, ctx.res.decoration,
      `${ctx.assignment} (margin ${r.margin})`,
      /*marginIsSuccess*/ true,
    )),
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "decoration",
      rollValue: r.roll, dm: r.dm,
      target: targetOrZero(ctx.res.decoration),
      margin: r.margin,
      consequence: r.margin <= p.courtMartialMarginThreshold
        ? p.consequenceSevere
        : p.consequenceMild,
    }),
    onPass: (ctx, r) => applyDecorationResolution(ctx, r, p.courtMartialMarginThreshold),
    onFail: (ctx, r) => applyDecorationResolution(ctx, r, p.courtMartialMarginThreshold),
  };
}

function applyDecorationResolution(
  ctx: ResolveContext,
  r: { roll: number; margin: number },
  courtMartialThreshold: number,
): void {
  const cached = ctx.ch.acgState?.thisYearOutcomes?.decoration;
  const margin = cached?.marginAfterMit ?? r.margin;
  const tier = resolveDecorationTier(ctx.ch, margin);
  if (tier) {
    awardDecoration(ctx.ch, tier);
  } else if (margin <= courtMartialThreshold) {
    runCourtMartial(ctx.ch, ctx.assignment);
  }
}

function buildSkills(p: PhaseSkills, callbacks: PathwayCallbacks): PhaseDef {
  const onPass = lookupCallback(p.onPass, callbacks);
  return {
    phase: "skills",
    skip: (ctx) => ctx.res.skills === "none",
    target: (ctx) => ctx.res.skills,
    dm: (ctx) => ctx.dms.skills,
    logRoll: (ctx, r) => ctx.ch.log(rollEv("Skills", r, ctx.res.skills, ctx.assignment)),
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "skills",
      rollValue: r.roll, dm: r.dm,
      target: targetOrZero(ctx.res.skills),
      margin: r.margin,
      consequence: p.consequence,
    }),
    onPass: (ctx) => onPass(ctx),
  };
}

function buildBonus(p: PhaseBonus, callbacks: PathwayCallbacks): PhaseDef {
  const onPass = lookupCallback(p.onPass, callbacks);
  return {
    phase: "bonus",
    skip: (ctx) => bonusTargetOf(ctx) === "none",
    target: (ctx) => bonusTargetOf(ctx),
    dm: (ctx) => ctx.dms.bonus ?? 0,
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "bonus",
      rollValue: r.roll, dm: r.dm,
      target: typeof bonusTargetOf(ctx) === "number" ? (bonusTargetOf(ctx) as number) : 0,
      margin: r.margin,
      consequence: p.consequence,
    }),
    onPass: (ctx) => onPass(ctx),
  };
}

/** Read the bonus target carried on the synthesized AssignmentResolution.
 *  Merchant resolution doesn't have a built-in bonus field; the pathway
 *  glue stashes it on `res` via a typed extension. */
function bonusTargetOf(ctx: ResolveContext): import("./types").ResolutionTarget {
  const res = ctx.res as typeof ctx.res & { bonus?: import("./types").ResolutionTarget };
  if (res.bonus === undefined) warnBonusMissing(ctx.assignment);
  return res.bonus ?? "none";
}

const BONUS_MISSING_WARNED = new Set<string>();
function warnBonusMissing(assignment: string): void {
  if (BONUS_MISSING_WARNED.has(assignment)) return;
  BONUS_MISSING_WARNED.add(assignment);
  // Surface the misconfiguration once per assignment: the pathway's
  // JSON config declares a bonus phase, but resolution.bonus is
  // undefined. Either the JSON shouldn't list the phase, or the pathway
  // glue should populate res.bonus.
  console.warn(
    `[acg] bonus phase configured but resolution.bonus undefined for ` +
    `assignment "${assignment}" — phase will be skipped.`,
  );
}

// --- Event helpers ---------------------------------------------------

// Wrappers around the typed event constructors. Inline lazy-require so
// the loader module doesn't bring in the entire history module at type-
// check time on a hot import path.
/** Construct a roll event. `marginIsSuccess`: decoration rolls log
 *  "success" any time margin >= 0 (failure just yields no decoration);
 *  other phases use the raw pass/fail flag. */
function rollEv(
  name: string,
  r: { roll: number; margin: number; success: boolean; dm: number },
  resolutionTarget: import("./types").ResolutionTarget,
  context: string,
  marginIsSuccess = false,
): ReturnType<typeof eventModule.event.roll> {
  return eventModule.event.roll(
    name, r.roll, r.dm,
    typeof resolutionTarget === "number" ? resolutionTarget : 0,
    marginIsSuccess ? r.margin >= 0 : r.success,
    context,
  );
}

function decorationEv(award: "MCUF" | "MCG" | "SEH" | "Purple Heart", reason?: string) {
  return eventModule.event.decoration(award, reason);
}

function reviveStatusChange(note: string) {
  return eventModule.event.statusChange("revived", note);
}

function targetOrZero(t: import("./types").ResolutionTarget): number {
  return typeof t === "number" ? t : 0;
}

// Avoid circular import at type-check time by deferring the history
// module reference. The pathway code is the entry point for event
// construction; this loader is downstream.
import * as eventModule from "../../history";

// Register the built-in decoration-DM tradeoff preRun hook. The prompt
// fires before any phase rolls in interactive mode; both mercenary and
// navy use it. Skill-cap-style choices stay pathway-local.
registerPreRun("decorationDmTradeoff", (ctx) => {
  if (ctx.ch.choiceMode !== "interactive") return;
  if (ctx.res.decoration === "none") return;
  if (typeof ctx.res.survival !== "number" || typeof ctx.res.decoration !== "number") return;
  ctx.ch.pickOrDefer({
    kind: "decorationDmTradeoff",
    label:
      "Take a -N DM on survival in exchange for +N on decoration? " +
      "(Negative survival ↔ positive decoration; pick 0 to keep things straight.)",
    options: ["-2 survival / +2 decoration", "-1 survival / +1 decoration",
      "No tradeoff", "+1 survival / -1 decoration", "+2 survival / -2 decoration"],
    onResolve: (c, choice) => {
      if (choice.startsWith("-2")) c.requireAcgState().decorationDmStrategy = -2;
      else if (choice.startsWith("-1")) c.requireAcgState().decorationDmStrategy = -1;
      else if (choice.startsWith("+1")) c.requireAcgState().decorationDmStrategy = 1;
      else if (choice.startsWith("+2")) c.requireAcgState().decorationDmStrategy = 2;
      else c.requireAcgState().decorationDmStrategy = 0;
    },
  });
});
