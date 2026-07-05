// Muster-out orchestration: cash + benefit rolls, retirement pay,
// per-pathway finalizers (Merchant Free Trader, Scout Detached Duty).
// Each function takes Character as its first arg so Character can stay
// focused on state + low-level mutators.

import type { Character } from "@/lib/traveller/character";
import { requireRule } from "@/lib/traveller/editions/strict";
import { sehPromotionSpec } from "@/lib/traveller/engine/acg/awards";
import { rankNum } from "@/lib/traveller/engine/predicate";
import { getEdition } from "@/lib/traveller/editions";
import { numCommaSep, attrShort } from "@/lib/traveller/formatting";
import { event as ev } from "@/lib/traveller/history";
import type { AttributeKey } from "@/lib/traveller/types";
import { merchantFinalizeMuster, applyReducedPassageBenefit }
  from "@/lib/traveller/engine/acg/pathways/merchantPrince";
import { scoutFinalizeMuster } from "@/lib/traveller/engine/acg/pathways/scout";

/** Project the ACG officer rankCode onto basic-chargen `rank` (capped at
 *  the service's highest declared rank index) for muster-out DMs and
 *  rank-band extra rolls. Also consumes any pending SEH automatic rank
 *  bump (decorationTiers[].sehPromotion, PM p. 46). Idempotent: safe to
 *  call before muster regardless of pathway. */
export function finalizeAcgRankForMuster(ch: Character): void {
  if (!ch.useAcg || !ch.acgState) return;
  // SEH automatic promotion at muster (PM p. 46). Consume the flag; the
  // bonus magnitude and rank cap come from the tier's sehPromotion spec.
  if (ch.acgState.sehPromotionPending && ch.acgState.isOfficer) {
    const spec = requireRule(
      sehPromotionSpec(ch),
      "decorationTiers[].sehPromotion (SEH tier)", "PM p. 46",
    );
    const m = ch.acgState.rankCode.match(/^O(\d+)$/);
    if (m) {
      const next = Math.min(
        rankNum(spec.maxRank), parseInt(m[1]!, 10) + spec.rankBonus,
      );
      ch.acgState.rankCode = `O${next}`;
      ch.log(ev.promoted(ch.acgState.rankCode, "SEH"));
    }
    ch.acgState.sehPromotionPending = false;
  }
  if (ch.acgState.isOfficer) {
    const m = ch.acgState.rankCode.match(/^O(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      // The basic-chargen rank scale tops out at the service's highest
      // declared rank index (services.*.ranks in the edition JSON).
      const maxRank = Math.max(
        ...Object.keys(ch.serviceDef().ranks).map(Number),
      );
      ch.rank = Math.min(maxRank, n);
      ch.commissioned = true;
    }
  }
}

/** Number of muster-out rolls the character earns. PM p. 17 / TTB p. 18:
 *  perTerm × qualifyingTerms + rank-band extras, minus ACG penalties. */
export function musterOutRolls(ch: Character): number {
  finalizeAcgRankForMuster(ch);
  const rules = getEdition(ch.editionId).rules.musterOutRolls;
  const perTerm = requireRule(
    rules?.perTerm, "rules.musterOutRolls.perTerm", "TTB p. 18 / PM p. 17",
  );
  const acgPartial = ch.acgState?.partialTerms ?? 0;
  const anagathicsTerms = ch.anagathics.anagathicsBenefitForfeitedTerms;
  // A term counted by BOTH shortTermsCount and anagathicsTerms (anagathics
  // secured in a term that then failed survival) would be excluded twice;
  // add the recorded overlap back so each excluded term drops one roll.
  const overlap = ch.anagathics.anagathicsShortTermOverlap;
  const qualifyingTerms = Math.max(
    0,
    ch.terms - ch.shortTermsCount - acgPartial - anagathicsTerms + overlap,
  );
  let r = perTerm * qualifyingTerms;
  const source = getEdition(ch.editionId).data.services[ch.service]?.source;
  const bands = (source ? rules?.rankExtraRollsBySource?.[source] : undefined)
    ?? rules?.rankExtraRolls;
  const band = bands?.find(
    (b) => ch.rank >= b.rankMin && ch.rank <= b.rankMax,
  );
  if (band) r += band.additionalRolls;
  if (ch.useAcg && ch.acgState?.musterRollPenalty) {
    r = Math.max(0, r + ch.acgState.musterRollPenalty);
  }
  return r;
}

/** Roll once on the service's muster-out cash table. The roll index is
 *  clamped to the cash table's declared indices (services.*.musterOut.cash
 *  — the JSON table shape, not a code literal). */
export function musterOutCash(ch: Character, cashDM: number): void {
  const rawRoll = ch.rng.roll(1);
  const musterCash = ch.serviceDef().musterCash;
  const indices = Object.keys(musterCash).map(Number);
  const idx = Math.min(
    Math.max(...indices), Math.max(Math.min(...indices), rawRoll + cashDM),
  );
  const cash = requireRule(
    musterCash[idx], `services.${String(ch.service)}.musterOut.cash[${idx}]`,
    "TTB p. 18 / PM p. 17",
  );
  ch.credits += cash;
  ch.muster.musterLog.push(`Cr${numCommaSep(cash)} cash`);
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
  ch.muster.musterLog.push(parts.length > 0 ? parts.join(", ") : "No benefit");
}

/** Apply retirement pay (if eligible) and run per-pathway finalizers. */
export function musterOutPay(ch: Character): void {
  const pensionForfeit = !!(ch.useAcg && ch.acgState?.pensionForfeit);
  const retirement = getEdition(ch.editionId).rules.retirement;
  const eligibleAfter = requireRule(
    retirement?.eligibleAfterCompletedTerm,
    "rules.retirement.eligibleAfterCompletedTerm", "TTB p. 18 / PM p. 17",
  );
  const basePension = requireRule(
    retirement?.basePensionCredits,
    "rules.retirement.basePensionCredits", "TTB p. 18 / PM p. 17",
  );
  const perTerm = requireRule(
    retirement?.pensionCreditsPerTerm,
    "rules.retirement.pensionCreditsPerTerm", "TTB p. 18 / PM p. 17",
  );
  const excluded = new Set<string>(requireRule(
    retirement?.excludedServices,
    "rules.retirement.excludedServices", "TTB p. 18 / PM p. 17",
  ));
  const qualifyingTerms = ch.qualifyingRetirementTerms();
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
