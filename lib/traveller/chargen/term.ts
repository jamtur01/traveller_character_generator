// Service-term orchestration: resets per-term flags, logs the term
// boundary + anagathics hook, and dispatches to the engine runner
// (basic chargen) or runAcgTerm (ACG).

import type { Character } from "../character";
import { event as ev } from "../history";
import { runAcgTerm } from "../engine/acg/runner";
import { runTermSteps } from "../engine/runner";

/** Run one service term. Increments terms/age (basic chargen only —
 *  ACG does its own per-year accounting). */
export function doServiceTermStep(ch: Character): void {
  // Consume per-term markers from the prior term.
  ch.mandatoryReenlistment = false;
  ch.shortTermThisTerm = false;
  // Reset per-term anagathics flags; intent for this term is set below
  // from anagathicsStandingOrder (or by an explicit pre-survival call).
  ch.anagathicsActiveThisTerm = false;
  ch.anagathicsWithdrawalThisTerm = false;
  ch.wantsAnagathicsThisTerm = false;
  ch.log(ev.section("--------------------------------------------"));
  if (ch.useAcg && ch.acgState) {
    // ACG runs its own per-year cycle inside runAcgTerm.
    const isFirstTerm = ch.terms === 0;
    const shortTerm = isFirstTerm
      && ch.acgState.preCareerFirstTermShort === true;
    ch.log(ev.termBegin(
      ch.terms + 1, ch.age,
      shortTerm
        ? { shortTerm: true, shortTermReason: "pre-career failure (PM p. 47)" }
        : undefined,
    ));
    runAcgTerm(ch);
    return;
  }
  ch.terms += 1;
  ch.age += 4;
  ch.log(ev.termBegin(ch.terms, ch.age));
  // Anagathics supply check happens before survival (per PM p. 15)
  // — supply outcome modifies the survival DM. Log order: termBegin
  // → anagathics → survival so the story reads naturally.
  ch.preSurvivalAnagathicsHook();
  runTermSteps(ch);
}
