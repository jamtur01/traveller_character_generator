// Muster-out orchestration: cash + benefit rolls, retirement pay,
// per-pathway finalizers (Merchant Free Trader, Scout Detached Duty).
// Each function takes Character as its first arg so Character can stay
// focused on state + low-level mutators.

import type { Character } from "../character";
import { getEdition } from "../editions";
import { numCommaSep, attrShort } from "../formatting";
import { roll } from "../random";
import { event as ev } from "../history";
import type { AttributeKey } from "../types";
import { merchantFinalizeMuster, applyReducedPassageBenefit }
  from "../engine/acg/pathways/merchantPrince";
import { scoutFinalizeMuster } from "../engine/acg/pathways/scout";

/** Project the ACG officer rankCode onto basic-chargen `rank` (1-6) for
 *  muster-out DMs and rank-band extra rolls. Also consumes any pending
 *  SEH automatic +1 rank. Idempotent: safe to call before muster
 *  regardless of pathway. */
export function finalizeAcgRankForMuster(ch: Character): void {
  if (!ch.useAcg || !ch.acgState) return;
  // SEH automatic +1 rank at muster (manual p. 46). Consume the flag.
  if (ch.acgState.sehPromotionPending && ch.acgState.isOfficer) {
    const m = ch.acgState.rankCode.match(/^O(\d+)$/);
    if (m) {
      const next = Math.min(10, parseInt(m[1]!, 10) + 1);
      ch.acgState.rankCode = `O${next}`;
      ch.log(ev.promoted(ch.acgState.rankCode, "SEH"));
    }
    ch.acgState.sehPromotionPending = false;
  }
  if (ch.acgState.isOfficer) {
    const m = ch.acgState.rankCode.match(/^O(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      ch.rank = Math.min(6, n);
      ch.commissioned = true;
    }
  }
}

/** Number of muster-out rolls the character earns. PM p. 17 / TTB p. 18:
 *  perTerm × qualifyingTerms + rank-band extras, minus ACG penalties. */
export function musterOutRolls(ch: Character): number {
  finalizeAcgRankForMuster(ch);
  const rules = getEdition(ch.editionId).rules.musterOutRolls;
  const perTerm = rules?.perTerm ?? 1;
  const acgPartial = ch.acgState?.partialTerms ?? 0;
  const anagathicsTerms = ch.anagathicsBenefitForfeitedTerms;
  // A term counted by BOTH shortTermsCount and anagathicsTerms (anagathics
  // secured in a term that then failed survival) would be excluded twice;
  // add the recorded overlap back so each excluded term drops one roll.
  const overlap = ch.anagathicsShortTermOverlap;
  const qualifyingTerms = Math.max(
    0,
    ch.terms - ch.shortTermsCount - acgPartial - anagathicsTerms + overlap,
  );
  let r = perTerm * qualifyingTerms;
  const band = rules?.rankExtraRolls?.find(
    (b) => ch.rank >= b.rankMin && ch.rank <= b.rankMax,
  );
  if (band) r += band.additionalRolls;
  if (ch.useAcg && ch.acgState?.musterRollPenalty) {
    r = Math.max(0, r + ch.acgState.musterRollPenalty);
  }
  return r;
}

/** Roll once on the service's muster-out cash table. */
export function musterOutCash(ch: Character, cashDM: number): void {
  const rawRoll = roll(1);
  const idx = Math.min(7, Math.max(1, rawRoll + cashDM));
  const cash = ch.serviceDef().musterCash[idx] ?? 0;
  ch.credits += cash;
  ch.musterLog.push(`Cr${numCommaSep(cash)} cash`);
  ch.log(ev.musterCash(cash, rawRoll, cashDM));
}

/** Roll once on the service's muster-out benefits table; describe the
 *  resulting state change as a musterLog entry. */
export function musterOutBenefit(ch: Character, benefitsDM: number): void {
  const beforeBenefitsLen = ch.benefits.length;
  const beforeAttrs = { ...ch.attributes };
  const beforeSkillLevels = new Map<string, number>();
  for (const [n, l] of ch.skills) beforeSkillLevels.set(n, l);
  const beforeMortgage = ch.mortgage;

  ch.serviceDef().musterBenefits(ch, benefitsDM);

  const newBenefitsList = ch.benefits.slice(beforeBenefitsLen);
  const newBenefitsSet = new Set(newBenefitsList);

  const parts: string[] = [...newBenefitsList];
  for (const k of Object.keys(ch.attributes) as AttributeKey[]) {
    const delta = ch.attributes[k] - beforeAttrs[k];
    if (delta !== 0) {
      const sign = delta > 0 ? "+" : "";
      parts.push(`${sign}${delta} ${attrShort(k)}`);
    }
  }
  for (const [n, l] of ch.skills) {
    const prev = beforeSkillLevels.get(n);
    if (prev === undefined) {
      if (l === 0 && newBenefitsSet.has(n)) continue;
      parts.push(l === 0 ? n : `${n}-${l}`);
    } else if (l > prev) {
      parts.push(`${n}-${l}`);
    }
  }
  if (ch.mortgage < beforeMortgage) {
    parts.push(`Free Trader mortgage -${beforeMortgage - ch.mortgage} yrs`);
  }
  ch.musterLog.push(parts.length > 0 ? parts.join(", ") : "No benefit");
}

/** Apply retirement pay (if eligible) and run per-pathway finalizers. */
export function musterOutPay(ch: Character): void {
  const pensionForfeit = !!(ch.useAcg && ch.acgState?.pensionForfeit);
  const retirement = getEdition(ch.editionId).rules.retirement;
  const eligibleAfter = retirement?.eligibleAfterCompletedTerm ?? 5;
  const basePension = retirement?.basePensionCredits ?? 4000;
  const perTerm = retirement?.pensionCreditsPerTerm ?? 2000;
  const excluded = new Set(
    retirement?.excludedServices ?? ["scouts", "other"],
  );
  const anagathicsExcluded = retirement?.anagathicTermsExcluded ?? false;
  const qualifyingTerms = anagathicsExcluded
    ? ch.terms - (ch.anagathicsBenefitForfeitedTerms ?? 0)
    : ch.terms;
  if (!pensionForfeit && qualifyingTerms >= eligibleAfter &&
      !excluded.has(ch.service as string)) {
    ch.retirementPay = basePension + (qualifyingTerms - eligibleAfter) * perTerm;
    const label = `${numCommaSep(ch.retirementPay)}/yr Retirement Pay`;
    ch.log(ev.raw(label, "simple"));
    ch.addBenefit(label);
  } else if (pensionForfeit && ch.terms >= eligibleAfter) {
    ch.log(ev.statusChange("pensionForfeit", "dishonorable discharge or death sentence"));
  }
  if (ch.useAcg && ch.acgState?.pathway === "merchantPrince") {
    merchantFinalizeMuster(ch);
    applyReducedPassageBenefit(ch);
  }
  if (ch.useAcg && ch.acgState?.pathway === "scout") {
    scoutFinalizeMuster(ch);
  }
}
