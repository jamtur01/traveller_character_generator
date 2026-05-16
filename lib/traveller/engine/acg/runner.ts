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

/** Run a single one-year assignment. Each term contains four such years. */
export function runAcgYear(ch: Character): void {
  if (ch.deceased || !ch.activeDuty) return;
  if (!ch.acgState) throw new Error("Cannot run ACG year on non-ACG character");
  const p = getPathwayImpl(ch);

  // First year of the first term is initial training (no normal cycle).
  if (ch.terms === 0 && ch.acgState.year === 1 && p.initialTraining) {
    p.initialTraining(ch);
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

  // Retention roll (if alive and still serving).
  if (p.retention && ch.activeDuty && !ch.deceased) {
    p.retention(ch, assignment);
  }

  ch.acgState.year += 1;
}

/** Run a full four-year term. Resolves end-of-term reenlistment so the
 *  caller can read ch.activeDuty / ch.mandatoryReenlistment to decide UI
 *  flow. (Pre-fix: reenlistment was never invoked from this path, so ACG
 *  characters never naturally mustered out.) */
export function runAcgTerm(ch: Character): void {
  if (!ch.acgState) throw new Error("Cannot run ACG term on non-ACG character");
  if (ch.deceased || !ch.activeDuty) return;
  const p = getPathwayImpl(ch);
  if (p.startOfTerm) p.startOfTerm(ch);
  ch.acgState.year = 1;
  ch.acgState.promotedThisTerm = false;
  for (let y = 0; y < 4; y++) {
    if (ch.deceased || !ch.activeDuty) break;
    runAcgYear(ch);
  }
  if (ch.deceased || !ch.activeDuty) return;

  awardBrownie(ch, 1, "Completed four-year term");
  ch.terms += 1;
  ch.age += 4;

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
