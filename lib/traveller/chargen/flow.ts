// Shared, model-agnostic chargen flow helpers: end-of-term routing and
// mustering-out. Both the classic and acg models call these, so the muster and
// term-end mechanics live in ONE place instead of being duplicated per model.
//
// These operate on the working character (already cloned + cursor-armed by the
// session's runAction) and return the routing snapshot. They may throw
// ChoicePendingError via the Character methods they call; that unwinds to
// runAction's boundary.

import type { Character } from "@/lib/traveller/character";
import { cashDmFor, benefitDmFor, maxCashRolls } from "@/lib/traveller/core";
import { intToOrdinal } from "@/lib/traveller/formatting";
import type { ChargenPhase, ChargenSnapshot } from "@/lib/traveller/chargen/session";

/** Which skill-picker phase to enter based on the pending picker context. The
 *  distinction is for the UI stepper only; the engine treats them identically. */
export function pickSkillPhase(ch: Character): ChargenPhase {
  return ch.muster.forceTableIndex >= 3 ? "skill_adv" : "skill_basic";
}

/** End-of-term sequence — skill cap, aging, reenlistment, muster routing.
 *  Called once a term's skill points reach 0. */
export function finishTerm(ch: Character): ChargenSnapshot {
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

/** Voluntary muster-out — the player chose to leave when eligible to stay.
 *  Only stamps "voluntary muster" if chargen has not already ended with a
 *  more specific reason (deceased, court-martial discharge, etc.). */
export function doAttemptMusterOut(ch: Character): ChargenSnapshot {
  if (!ch.isChargenEnded) {
    ch.endChargenRetired(
      `voluntary muster after ${intToOrdinal(ch.terms)} term of service`,
    );
  }
  return enterMuster(ch);
}

/** Shared muster-out entry: enters the mustered status, computes the roll
 *  count, and routes to end (no rolls) or muster (rolls pending). Idempotent
 *  on re-entry — does not reset musterRolls if already mustered. */
export function enterMuster(ch: Character): ChargenSnapshot {
  if (ch.musteredOut) {
    if (ch.muster.musterRolls === 0) return { character: ch, phase: "end" };
    if (ch.muster.musterCashUsed >= maxCashRolls(ch)) {
      return { character: ch, phase: "muster_no_cash" };
    }
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

/** Apply one muster-out cash or benefit roll and route to the next phase. */
export function doMusterChoice(
  ch: Character,
  kind: "cash" | "benefit",
): ChargenSnapshot {
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
