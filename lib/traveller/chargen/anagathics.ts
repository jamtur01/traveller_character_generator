// Anagathics (PM p. 15). Extracted from character.ts so the state/
// behavior split keeps the class file focused on state + lifecycle
// helpers. The Character methods remain as thin shims for backward
// compatibility; engine call sites should prefer the free functions.

import type { Character } from "@/lib/traveller/character";
import { roll } from "@/lib/traveller/random";
import { event as ev } from "@/lib/traveller/history";
import { getEdition } from "@/lib/traveller/editions";

interface AnagathicsRules {
  eligibility?: { minAge?: number; minTerms?: number };
  availability?: {
    target?: number;
    dms?: {
      byStarport?: Record<string, number>;
      byTech?: Record<string, number>;
    };
  };
}

function getAnagathicsRules(ch: Character): AnagathicsRules | null {
  const rules = getEdition(ch.editionId).rules.anagathics;
  return (rules as AnagathicsRules) ?? null;
}

/** Try to obtain anagathics for the upcoming term. Eligibility = age ≥
 *  rules.eligibility.minAge (default 30) AND terms ≥ minTerms (default
 *  3). On availability failure with `allowRetry`, makes an extra
 *  survival roll: pass → one retry; fail → forced short-term muster. */
export function tryAnagathics(ch: Character, allowRetry = true): boolean {
  const rules = getAnagathicsRules(ch);
  const minAge = rules?.eligibility?.minAge ?? 30;
  const minTerms = rules?.eligibility?.minTerms ?? 3;
  if (ch.age < minAge || ch.terms < minTerms) {
    ch.log(ev.anagathics("unavailable"));
    return false;
  }
  const result = rollAnagathicsAvailability(ch);
  if (result) return true;
  if (!allowRetry) return false;
  if (!rollAnagathicsRetrySurvival(ch)) return false;
  return rollAnagathicsAvailability(ch);
}

/** Roll 2D + starport/tech DMs against the availability target. Applies
 *  on-found state mutations (onAnagathics, anagathicsActiveThisTerm,
 *  anagathicsEverTaken, anagathicsBenefitForfeitedTerms,
 *  anagathicsWithdrawalThisTerm) and on-lost mutations (withdrawal
 *  flag + clear onAnagathics). */
function rollAnagathicsAvailability(ch: Character): boolean {
  const rules = getAnagathicsRules(ch);
  const target = rules?.availability?.target ?? 12;
  const starportDms = rules?.availability?.dms?.byStarport ?? {};
  const techDms = rules?.availability?.dms?.byTech ?? {};
  let dm = 0;
  const sp = ch.homeworld?.starport;
  if (sp && starportDms[sp] !== undefined) dm += starportDms[sp]!;
  const t = ch.homeworld?.tech;
  if (t && techDms[t] !== undefined) dm += techDms[t]!;
  const r = roll(2) + dm;
  const success = r >= target;
  if (success) {
    if (!ch.onAnagathics) ch.apparentAge = ch.age;
    ch.onAnagathics = true;
    ch.anagathicsActiveThisTerm = true;
    ch.anagathicsEverTaken = true;
    ch.anagathicsBenefitForfeitedTerms += 1;
    // The retry path can flip from "lost supply" to "found supply"
    // within the same term — clear any withdrawal flag set by the
    // failed attempt so the character doesn't get withdrawal effects.
    ch.anagathicsWithdrawalThisTerm = false;
    ch.log(ev.anagathics("found", r, target));
  } else if (ch.onAnagathics) {
    ch.log(ev.anagathics("lost", r, target));
    ch.anagathicsWithdrawalThisTerm = true;
    ch.onAnagathics = false;
  } else {
    ch.log(ev.anagathics("unavailable", r, target));
  }
  return success;
}

/** Extra survival roll gating the anagathics retry. On failure: forced
 *  short-term muster-out. Returns true if survival passed (retry
 *  authorized). */
function rollAnagathicsRetrySurvival(ch: Character): boolean {
  // Pre-enlistment: retry not available. Gate before calling
  // serviceDef() so a bare catch doesn't swallow real errors like
  // ChoicePendingError thrown from checkSurvival.
  if (!ch.service) return false;
  const svc = ch.serviceDef();
  const passed = svc.checkSurvival(ch);
  if (!passed) {
    ch.shortTermsCount += 1;
    ch.endChargenRetired("failed anagathics retry survival");
  }
  return passed;
}

/** Pre-survival hook. If anagathicsStandingOrder is set and the
 *  character meets eligibility, set wantsAnagathicsThisTerm and attempt
 *  to locate a supply. Called at term start before survival. */
export function preSurvivalAnagathicsHook(ch: Character): void {
  if (!ch.anagathicsStandingOrder) return;
  const rules = getAnagathicsRules(ch);
  const minAge = rules?.eligibility?.minAge ?? 30;
  const minTerms = rules?.eligibility?.minTerms ?? 3;
  if (ch.age < minAge || ch.terms < minTerms) return;
  ch.wantsAnagathicsThisTerm = true;
  tryAnagathics(ch);
}

/** Voluntarily stop taking anagathics. Reverts to normal survival;
 *  withdrawal applies at term end. */
export function discontinueAnagathics(ch: Character): void {
  if (!ch.onAnagathics) return;
  ch.onAnagathics = false;
  ch.anagathicsActiveThisTerm = false;
  ch.anagathicsWithdrawalThisTerm = true;
  ch.log(ev.anagathics("withdrawal"));
}
