// Service-term orchestration: resets per-term flags, logs the term
// boundary + anagathics hook, and dispatches to the engine runner
// (basic chargen) or runAcgTerm (ACG).

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { runAcgTerm } from "@/lib/traveller/engine/runners/acg";
import { runTermSteps } from "@/lib/traveller/engine/runners/basic";

/** Run one service term. Increments terms/age (basic chargen only —
 *  ACG does its own per-year accounting). */
export function doServiceTermStep(ch: Character): void {
  // Consume per-term status markers from the prior term — a
  // mandatory-reenlist is served by entering this term; an unhandled
  // shortTerm (rare) is reset on term entry.
  if (ch.chargenStatus.kind === "mandatoryReenlist"
      || ch.chargenStatus.kind === "shortTerm") {
    ch.resumeActive();
  }
  // Resume detection (ACG only): a prior runAcgYear paused on a player
  // choice (decoration-DM tradeoff, brownie-point review, etc.). The
  // session layer re-enters doServiceTermStep after the choice resolves;
  // we must NOT re-emit termBegin/section or reset anagathics flags on
  // the resumed pass, or each Run-term click duplicates the term header.
  const acgResuming = ch.useAcg && !!ch.acgState && (
    ch.acgState.perYear.pausedAtStep != null
    || ch.acgState.termStartYearsServed !== undefined
  );
  if (!acgResuming) {
    // Reset per-term anagathics flags; intent for this term is set below
    // from the standing order (or by an explicit pre-survival call).
    ch.anagathics.resetPerTerm();
    ch.log(ev.section("--------------------------------------------"));
  }
  if (ch.useAcg && ch.acgState) {
    // ACG runs its own per-year cycle inside runAcgTerm.
    if (!acgResuming) {
      const isFirstTerm = ch.terms === 0;
      const shortTerm = isFirstTerm
        && ch.acgState.preCareerFirstTermShort === true;
      ch.log(ev.termBegin(
        ch.terms + 1, ch.age,
        shortTerm
          ? { shortTerm: true, shortTermReason: "pre-career failure (PM p. 47)" }
          : undefined,
      ));
    }
    runAcgTerm(ch);
    return;
  }
  ch.terms += 1;
  ch.age += ch.fullTermYears();
  ch.log(ev.termBegin(ch.terms, ch.age));
  // Anagathics supply check happens before survival (per PM p. 15)
  // — supply outcome modifies the survival DM. Log order: termBegin
  // → anagathics → survival so the story reads naturally.
  ch.preSurvivalAnagathicsHook();
  runTermSteps(ch);
}
