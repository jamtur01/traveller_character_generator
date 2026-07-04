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

import { Character, cloneCharacter, type PreCareerOutcome } from "@/lib/traveller/character";
import { pauseGuard } from "@/lib/traveller/engine/choices";
import { runAcgYear } from "@/lib/traveller/engine/runners/acg";
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
  /** Seed the character's RNG for a reproducible run (see chargen/replay). */
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
    ch.useAcg = true;
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
  const ch = cloneCharacter(snap.character);
  if (opt === "skip") {
    return { snapshot: { character: ch, phase: ch.useAcg ? "acg_enlist" : "career" } };
  }
  let outcome: PreCareerOutcome | undefined;
  if (pauseGuard(() => { outcome = ch.doPreCareer(opt); }) === "paused") {
    return { snapshot: { character: ch, phase: "pre_career" } };
  }
  const r = outcome!;
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
  const ch = cloneCharacter(snap.character);
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

/** Resolve a pending player choice. Handles the entire choice-chain
 *  drain (nested cascades, queueBpReview, etc.), ACG runner resumption,
 *  and post-drain phase transitions (muster cascade finalization,
 *  basic-chargen skill-pick advancement). */
export function resolvePending(
  snap: ChargenSnapshot,
  choiceId: string,
  optionIdx: number,
): ChargenSnapshot {
  const ch = cloneCharacter(snap.character);
  const phase = snap.phase;
  pauseGuard(() => ch.resolveChoice(choiceId, optionIdx));
  if (ch.useAcg && ch.acgState?.perYear.pausedAtStep && ch.pendingChoices.length === 0) {
    pauseGuard(() => runAcgYear(ch));
  }
  if (ch.pendingChoices.length > 0) {
    return { character: ch, phase };
  }
  // Muster roll finalization (deferred from musterChoice when the cascade
  // paused). The sentinel persists across nested choices (e.g. skillCap
  // queued from addSkill); decrement only when the entire chain drains.
  if (ch.muster.pendingMusterRoll) {
    ch.muster.pendingMusterRoll = false;
    // Defensive: never decrement below zero. The sentinel/decrement
    // pairing is supposed to be exact, but a redundant drain (e.g., a
    // nested choice chain finalized via another path first) must not
    // corrupt the roll budget.
    if (ch.muster.musterRolls > 0) ch.muster.musterRolls -= 1;
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
  // Basic-chargen skill-pick advancement.
  if (!ch.useAcg && (phase === "skill_basic" || phase === "skill_adv")) {
    if (ch.skillPoints > 0) {
      return { character: ch, phase: pickSkillPhase(ch) };
    }
    return finishTerm(ch);
  }
  return { character: ch, phase };
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
  const ch = cloneCharacter(snap.character);
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
  if (pauseGuard(() => ch.doServiceTermStep()) === "paused") {
    return { character: ch, phase: "term" };
  }
  if (ch.deceased) return { character: ch, phase: "end" };
  if (ch.skillPoints > 0) {
    return { character: ch, phase: pickSkillPhase(ch) };
  }
  if (!ch.useAcg) {
    if (pauseGuard(() => ch.enforceSkillCap()) === "paused") {
      return { character: ch, phase: "term" };
    }
  }
  if (!ch.useAcg && !ch.deceased) ch.doAging();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.activeDuty) return enterMuster(ch);
  return { character: ch, phase: "term" };
}

/** Pick a skill table (or pass 0 for the service's default). Advances
 *  to the next skill-pick phase, the cascade-resolution flow, or
 *  end-of-term. */
export function pickSkill(snap: ChargenSnapshot, table: number): ChargenSnapshot {
  const ch = cloneCharacter(snap.character);
  if (table === 0) {
    ch.muster.forceTable = false;
  } else {
    ch.muster.forceTable = true;
    ch.muster.forceTableIndex = table;
  }
  ch.skillPoints -= 1;
  const picked = pauseGuard(() => getEditionServices(ch.editionId)[ch.service]!.acquireSkill(ch));
  if (picked === "paused") {
    return { character: ch, phase: pickSkillPhase(ch) };
  }
  if (ch.skillPoints > 0) {
    return { character: ch, phase: pickSkillPhase(ch) };
  }
  return finishTerm(ch);
}

/** End-of-term sequence — cap, aging, reenlistment, muster routing.
 *  Called once skillPoints reach 0 and no cascade choices remain. */
function finishTerm(ch: Character): ChargenSnapshot {
  if (pauseGuard(() => ch.enforceSkillCap()) === "paused") {
    return { character: ch, phase: "term" };
  }
  if (!ch.deceased) ch.doAging();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.shortTermThisTerm && ch.activeDuty && !ch.deceased) {
    if (pauseGuard(() => ch.doReenlistmentStep()) === "paused") {
      return { character: ch, phase: "term" };
    }
  }
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.activeDuty) return enterMuster(ch);
  return { character: ch, phase: "term" };
}

/** Voluntary muster-out — player choose to leave service when they were
 *  eligible to stay. */
export function attemptMusterOut(snap: ChargenSnapshot): ChargenSnapshot {
  const prev = snap.character;
  if (prev.mandatoryReenlistment) return snap;
  const ch = cloneCharacter(prev);
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

/** Apply one muster-out cash or benefit roll. Handles the cascade-pauses
 *  case by setting pendingMusterRoll (resolvePending finalizes when the
 *  choice chain drains). */
export function musterChoice(
  snap: ChargenSnapshot,
  kind: "cash" | "benefit",
): ChargenSnapshot {
  const ch = cloneCharacter(snap.character);
  const cashDM = cashDmFor(ch);
  const benefitsDM = benefitDmFor(ch);
  // Increment musterCashUsed BEFORE musterOutCash since the call can
  // throw ChoicePendingError mid-cascade. Without this ordering, a
  // paused cash roll wouldn't count toward maxCashRolls on resume — the
  // user could pick "cash" again past the cap.
  if (kind === "cash") ch.muster.musterCashUsed += 1;
  const rolled = pauseGuard(() => {
    if (kind === "cash") ch.musterOutCash(cashDM);
    else ch.musterOutBenefit(benefitsDM);
  });
  if (rolled === "paused") {
    ch.muster.pendingMusterRoll = true;
    return { character: ch, phase: snap.phase };
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

/** Update the showHistory level on a snapshot's character. */
export function setVerbose(snap: ChargenSnapshot, verbose: boolean): ChargenSnapshot {
  const ch = cloneCharacter(snap.character);
  ch.showHistory = verbose ? "verbose" : "simple";
  return { character: ch, phase: snap.phase };
}
