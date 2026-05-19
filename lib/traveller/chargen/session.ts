// Chargen session — pure flow logic extracted from the React layer.
//
// Why this exists: the page.tsx handlers (runTerm, musterChoice, finishTerm,
// resolvePending, attemptMusterOut, pickSkill, applyPreCareer, enlist, ...)
// own decisions like "after the muster cash roll completes, should phase
// transition to end / muster_no_cash / muster?". Each handler duplicates the
// pause-resume + ChoicePendingError plumbing. Three of the last four bugs
// were in this flow control. Moving it to the engine layer:
//   - Makes the flow testable independent of React.
//   - Lets the UI become a renderer keyed by the returned phase.
//   - Concentrates the ChoicePendingError handling in one place.
//
// Each action is a pure function: (snapshot, ...args) → new snapshot. The
// caller (React component) cloneCharacters as it sees fit; this module
// doesn't mutate the inputs.

import { Character, cloneCharacter } from "../character";
import { ChoicePendingError } from "../engine/choices";
import { runAcgYear } from "../engine/runners/acg";
import { getEditionServices } from "../services";
import { editionHasAcg } from "../engine/acg";
import { freshAcgState } from "../engine/acg/types";
import { event as ev } from "../history";
import { cashDmFor, benefitDmFor, maxCashRolls } from "../engine/musterDm";
import { intToOrdinal } from "../formatting";

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

export interface ChargenSnapshot {
  character: Character;
  phase: ChargenPhase;
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
function pickSkillPhase(c: Character): ChargenPhase {
  // The phase distinction is for the UI's stepper / progress bar only;
  // the engine treats the two identically.
  return c.forceTableIndex >= 3 ? "skill_adv" : "skill_basic";
}

export interface StartCareerOptions {
  edition: string;
  verbose: boolean;
  interactiveMode: boolean;
  supportsInteractive: boolean;
  useAcg: boolean;
  acgPathway: string;
}

/** Begin a new character. Decides whether to enter pre-career (ACG) or
 *  jump straight to basic enlistment. */
export function startCareer(opts: StartCareerOptions): ChargenSnapshot {
  const c = new Character();
  c.editionId = opts.edition;
  c.showHistory = opts.verbose ? "verbose" : "simple";
  // Set choiceMode before generateHomeworld so that any homeworld
  // generation step that consults choiceMode (e.g., future interactive
  // homeworld picks) sees the configured mode rather than the default.
  c.choiceMode = (opts.interactiveMode && opts.supportsInteractive)
    ? "interactive"
    : "auto";
  c.generateHomeworld();
  if (opts.useAcg && editionHasAcg(opts.edition) && opts.acgPathway) {
    c.useAcg = true;
    c.acgPathway = opts.acgPathway;
    return { character: c, phase: "pre_career" };
  }
  return { character: c, phase: "career" };
}

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool" | "skip";

/** Apply a pre-career option. Honors a chained-academic-progression: an
 *  honors college grad may chain into medical/flight school; an academy
 *  honors grad may try medical/flight. Returns hints for the UI's
 *  enlistment-form config (e.g., naval academy honors → navy/imperialNavy). */
export function applyPreCareer(
  snap: ChargenSnapshot,
  opt: PreCareerOption,
): ChargenResult {
  const c = cloneCharacter(snap.character);
  if (opt === "skip") {
    return { snapshot: { character: c, phase: c.useAcg ? "acg_enlist" : "career" } };
  }
  let r: ReturnType<typeof c.doPreCareer>;
  try {
    r = c.doPreCareer(opt);
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
    return { snapshot: { character: c, phase: "pre_career" } };
  }
  const hints: UiHints = {};
  if (r.autoEnlistPathway) {
    c.acgPathway = r.autoEnlistPathway;
    hints.acgPathway = r.autoEnlistPathway;
    const branch = c.acgState?.preCareerBranch;
    if (branch === "army" || branch === "marines") hints.acgService = branch;
    if (r.autoEnlistPathway === "navy" && opt === "navalAcademy") {
      hints.acgFleet = "imperialNavy";
    }
  }
  return { snapshot: { character: c, phase: "pre_career" }, hints };
}

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

export function enlist(snap: ChargenSnapshot, opts: EnlistOptions): ChargenSnapshot {
  const c = cloneCharacter(snap.character);
  c.showHistory = opts.verbose ? "verbose" : "simple";
  if (c.useAcg && c.acgPathway) {
    if (c.acgPathway === "merchantPrince" &&
        (opts.acgLineType === "Megacorp" || opts.acgLineType === "Sector-wide") &&
        opts.acgMerchantAcademy) {
      // Stash attemptMerchantAcademy on acgState before beginAcg
      // consumes it. Initialize acgState if it doesn't exist yet.
      if (!c.acgState) c.acgState = freshAcgState("merchantPrince");
      c.acgState.attemptMerchantAcademy = true;
    }
    try {
      c.beginAcg(c.acgPathway as "mercenary" | "navy" | "scout" | "merchantPrince", {
        service: opts.acgService,
        combatArm: opts.acgCombatArm,
        fleet: opts.acgFleet,
        division: opts.acgDivision,
        lineType: opts.acgLineType,
        ...(opts.acgSubsectorTech ? { subsectorTechCode: opts.acgSubsectorTech } : {}),
      });
    } catch (err) {
      c.log(ev.endGeneration(
        "retired",
        `ACG enlistment failed: ${(err as Error).message}`,
      ));
      return { character: c, phase: "end" };
    }
  } else {
    c.service = c.doEnlistment(
      opts.preferredService === "random" ? "" : opts.preferredService,
    );
  }
  return { character: c, phase: "term" };
}

/** Resolve a pending player choice. Handles the entire choice-chain
 *  drain (nested cascades, queueBpReview, etc.), ACG runner resumption,
 *  and post-drain phase transitions (muster cascade finalization,
 *  basic-chargen skill-pick advancement). */
export function resolvePending(
  snap: ChargenSnapshot,
  choiceId: string,
  optionIdx: number,
): ChargenSnapshot {
  const c = cloneCharacter(snap.character);
  const phase = snap.phase;
  try {
    c.resolveChoice(choiceId, optionIdx);
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
  }
  if (c.useAcg && c.acgState?.pausedAtStep && c.pendingChoices.length === 0) {
    try {
      runAcgYear(c);
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
    }
  }
  if (c.pendingChoices.length > 0) {
    return { character: c, phase };
  }
  // Muster roll finalization (deferred from musterChoice when the cascade
  // paused). The sentinel persists across nested choices (e.g. skillCap
  // queued from addSkill); decrement only when the entire chain drains.
  if (c.pendingMusterRoll) {
    c.pendingMusterRoll = false;
    // Defensive: never decrement below zero. The sentinel/decrement
    // pairing is supposed to be exact, but a redundant drain (e.g., a
    // nested choice chain finalized via another path first) must not
    // corrupt the roll budget.
    if (c.musterRolls > 0) c.musterRolls -= 1;
    if (c.musterRolls === 0) {
      c.musterOutPay();
      c.markMustered();
      return { character: c, phase: "end" };
    }
    if (c.musterCashUsed >= maxCashRolls(c)) {
      return { character: c, phase: "muster_no_cash" };
    }
    return { character: c, phase: "muster" };
  }
  // Basic-chargen skill-pick advancement.
  if (!c.useAcg && (phase === "skill_basic" || phase === "skill_adv")) {
    if (c.skillPoints > 0) {
      return { character: c, phase: pickSkillPhase(c) };
    }
    return finishTerm(c);
  }
  return { character: c, phase };
}

/** Run one service term. ACG dispatches into runAcgTerm; basic chargen
 *  runs the per-term step + skill picks. Routes phase based on the
 *  term's outcome (skill picks pending, deceased, mustered out, etc.). */
export function runTerm(snap: ChargenSnapshot): ChargenSnapshot {
  // If a player choice is still queued from a prior pause, refuse to
  // advance — running the term would re-enter the paused step with the
  // choice still unresolved, advancing dice rolls with default values
  // for the un-chosen parameter (e.g., the decoration-DM tradeoff).
  // The UI's PendingChoicesPanel renders alongside the Run term button,
  // so the player has the resolve action in front of them.
  if (snap.character.pendingChoices.length > 0) return snap;
  const c = cloneCharacter(snap.character);
  // CT nobles rank-from-social: starting rank is social - 10, capped at 5.
  // MT defines `nobles` differently (Position check at PM data line 2390);
  // applying CT's rank derivation there would corrupt MT noble starting state.
  if (c.editionId === "ct-classic" && c.service === "nobles") {
    if (c.attributes.social < 10) c.attributes.social = 10;
    const startingRank = c.attributes.social - 10;
    if (c.rank < startingRank && startingRank >= 1 && startingRank <= 5) {
      c.rank = startingRank;
      c.commissioned = true;
    }
  }
  try {
    c.doServiceTermStep();
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
    return { character: c, phase: "term" };
  }
  if (c.deceased) return { character: c, phase: "end" };
  if (c.skillPoints > 0) {
    return { character: c, phase: pickSkillPhase(c) };
  }
  if (!c.useAcg) {
    try {
      c.enforceSkillCap();
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
      return { character: c, phase: "term" };
    }
  }
  if (!c.useAcg && !c.deceased) c.doAging();
  if (c.deceased) return { character: c, phase: "end" };
  if (!c.activeDuty) return enterMuster(c);
  return { character: c, phase: "term" };
}

/** Pick a skill table (or pass 0 for the service's default). Advances
 *  to the next skill-pick phase, the cascade-resolution flow, or
 *  end-of-term. */
export function pickSkill(snap: ChargenSnapshot, table: number): ChargenSnapshot {
  const c = cloneCharacter(snap.character);
  if (table === 0) {
    c.forceTable = false;
  } else {
    c.forceTable = true;
    c.forceTableIndex = table;
  }
  c.skillPoints -= 1;
  try {
    getEditionServices(c.editionId)[c.service]!.acquireSkill(c);
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
    return { character: c, phase: pickSkillPhase(c) };
  }
  if (c.skillPoints > 0) {
    return { character: c, phase: pickSkillPhase(c) };
  }
  return finishTerm(c);
}

/** End-of-term sequence — cap, aging, reenlistment, muster routing.
 *  Called once skillPoints reach 0 and no cascade choices remain. */
function finishTerm(c: Character): ChargenSnapshot {
  try {
    c.enforceSkillCap();
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
    return { character: c, phase: "term" };
  }
  if (!c.deceased) c.doAging();
  if (c.deceased) return { character: c, phase: "end" };
  if (!c.shortTermThisTerm && c.activeDuty && !c.deceased) {
    try {
      c.doReenlistmentStep();
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
      return { character: c, phase: "term" };
    }
  }
  if (c.deceased) return { character: c, phase: "end" };
  if (!c.activeDuty) return enterMuster(c);
  return { character: c, phase: "term" };
}

/** Voluntary muster-out — player choose to leave service when they were
 *  eligible to stay. */
export function attemptMusterOut(snap: ChargenSnapshot): ChargenSnapshot {
  const prev = snap.character;
  if (prev.mandatoryReenlistment) return snap;
  const c = cloneCharacter(prev);
  // Only stamp "voluntary muster" if chargen hasn't already ended with
  // a more specific reason (deceased, court-martial discharge, etc.).
  // Otherwise the original reason would be overwritten by the generic
  // voluntary-muster string.
  if (!c.isChargenEnded) {
    c.endChargenRetired(`voluntary muster after ${intToOrdinal(c.terms)} term of service`);
  }
  return enterMuster(c);
}

/** Shared muster-out entry: enters the mustered status, computes roll
 *  count, and routes to end (no rolls) or muster (rolls pending). */
function enterMuster(c: Character): ChargenSnapshot {
  // Already entered muster — don't reset musterRolls (would discard
  // already-spent rolls if the UI dispatches enterMuster twice).
  if (c.musteredOut) {
    if (c.musterRolls === 0) return { character: c, phase: "end" };
    if (c.musterCashUsed >= maxCashRolls(c)) return { character: c, phase: "muster_no_cash" };
    return { character: c, phase: "muster" };
  }
  c.enterMustered();
  c.musterRolls = c.musterOutRolls();
  if (c.musterRolls === 0) {
    c.musterOutPay();
    c.markMustered();
    return { character: c, phase: "end" };
  }
  return { character: c, phase: "muster" };
}

/** Apply one muster-out cash or benefit roll. Handles the cascade-pauses
 *  case by setting pendingMusterRoll (resolvePending finalizes when the
 *  choice chain drains). */
export function musterChoice(
  snap: ChargenSnapshot,
  kind: "cash" | "benefit",
): ChargenSnapshot {
  const c = cloneCharacter(snap.character);
  const cashDM = cashDmFor(c);
  const benefitsDM = benefitDmFor(c);
  // Increment musterCashUsed BEFORE musterOutCash since the call can
  // throw ChoicePendingError mid-cascade. Without this ordering, a
  // paused cash roll wouldn't count toward maxCashRolls on resume — the
  // user could pick "cash" again past the cap.
  if (kind === "cash") c.musterCashUsed += 1;
  try {
    if (kind === "cash") {
      c.musterOutCash(cashDM);
    } else {
      c.musterOutBenefit(benefitsDM);
    }
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
    c.pendingMusterRoll = true;
    return { character: c, phase: snap.phase };
  }
  c.musterRolls -= 1;
  if (c.musterRolls === 0) {
    c.musterOutPay();
    c.markMustered();
    return { character: c, phase: "end" };
  }
  if (c.musterCashUsed >= maxCashRolls(c)) {
    return { character: c, phase: "muster_no_cash" };
  }
  return { character: c, phase: "muster" };
}

/** Update the showHistory level on a snapshot's character. */
export function setVerbose(snap: ChargenSnapshot, verbose: boolean): ChargenSnapshot {
  const c = cloneCharacter(snap.character);
  c.showHistory = verbose ? "verbose" : "simple";
  return { character: c, phase: snap.phase };
}
