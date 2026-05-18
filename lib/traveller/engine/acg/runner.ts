// ACG runner. Drives the per-year + per-term cycle for a character on
// the Advanced Character Generation path. Replaces the basic-flow
// `runTermSteps` for ACG characters.
//
// Pathway factories are supplied by each edition's hooks.acgPathways map
// (see lib/traveller/editions/<id>/hooks.ts). Adding a new pathway: drop a
// pathway module, declare its JSON block, register the factory in hooks.
// No edits to this file are required.

import type { Character } from "../../character";
import { getEdition } from "../../editions";
import { ChoicePendingError } from "../choices";
import { awardBrownie } from "./awards";
import { event as ev } from "../../history";
import type { AcgPathwayImpl } from "../../editions/types";

/** Names for the sub-steps inside a single one-year assignment cycle.
 *  The runner walks these in order; the index is recorded in acgState.yearStep
 *  so an interactive choice that throws ChoicePendingError can be resumed
 *  by re-invoking runAcgYear after the choice resolves. */
// Per the ACG checklist (PM "Resolve Current Year"): determine assignment
// FIRST, then command-duty within that assignment (officers only), then
// resolve, then age+count, then retention. Pre-fix had commandDuty first.
const YEAR_STEPS = [
  "rollAssignment",
  "commandDuty",
  "resolveAssignment",
  "ageAndCount",
  "retention",
] as const;
type YearStep = typeof YEAR_STEPS[number];

function runStep(
  ch: Character, stepName: YearStep, fn: () => void,
): boolean {
  try {
    fn();
    return true;
  } catch (e) {
    if (e instanceof ChoicePendingError) {
      // Preserve where we paused so resumption picks the right step.
      ch.acgState!.pausedAtStep = stepName;
      return false;
    }
    throw e;
  }
}

function getPathwayImpl(ch: Character): AcgPathwayImpl {
  if (!ch.acgState) throw new Error("Character has no acgState; not on ACG path");
  const hooks = getEdition(ch.editionId).hooks;
  const factory = hooks.acgPathways?.[ch.acgState.pathway];
  if (!factory) {
    throw new Error(
      `No ACG pathway implementation for "${ch.acgState.pathway}" in edition "${ch.editionId}". ` +
      `Register the factory in editions/${ch.editionId}/hooks.ts under acgPathways.`,
    );
  }
  return factory();
}

/** Run a single one-year assignment. Each term contains four such years.
 *  Age is incremented per year so characters invalided / jailed / killed
 *  mid-term retain only the years they actually served (PM p. 15 — each
 *  assignment is a year of service).
 *
 *  Interactive-mode resumption: when a pathway substep calls
 *  ch.pickOrDefer, ChoicePendingError propagates here. We catch it via
 *  runStep, record acgState.pausedAtStep, and return without advancing
 *  the year. The UI calls resolveChoice (which runs the queued closure),
 *  then re-invokes runAcgYear, which resumes from the recorded step.
 */
export function runAcgYear(ch: Character): void {
  if (ch.deceased || !ch.activeDuty) return;
  if (!ch.acgState) throw new Error("Cannot run ACG year on non-ACG character");
  const p = getPathwayImpl(ch);
  const acg = ch.acgState;

  // First year of the first term is initial training (no normal cycle).
  if (ch.terms === 0 && acg.year === 1 && p.initialTraining &&
      !acg.initialTrainingDone) {
    const ok = runStep(ch, "commandDuty", () => p.initialTraining!(ch));
    if (!ok) return;
    acg.initialTrainingDone = true;
    ch.age += 1;
    acg.yearsServed = (acg.yearsServed ?? 0) + 1;
    acg.year += 1;
    acg.pausedAtStep = null;
    return;
  }

  // Pick up where we left off, if a previous run paused on a choice.
  const startIdx = acg.pausedAtStep
    ? Math.max(0, YEAR_STEPS.indexOf(acg.pausedAtStep as YearStep))
    : 0;

  // Step 0: roll the year's assignment (PM checklist 6.A.1).
  let assignment = acg.currentAssignment ?? null;
  if (startIdx <= 0) {
    // Capture retention before the pathway clears the flag inside its
    // rollAssignment. Every pathway with retention semantics (mercenary,
    // navy, scout, merchant) consumes acg.justRetained internally.
    const wasRetained = acg.justRetained === true;
    let rolled: string | null = null;
    const ok = runStep(ch, "rollAssignment", () => {
      rolled = p.rollAssignment(ch);
    });
    if (!ok) return;
    assignment = rolled;
    acg.currentAssignment = assignment;
    if (assignment) {
      ch.log(ev.assignmentRolled(
        assignment, ch.terms + 1, acg.year,
        wasRetained ? true : undefined,
      ));
    }
  }

  // Step 1: command duty (officers only; per PM, after the assignment is
  // known so the player can decide whether to seek a command position).
  if (startIdx <= 1) {
    if (p.commandDuty && !acg.justRetained) {
      const ok = runStep(ch, "commandDuty", () => p.commandDuty!(ch));
      if (!ok) return;
    }
  }
  if (!assignment) {
    // Defensive: nothing to resolve. Treat as a no-op year.
    ch.age += 1;
    acg.yearsServed = (acg.yearsServed ?? 0) + 1;
    acg.year += 1;
    acg.pausedAtStep = null;
    return;
  }

  // Step 2: resolve the assignment (or route through specialAssignment).
  if (startIdx <= 2) {
    const ok = runStep(ch, "resolveAssignment", () => {
      if (assignment === "Special Duty" || assignment!.toLowerCase() === "specialduty") {
        if (p.specialAssignment) p.specialAssignment(ch);
      } else {
        p.resolveAssignment(ch, assignment!);
      }
    });
    if (!ok) return;
  }

  // Step 3: age + years bookkeeping.
  if (startIdx <= 3) {
    ch.age += 1;
    acg.yearsServed = (acg.yearsServed ?? 0) + 1;
  }

  // Step 4: retention (if alive and still serving).
  if (startIdx <= 4) {
    if (p.retention && ch.activeDuty && !ch.deceased) {
      const ok = runStep(ch, "retention", () => p.retention!(ch, assignment!));
      if (!ok) return;
    }
  }

  acg.year += 1;
  acg.currentAssignment = null;
  acg.pausedAtStep = null;
}

/** Run a full four-year term. Time is accounted per year inside runAcgYear,
 *  so a character invalided/jailed/discharged mid-term keeps the years they
 *  actually served. Pathway endStateAtTerm completes the term with the
 *  partial-term info still visible. */
export function runAcgTerm(ch: Character): void {
  if (!ch.acgState) throw new Error("Cannot run ACG term on non-ACG character");
  if (ch.deceased || !ch.activeDuty) return;
  // PM p. 15: anagathics intent is declared before the term's first survival
  // roll. Reset per-term flags and consult the standing order so the year-1
  // survival roll sees the correct DM.
  ch.anagathicsActiveThisTerm = false;
  ch.anagathicsWithdrawalThisTerm = false;
  ch.wantsAnagathicsThisTerm = false;
  ch.preSurvivalAnagathicsHook();
  const p = getPathwayImpl(ch);
  if (p.startOfTerm) p.startOfTerm(ch);
  ch.acgState.year = 1;
  ch.acgState.promotedThisTerm = false;
  const yearsAtTermStart = ch.acgState.yearsServed ?? 0;
  // Rrev2: pre-career failure may force the first term to a short
  // 3-year term (PM p. 47). The flag fires on the very first term only;
  // we consume it here so subsequent terms run normally.
  const isFirstTerm = ch.terms === 0;
  const termLength = (isFirstTerm && ch.acgState.preCareerFirstTermShort) ? 3 : 4;
  if (isFirstTerm && ch.acgState.preCareerFirstTermShort) {
    // The shortTerm flag is recorded in ev.termBegin (emitted in
    // doServiceTermStep); consume the marker so subsequent terms run normally.
    delete ch.acgState.preCareerFirstTermShort;
  }
  for (let y = 0; y < termLength; y++) {
    if (ch.deceased || !ch.activeDuty) break;
    runAcgYear(ch);
  }
  const yearsThisTerm = (ch.acgState.yearsServed ?? 0) - yearsAtTermStart;
  // Always advance terms by 1 if the character started the term, even if
  // they didn't complete all four years — the term counter records terms
  // entered. A short term (< 4 years) is observable via yearsServed and
  // is not counted toward muster benefits (handled in musterOutRolls).
  if (yearsThisTerm > 0 && yearsThisTerm < termLength) {
    ch.acgState.partialTerms = (ch.acgState.partialTerms ?? 0) + 1;
    ch.terms += 1;
  } else if (yearsThisTerm === termLength && !ch.deceased && ch.activeDuty) {
    awardBrownie(ch, 1, `Completed ${termLength}-year term`);
    ch.terms += 1;
    // Mark a 3-year first term as a partial (it doesn't count for full
    // muster benefits per PM short-term rule, matching basic-flow short
    // term accounting).
    if (termLength === 3) {
      ch.acgState.partialTerms = (ch.acgState.partialTerms ?? 0) + 1;
    }
  }
  if (ch.deceased || !ch.activeDuty) return;

  // Per-pathway end-of-term hook. Merchant promotion exam runs here so the
  // DMs accumulated from this term's special-duty schools (Business
  // School: +1 exam DM for O6+ etc.) apply to the exam (PM p. 61).
  if (p.endOfTerm) p.endOfTerm(ch);
  if (ch.deceased || !ch.activeDuty) return;

  // PM ACG checklist (mtChecklist step 7): Conclude Current Term → enforce
  // the Int+Edu skill cap (PM p. 39), Aging, then Reenlistment, then Muster
  // Out. Aging fires after the cap so a player's reduced Edu doesn't shrink
  // the cap window after they've already committed to skills this term.
  ch.enforceSkillCap();
  if (ch.isChargenEnded) return;
  ch.doAging();
  if (ch.isChargenEnded) return;

  // F2/F3: PM p. 16 disability check happens after aging (which may have
  // dropped a physical attribute to 1 or pushed the age past the cap).
  const dis = ch.isDisabled();
  if (dis.disabled) {
    ch.endChargenRetired(`disability: ${dis.reasons.join("; ")}`);
    return;
  }

  // End-of-term reenlistment check. Pre-existing: doReenlistmentStep
  // also calls runAcgReenlist (which calls this same p.reenlist), so
  // we just flip status without firing endChargen* here — the caller's
  // doReenlistmentStep handles the endGeneration logging path.
  const keep = p.reenlist(ch);
  if (!keep) {
    ch.chargenStatus = { kind: "retired", reason: "denied reenlistment" };
  }
}

/** Reenlistment check at the end of a term. */
export function runAcgReenlist(ch: Character): boolean {
  if (!ch.acgState) return false;
  if (ch.deceased || !ch.activeDuty) return false;
  return getPathwayImpl(ch).reenlist(ch);
}
