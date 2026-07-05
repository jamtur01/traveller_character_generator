// ACG runner. Drives the per-year + per-term cycle for a character on
// the Advanced Character Generation path. Replaces the basic-flow
// `runTermSteps` for ACG characters.
//
// Pathway factories are supplied by each edition's hooks.acgPathways map
// (see lib/traveller/editions/<id>/hooks.ts). Adding a new pathway: drop a
// pathway module, declare its JSON block, register the factory in hooks.
// No edits to this file are required.
//
// Interactive choices: pickOrDefer either consumes a recorded decision
// inline (session decision cursor) or throws ChoicePendingError. The runner
// does NOT catch it — the pause unwinds to the session boundary, which
// snapshots the partial state and re-executes the whole term action from its
// pre-action base once the player picks. There is no mid-flight resume state
// here: every invocation runs straight through.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { requireHook } from "@/lib/traveller/engine/registry";
import { awardBrownie, bpAwardFor } from "@/lib/traveller/engine/acg/awards";
import { freshPerTerm } from "@/lib/traveller/engine/acg/state";
import { event as ev } from "@/lib/traveller/history";
import type { AcgPathwayImpl } from "@/lib/traveller/editions/types";
import { requireRule } from "@/lib/traveller/editions/strict";

/** Advance the character one year: chronological age, years-served, and the
 *  ACG year counter. Shared epilogue for the exit branches that skip the
 *  normal resolution cycle (initial training and the no-assignment no-op). */
function advanceYear(ch: Character, acg: NonNullable<Character["acgState"]>): void {
  ch.age += 1;
  acg.yearsServed = (acg.yearsServed ?? 0) + 1;
  acg.year += 1;
}

function getPathwayImpl(ch: Character): AcgPathwayImpl {
  if (!ch.acgState) throw new Error("Character has no acgState; not on ACG path");
  const hooks = getEdition(ch.editionId).hooks;
  const pathway = ch.acgState.pathway;
  return requireHook(hooks.acgPathways, pathway, () =>
    `No ACG pathway implementation for "${pathway}" in edition "${ch.editionId}". ` +
    `Register the factory in editions/${ch.editionId}/hooks.ts under acgPathways.`)();
}

/** Run a single one-year assignment. Each term contains four such years.
 *  Age is incremented per year so characters invalided / jailed / killed
 *  mid-term retain only the years they actually served (PM p. 15 — each
 *  assignment is a year of service).
 *
 *  Per the ACG checklist (PM "Resolve Current Year"): determine assignment
 *  FIRST, then command-duty within that assignment (officers only), then
 *  resolve, then age+count, then retention. */
export function runAcgYear(ch: Character): void {
  if (ch.deceased || !ch.activeDuty) return;
  if (!ch.acgState) throw new Error("Cannot run ACG year on non-ACG character");
  const p = getPathwayImpl(ch);
  const acg = ch.acgState;

  // First year of the first term is initial training (no normal cycle).
  if (ch.terms === 0 && acg.year === 1 && p.initialTraining) {
    p.initialTraining(ch);
    advanceYear(ch, acg);
    return;
  }

  // Roll the year's assignment (PM checklist 6.A.1). Capture retention
  // before the pathway clears the flag inside its rollAssignment — every
  // pathway with retention semantics consumes acg.justRetained internally.
  const wasRetained = acg.justRetained === true;
  const assignment: string | null = p.rollAssignment(ch);
  acg.currentAssignment = assignment;
  if (assignment) {
    ch.log(ev.assignmentRolled(
      assignment, ch.terms + 1, acg.year,
      wasRetained ? true : undefined,
    ));
  }

  // Command duty (officers only; per PM, after the assignment is known so
  // the player can decide whether to seek a command position).
  if (p.commandDuty && !acg.justRetained) p.commandDuty(ch);

  if (!assignment) {
    // Defensive: nothing to resolve. Treat as a no-op year.
    advanceYear(ch, acg);
    return;
  }

  // Resolve the assignment (or route through specialAssignment).
  if (assignment === "Special Duty" || assignment.toLowerCase() === "specialduty") {
    if (p.specialAssignment) p.specialAssignment(ch);
  } else {
    p.resolveAssignment(ch, assignment);
  }

  // Age + years bookkeeping.
  ch.age += 1;
  acg.yearsServed = (acg.yearsServed ?? 0) + 1;

  // Retention (if alive and still serving).
  if (p.retention && ch.activeDuty && !ch.deceased) p.retention(ch, assignment);

  acg.year += 1;
  acg.currentAssignment = null;
}

/** Run a full four-year term straight through. Time is accounted per year
 *  inside runAcgYear, so a character invalided/jailed/discharged mid-term
 *  keeps the years they actually served. Pathway endStateAtTerm completes
 *  the term with the partial-term info still visible. */
export function runAcgTerm(ch: Character): void {
  if (!ch.acgState) throw new Error("Cannot run ACG term on non-ACG character");
  if (ch.deceased || !ch.activeDuty) return;
  const p = getPathwayImpl(ch);
  // PM p. 15: anagathics intent is declared before the term's first
  // survival roll. Reset per-term flags and consult the standing order
  // so the year-1 survival roll sees the correct DM.
  ch.anagathics.resetPerTerm();
  ch.preSurvivalAnagathicsHook();
  if (p.startOfTerm) p.startOfTerm(ch);
  ch.acgState.year = 1;
  ch.acgState.perTerm = freshPerTerm();
  const yearsAtTermStart = ch.acgState.yearsServed ?? 0;
  // Rrev2: pre-career failure may force the first term to a short term
  // (rules.preCareer.shortFirstTermYears, PM p. 44) instead of the full
  // rules.survival.fullTermYears term. The flag fires on the very first
  // term only; we consume it here so subsequent terms run normally.
  const isFirstTerm = ch.terms === 0;
  const fullTermYears = ch.fullTermYears();
  const termLength = (isFirstTerm && ch.acgState.preCareerFirstTermShort)
    ? requireRule(
        getEdition(ch.editionId).rules.preCareer?.shortFirstTermYears,
        "rules.preCareer.shortFirstTermYears", "PM p. 44",
      )
    : fullTermYears;
  if (isFirstTerm && ch.acgState.preCareerFirstTermShort) {
    // The shortTerm flag is recorded in ev.termBegin (emitted in
    // doServiceTermStep); consume the marker so subsequent terms run normally.
    delete ch.acgState.preCareerFirstTermShort;
  }
  for (let y = 0; y < termLength; y++) {
    if (ch.deceased || !ch.activeDuty) break;
    runAcgYear(ch);
  }
  // Reset year so the next runAcgTerm call starts a fresh term cycle.
  ch.acgState.year = 1;
  const yearsThisTerm = (ch.acgState.yearsServed ?? 0) - yearsAtTermStart;
  // Advance terms by 1 whenever the character started (served ≥1 year of)
  // the term — the counter records terms entered, per the ACG rules. This
  // fires even when the character ended the term non-active (discharge or
  // death) in its FINAL year: serving the full termLength then being
  // discharged must still count one term, exactly as a mid-term exit does
  // (BUG-3 — the old "=== termLength && activeDuty" branch dropped this
  // case, so a year-4 discharge silently lost a muster-out roll while a
  // year-3 discharge kept it).
  if (yearsThisTerm > 0) {
    ch.terms += 1;
    // The brownie point is awarded only for a genuinely completed full
    // term (alive and still serving at term's end).
    if (yearsThisTerm === termLength && !ch.deceased && ch.activeDuty) {
      const termBp = bpAwardFor(ch, "Finish each 4-year term") ?? 0;
      awardBrownie(ch, termBp, `Completed ${termLength}-year term`);
    }
    // A term shorter than a full term — cut short mid-term, or a short
    // first term — is a partial term: it doesn't count toward full muster
    // benefits (handled in musterOutRolls), matching basic-flow accounting.
    if (yearsThisTerm < fullTermYears) {
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

  // End-of-term reenlistment is owned by the orchestrator step
  // doReenlistmentStep (which calls runAcgReenlist → p.reenlist). Firing
  // it here too would double-roll dice, double-emit ev.reenlistment, and
  // double-queue interactive branch-change choices.
}

/** Reenlistment check at the end of a term. */
export function runAcgReenlist(ch: Character): boolean {
  if (!ch.acgState) return false;
  if (ch.deceased || !ch.activeDuty) return false;
  return getPathwayImpl(ch).reenlist(ch);
}
