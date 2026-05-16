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
import type { AcgPathwayImpl } from "../../editions/types";

/** Names for the sub-steps inside a single one-year assignment cycle.
 *  The runner walks these in order; the index is recorded in acgState.yearStep
 *  so an interactive choice that throws ChoicePendingError can be resumed
 *  by re-invoking runAcgYear after the choice resolves. */
const YEAR_STEPS = [
  "commandDuty",
  "rollAssignment",
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

  // Step 0: command duty (no-op for enlisted; skipped after retention).
  if (startIdx <= 0) {
    if (p.commandDuty && !acg.justRetained) {
      const ok = runStep(ch, "commandDuty", () => p.commandDuty!(ch));
      if (!ok) return;
    }
  }

  // Step 1: roll the year's assignment.
  let assignment = acg.currentAssignment ?? null;
  if (startIdx <= 1) {
    let rolled: string | null = null;
    const ok = runStep(ch, "rollAssignment", () => {
      rolled = p.rollAssignment(ch);
    });
    if (!ok) return;
    assignment = rolled;
    acg.currentAssignment = assignment;
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
  const p = getPathwayImpl(ch);
  if (p.startOfTerm) p.startOfTerm(ch);
  ch.acgState.year = 1;
  ch.acgState.promotedThisTerm = false;
  const yearsAtTermStart = ch.acgState.yearsServed ?? 0;
  for (let y = 0; y < 4; y++) {
    if (ch.deceased || !ch.activeDuty) break;
    runAcgYear(ch);
  }
  const yearsThisTerm = (ch.acgState.yearsServed ?? 0) - yearsAtTermStart;
  // Always advance terms by 1 if the character started the term, even if
  // they didn't complete all four years — the term counter records terms
  // entered. A short term (< 4 years) is observable via yearsServed and
  // is not counted toward muster benefits (handled in musterOutRolls).
  if (yearsThisTerm > 0 && yearsThisTerm < 4) {
    ch.acgState.partialTerms = (ch.acgState.partialTerms ?? 0) + 1;
    ch.terms += 1;
  } else if (yearsThisTerm === 4 && !ch.deceased && ch.activeDuty) {
    awardBrownie(ch, 1, "Completed four-year term");
    ch.terms += 1;
  }
  if (ch.deceased || !ch.activeDuty) return;

  // End-of-term reenlistment check.
  const keep = p.reenlist(ch);
  if (!keep) {
    ch.activeDuty = false;
  }
}

/** Reenlistment check at the end of a term. */
export function runAcgReenlist(ch: Character): boolean {
  if (!ch.acgState) return false;
  if (ch.deceased || !ch.activeDuty) return false;
  return getPathwayImpl(ch).reenlist(ch);
}
