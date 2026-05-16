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
import { awardBrownie } from "./awards";
import type { AcgPathwayImpl } from "../../editions/types";

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
 *  assignment is a year of service). */
export function runAcgYear(ch: Character): void {
  if (ch.deceased || !ch.activeDuty) return;
  if (!ch.acgState) throw new Error("Cannot run ACG year on non-ACG character");
  const p = getPathwayImpl(ch);

  // First year of the first term is initial training (no normal cycle).
  if (ch.terms === 0 && ch.acgState.year === 1 && p.initialTraining) {
    p.initialTraining(ch);
    ch.age += 1;
    ch.acgState.yearsServed = (ch.acgState.yearsServed ?? 0) + 1;
    ch.acgState.year += 1;
    return;
  }

  // Officer command duty (no-op for enlisted).
  if (p.commandDuty && !ch.acgState.justRetained) {
    p.commandDuty(ch);
  }

  // Roll assignment (or use retained).
  const assignment = p.rollAssignment(ch);
  ch.acgState.currentAssignment = assignment;

  if (assignment === "Special Duty" || assignment.toLowerCase() === "specialduty") {
    if (p.specialAssignment) {
      p.specialAssignment(ch);
    }
  } else {
    p.resolveAssignment(ch, assignment);
  }

  // Year of service counted regardless of activeDuty outcome — the year
  // happened. Age advances after the assignment is resolved so any age-
  // limit checks during the assignment (e.g. OCS age 38) use the value at
  // the start of the year.
  ch.age += 1;
  ch.acgState.yearsServed = (ch.acgState.yearsServed ?? 0) + 1;

  // Retention roll (if alive and still serving).
  if (p.retention && ch.activeDuty && !ch.deceased) {
    p.retention(ch, assignment);
  }

  ch.acgState.year += 1;
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
