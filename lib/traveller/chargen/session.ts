// Chargen session — pure flow logic extracted from the React layer, built on
// event-sourced re-execution.
//
// Model: every session action (enlist, runTerm, pickSkill, ...) captures a
// pristine pre-action BASE (cloneCharacter before anything mutates — RNG
// position included) and runs the flow STRAIGHT THROUGH on a working copy.
// Player decisions flow through Character.decisionCursor: previously-recorded
// option indices are consumed synchronously inline (pickOrDefer runs
// onResolve immediately and execution continues); only the FRONTIER choice —
// the first one past the recorded indices — queues on pendingChoices and
// throws ChoicePendingError, unwinding to the single pauseGuard boundary in
// runAction. The partial snapshot renders; when the player picks,
// resolvePending appends the index to the frontier's resolutions and RE-RUNS
// the same action from a clone of the base. The whole prefix re-executes
// identically, previously-answered choices consume from the cursor, and
// execution reaches the next frontier (or completes). No mid-flight resume
// state and no idempotence caches exist: every re-run starts from a virgin
// base.
//
// DETERMINISM INVARIANT: re-execution reproduces the prefix exactly iff the
// character's RNG is deterministic across re-runs — i.e. the rng is seeded
// (StartCareerOptions.seed; the replay harness and the UI always seed) or
// Math.random is fully pinned (walker / session tests pin a constant). The
// same cloned seeded rng yields the same draws, so the re-run is bit-for-bit
// identical up to the frontier (proven by tests/equivalence.property.test.ts).

import { Character, cloneCharacter } from "@/lib/traveller/character";
import { ChoicePendingError, pauseGuard } from "@/lib/traveller/engine/choices";
import { getEditionServices } from "@/lib/traveller/services";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import { editionHasAcg } from "@/lib/traveller/engine/acg";
import { freshAcgState } from "@/lib/traveller/engine/acg/state";
import { event as ev } from "@/lib/traveller/history";
import { cashDmFor, benefitDmFor, maxCashRolls } from "@/lib/traveller/engine/musterDm";
import { intToOrdinal } from "@/lib/traveller/formatting";

export type ChargenPhase =
  | "start"
  | "pre_career"
  | "career"
  | "acg_enlist"
  | "term"
  | "skill_basic"
  | "skill_adv"
  | "muster"
  | "muster_no_cash"
  | "end";

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool" | "skip";

export interface EnlistOptions {
  verbose: boolean;
  /** Basic chargen only — preferred service, or "random". */
  preferredService: string;
  /** ACG only. */
  acgService: "army" | "marines";
  acgCombatArm: string;
  acgFleet: "imperialNavy" | "reserveFleet" | "systemSquadron";
  acgDivision: "field" | "bureaucracy";
  acgLineType: string;
  acgSubsectorTech: string;
  acgMerchantAcademy: boolean;
}

/** One session action, as a plain re-dispatchable record (no closures — the
 *  frontier must survive in React state / snapshots without live references). */
export type FrontierAction =
  | { kind: "runTerm" }
  | { kind: "enlist"; opts: EnlistOptions }
  | { kind: "preCareer"; opt: PreCareerOption }
  | { kind: "pickSkill"; table: number }
  | { kind: "attemptMusterOut" }
  | { kind: "musterChoice"; choice: "cash" | "benefit" };

/** A paused action: the pre-action base to re-execute from, the action to
 *  re-dispatch, and the option indices already picked (in prompt order). */
export interface Frontier {
  action: FrontierAction;
  base: Character;
  resolutions: number[];
}

export interface ChargenSnapshot {
  character: Character;
  phase: ChargenPhase;
  /** Present iff the character has a pending frontier choice. resolvePending
   *  re-runs `action` from `base` with the picked index appended. */
  frontier?: Frontier;
}

/** Hints back to the React layer when a flow action wants to update the
 *  separately-tracked UI config state (e.g., a pre-career outcome pre-
 *  populates the ACG enlistment form). All fields optional. */
export interface UiHints {
  acgPathway?: string;
  acgService?: "army" | "marines";
  acgFleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
}

export interface ChargenResult {
  snapshot: ChargenSnapshot;
  /** Soft hints for the UI's config state (separate from character). */
  hints?: UiHints;
}

/** Which skill-picker phase to enter based on the character's pending
 *  picker context. */
function pickSkillPhase(ch: Character): ChargenPhase {
  // The phase distinction is for the UI's stepper / progress bar only;
  // the engine treats the two identically.
  return ch.muster.forceTableIndex >= 3 ? "skill_adv" : "skill_basic";
}

export interface StartCareerOptions {
  edition: string;
  verbose: boolean;
  interactiveMode: boolean;
  supportsInteractive: boolean;
  useAcg: boolean;
  acgPathway: string;
  /** Seed the character's RNG for a reproducible run (see chargen/replay).
   *  Interactive-mode determinism requires this OR a fully pinned
   *  Math.random (the walker-test pattern): resolvePending re-executes the
   *  paused action from its base, and an unseeded, unpinned rng re-rolls
   *  fresh values on every re-run, silently diverging from the displayed
   *  prefix. The UI always seeds. No runtime guard — the engine cannot
   *  detect a pinned Math.random. */
  seed?: number;
}

/** Begin a new character. Decides whether to enter pre-career (ACG) or
 *  jump straight to basic enlistment. */
export function startCareer(opts: StartCareerOptions): ChargenSnapshot {
  const ch = new Character(opts.seed !== undefined ? { seed: opts.seed } : {});
  ch.editionId = opts.edition;
  ch.showHistory = opts.verbose ? "verbose" : "simple";
  // Set choiceMode before generateHomeworld so that any homeworld
  // generation step that consults choiceMode (e.g., future interactive
  // homeworld picks) sees the configured mode rather than the default.
  ch.choiceMode = (opts.interactiveMode && opts.supportsInteractive)
    ? "interactive"
    : "auto";
  ch.generateHomeworld();
  if (opts.useAcg && editionHasAcg(opts.edition) && opts.acgPathway) {
    ch.chargenModelId = "acg";
    ch.acgPathway = opts.acgPathway;
    // PM p. 44: ACG characters (and pre-career at 18) begin at age 18 —
    // declared in acg.common.startAge rather than inherited from the
    // constructor literal. Basic flow applies per-service startAge at enlist.
    ch.age = requireRule(
      getEdition(opts.edition).data.advancedCharacterGeneration?.common?.startAge,
      "advancedCharacterGeneration.common.startAge", "PM p. 44",
    );
    return { character: ch, phase: "pre_career" };
  }
  return { character: ch, phase: "career" };
}

// ---------------------------------------------------------------------------
// Action dispatch. One boundary owns the whole pause protocol: runAction
// clones the base, arms the decision cursor, runs the action straight
// through, and either returns the completed routing or a paused snapshot
// carrying the frontier.
// ---------------------------------------------------------------------------

/** The phase a paused snapshot renders in, per action kind. Panels are
 *  hidden while a choice is pending, so this mainly keeps the stepper
 *  anchored where the action was issued from. */
function pausedPhaseFor(
  action: FrontierAction, ch: Character, base: Character,
): ChargenPhase {
  switch (action.kind) {
    case "preCareer": return "pre_career";
    case "enlist": return "term";
    case "runTerm": return "term";
    case "attemptMusterOut": return "term";
    case "pickSkill": return pickSkillPhase(ch);
    case "musterChoice":
      // Derive from the pre-action base (pre-increment cash accounting) so
      // the paused snapshot stays in the phase the roll was issued from.
      return base.muster.musterCashUsed >= maxCashRolls(base)
        ? "muster_no_cash"
        : "muster";
  }
}

function executeAction(ch: Character, action: FrontierAction): ChargenResult {
  switch (action.kind) {
    case "preCareer": return doApplyPreCareer(ch, action.opt);
    case "enlist": return { snapshot: doEnlist(ch, action.opts) };
    case "runTerm": return { snapshot: doRunTerm(ch) };
    case "pickSkill": return { snapshot: doPickSkill(ch, action.table) };
    case "attemptMusterOut": return { snapshot: doAttemptMusterOut(ch) };
    case "musterChoice": return { snapshot: doMusterChoice(ch, action.choice) };
  }
}

/** Run one action from `prev` with the given recorded decisions. The ONLY
 *  ChoicePendingError boundary in the session: a pause here means the
 *  working copy holds the partial (renderable) state and the returned
 *  frontier can re-execute the action once the player picks. */
function runAction(
  prev: Character, action: FrontierAction, resolutions: number[],
): ChargenResult {
  if (prev.pendingChoices.length > 0) {
    throw new Error(
      `session: cannot dispatch "${action.kind}" while a choice is pending — ` +
      "the paused action must be resolved first (resolvePending); building " +
      "on the partial mid-action state would abandon the frontier",
    );
  }
  const base = cloneCharacter(prev);
  const ch = cloneCharacter(prev);
  ch.decisionCursor = { resolutions, pos: 0 };
  let result: ChargenResult | undefined;
  const outcome = pauseGuard(() => { result = executeAction(ch, action); });
  ch.decisionCursor = null;
  if (outcome === "paused") {
    return {
      snapshot: {
        character: ch,
        phase: pausedPhaseFor(action, ch, base),
        frontier: { action, base, resolutions },
      },
    };
  }
  return result!;
}

/** Resolve a pending player choice: append the picked option index to the
 *  frontier's resolutions and re-run the paused action from its base. The
 *  re-executed prefix consumes the recorded indices inline; execution then
 *  reaches the next frontier or completes (phase routing happens naturally
 *  inside the re-run — no post-drain special cases). Returns the full
 *  ChargenResult: when the re-run completes a pre-career action, `hints`
 *  carries the enlistment-form pre-population that would otherwise be
 *  lost (in interactive mode the OTC / medical-school outcomes are always
 *  delivered through this path). */
export function resolvePending(
  snap: ChargenSnapshot,
  choiceId: string,
  optionIdx: number,
): ChargenResult {
  const frontier = snap.frontier;
  if (!frontier) {
    throw new Error(
      "resolvePending: snapshot has no frontier — a pending choice must come " +
      "from a paused session action (stale snapshot or corrupted state)",
    );
  }
  const pending = snap.character.pendingChoices.find((p) => p.id === choiceId);
  if (!pending) {
    throw new Error(
      `resolvePending: no pending choice with id "${choiceId}" ` +
      `(pending: ${snap.character.pendingChoices.map((p) => p.id).join(", ") || "none"})`,
    );
  }
  if (pending.options[optionIdx] === undefined) {
    throw new Error(
      `resolvePending: optionIdx ${optionIdx} out of range for choice ` +
      `${choiceId} (${pending.options.length} options)`,
    );
  }
  return runAction(
    frontier.base, frontier.action, [...frontier.resolutions, optionIdx],
  );
}

// ---------------------------------------------------------------------------
// Public actions — thin wrappers that package a FrontierAction. Guards that
// must not consume an action (pending choice, mandatory reenlistment) stay
// out here so the no-op case returns the snapshot identity-equal.
// ---------------------------------------------------------------------------

/** Apply a pre-career option. Honors a chained-academic-progression: an
 *  honors college grad may chain into medical/flight school; an academy
 *  honors grad may try medical/flight. Returns hints for the UI's
 *  enlistment-form config (e.g., naval academy honors → navy/imperialNavy). */
export function applyPreCareer(
  snap: ChargenSnapshot,
  opt: PreCareerOption,
): ChargenResult {
  return runAction(snap.character, { kind: "preCareer", opt }, []);
}

export function enlist(snap: ChargenSnapshot, opts: EnlistOptions): ChargenSnapshot {
  return runAction(snap.character, { kind: "enlist", opts }, []).snapshot;
}

/** Run one service term. ACG dispatches into runAcgTerm; basic chargen
 *  runs the per-term step + skill picks. Routes phase based on the
 *  term's outcome (skill picks pending, deceased, mustered out, etc.). */
export function runTerm(snap: ChargenSnapshot): ChargenSnapshot {
  // If a player choice is still pending, refuse to advance — the term
  // action is paused on its frontier and must be resolved first (the UI
  // shows only the PendingChoicesPanel while paused). Soft identity
  // return: the panel's resolve action is the only way forward.
  if (snap.character.pendingChoices.length > 0) return snap;
  return runAction(snap.character, { kind: "runTerm" }, []).snapshot;
}

/** Pick a skill table (or pass 0 for the service's default). Advances
 *  to the next skill-pick phase, the cascade-resolution flow, or
 *  end-of-term. */
export function pickSkill(snap: ChargenSnapshot, table: number): ChargenSnapshot {
  return runAction(snap.character, { kind: "pickSkill", table }, []).snapshot;
}

/** Voluntary muster-out — player chose to leave service when they were
 *  eligible to stay. */
export function attemptMusterOut(snap: ChargenSnapshot): ChargenSnapshot {
  if (snap.character.mandatoryReenlistment) return snap;
  return runAction(snap.character, { kind: "attemptMusterOut" }, []).snapshot;
}

/** Apply one muster-out cash or benefit roll. */
export function musterChoice(
  snap: ChargenSnapshot,
  kind: "cash" | "benefit",
): ChargenSnapshot {
  return runAction(snap.character, { kind: "musterChoice", choice: kind }, []).snapshot;
}

/** Update the showHistory level on a snapshot's character. Also patches the
 *  frontier base (when paused) so a re-execution keeps the new level. */
export function setVerbose(snap: ChargenSnapshot, verbose: boolean): ChargenSnapshot {
  const ch = cloneCharacter(snap.character);
  ch.showHistory = verbose ? "verbose" : "simple";
  if (!snap.frontier) return { character: ch, phase: snap.phase };
  const base = cloneCharacter(snap.frontier.base);
  base.showHistory = ch.showHistory;
  return {
    character: ch,
    phase: snap.phase,
    frontier: { ...snap.frontier, base },
  };
}

// ---------------------------------------------------------------------------
// Action bodies. Straight-through flows on the working copy — no pauseGuard
// here; ChoicePendingError propagates to runAction's boundary.
// ---------------------------------------------------------------------------

function doApplyPreCareer(ch: Character, opt: PreCareerOption): ChargenResult {
  if (opt === "skip") {
    return { snapshot: { character: ch, phase: ch.useAcg ? "acg_enlist" : "career" } };
  }
  const r = ch.doPreCareer(opt);
  const hints: UiHints = {};
  if (r.autoEnlistPathway) {
    ch.acgPathway = r.autoEnlistPathway;
    hints.acgPathway = r.autoEnlistPathway;
    const branch = ch.acgState?.preCareerBranch;
    if (branch === "army" || branch === "marines") hints.acgService = branch;
    if (r.autoEnlistPathway === "navy" && opt === "navalAcademy") {
      hints.acgFleet = "imperialNavy";
    }
  }
  return { snapshot: { character: ch, phase: "pre_career" }, hints };
}

function doEnlist(ch: Character, opts: EnlistOptions): ChargenSnapshot {
  ch.showHistory = opts.verbose ? "verbose" : "simple";
  if (ch.useAcg && ch.acgPathway) {
    // PM p. 44: Merchant Academy may only be attempted after enlisting in a
    // Megacorp or Sector-wide line — the eligible line types are read from
    // acg.common.preCareerOptions.merchantAcademy.requiresLineType (the same
    // read preCareer.ts's admission gate performs).
    const merchantAcademy = getEdition(ch.editionId).data
      .advancedCharacterGeneration?.common?.preCareerOptions?.merchantAcademy as
      { requiresLineType?: string[] } | undefined;
    if (ch.acgPathway === "merchantPrince" &&
        (merchantAcademy?.requiresLineType ?? []).includes(opts.acgLineType) &&
        opts.acgMerchantAcademy) {
      // Stash attemptMerchantAcademy on acgState before beginAcg
      // consumes it. Initialize acgState if it doesn't exist yet.
      if (!ch.acgState) ch.acgState = freshAcgState("merchantPrince");
      ch.acgState.attemptMerchantAcademy = true;
    }
    try {
      ch.beginAcg(ch.acgPathway as "mercenary" | "navy" | "scout" | "merchantPrince", {
        service: opts.acgService,
        combatArm: opts.acgCombatArm,
        fleet: opts.acgFleet,
        division: opts.acgDivision,
        lineType: opts.acgLineType,
        ...(opts.acgSubsectorTech ? { subsectorTechCode: opts.acgSubsectorTech } : {}),
      });
    } catch (err) {
      // A pause is not a failure — let it unwind to the session boundary.
      if (err instanceof ChoicePendingError) throw err;
      ch.log(ev.endGeneration(
        "retired",
        `ACG enlistment failed: ${(err as Error).message}`,
      ));
      return { character: ch, phase: "end" };
    }
  } else {
    ch.service = ch.doEnlistment(
      opts.preferredService === "random" ? "" : opts.preferredService,
    );
  }
  return { character: ch, phase: "term" };
}

function doRunTerm(ch: Character): ChargenSnapshot {
  // Some services (CoTI nobles) derive starting rank from social standing
  // each term rather than by a promotion roll. The rule lives in the
  // service's JSON rankBySocial block; absent for services promoted by roll
  // (e.g. MT nobles use a Position check, so their rank is untouched here).
  const rankRule = getEdition(ch.editionId).data.services[ch.service]?.rankBySocial;
  if (rankRule) {
    if (ch.attributes.social < rankRule.socialFloor) {
      ch.attributes.social = rankRule.socialFloor;
    }
    const startingRank = ch.attributes.social + rankRule.rankOffset;
    if (ch.rank < startingRank && startingRank >= 1 && startingRank <= rankRule.maxRank) {
      ch.rank = startingRank;
      ch.commissioned = true;
    }
  }
  ch.doServiceTermStep();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (ch.skillPoints > 0) {
    return { character: ch, phase: pickSkillPhase(ch) };
  }
  if (!ch.useAcg) {
    ch.enforceSkillCap();
    if (!ch.deceased) ch.doAging();
  }
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.activeDuty) return enterMuster(ch);
  return { character: ch, phase: "term" };
}

function doPickSkill(ch: Character, table: number): ChargenSnapshot {
  if (table === 0) {
    ch.muster.forceTable = false;
  } else {
    ch.muster.forceTable = true;
    ch.muster.forceTableIndex = table;
  }
  ch.skillPoints -= 1;
  getEditionServices(ch.editionId)[ch.service]!.acquireSkill(ch);
  if (ch.skillPoints > 0) {
    return { character: ch, phase: pickSkillPhase(ch) };
  }
  return finishTerm(ch);
}

/** End-of-term sequence — cap, aging, reenlistment, muster routing.
 *  Called once skillPoints reach 0. */
function finishTerm(ch: Character): ChargenSnapshot {
  ch.enforceSkillCap();
  if (!ch.deceased) ch.doAging();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.shortTermThisTerm && ch.activeDuty && !ch.deceased) {
    ch.doReenlistmentStep();
  }
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.activeDuty) return enterMuster(ch);
  return { character: ch, phase: "term" };
}

function doAttemptMusterOut(ch: Character): ChargenSnapshot {
  // Only stamp "voluntary muster" if chargen hasn't already ended with
  // a more specific reason (deceased, court-martial discharge, etc.).
  // Otherwise the original reason would be overwritten by the generic
  // voluntary-muster string.
  if (!ch.isChargenEnded) {
    ch.endChargenRetired(`voluntary muster after ${intToOrdinal(ch.terms)} term of service`);
  }
  return enterMuster(ch);
}

/** Shared muster-out entry: enters the mustered status, computes roll
 *  count, and routes to end (no rolls) or muster (rolls pending). */
function enterMuster(ch: Character): ChargenSnapshot {
  // Already entered muster — don't reset musterRolls (would discard
  // already-spent rolls if the UI dispatches enterMuster twice).
  if (ch.musteredOut) {
    if (ch.muster.musterRolls === 0) return { character: ch, phase: "end" };
    if (ch.muster.musterCashUsed >= maxCashRolls(ch)) return { character: ch, phase: "muster_no_cash" };
    return { character: ch, phase: "muster" };
  }
  ch.enterMustered();
  ch.muster.musterRolls = ch.musterOutRolls();
  if (ch.muster.musterRolls === 0) {
    ch.musterOutPay();
    ch.markMustered();
    return { character: ch, phase: "end" };
  }
  return { character: ch, phase: "muster" };
}

function doMusterChoice(ch: Character, kind: "cash" | "benefit"): ChargenSnapshot {
  const cashDM = cashDmFor(ch);
  const benefitsDM = benefitDmFor(ch);
  if (kind === "cash") {
    ch.muster.musterCashUsed += 1;
    ch.musterOutCash(cashDM);
  } else {
    ch.musterOutBenefit(benefitsDM);
  }
  ch.muster.musterRolls -= 1;
  if (ch.muster.musterRolls === 0) {
    ch.musterOutPay();
    ch.markMustered();
    return { character: ch, phase: "end" };
  }
  if (ch.muster.musterCashUsed >= maxCashRolls(ch)) {
    return { character: ch, phase: "muster_no_cash" };
  }
  return { character: ch, phase: "muster" };
}
