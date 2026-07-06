// Mongoose 2e Mustering Out (Core pp.46-49): on leaving a career the Traveller
// makes one Benefit roll per full term served plus bonus rolls from rank, each
// on the Cash or Material Benefits column of the career's muster table. Cash
// rolls are capped at 3 across all careers; a Gambler grants DM+1 to Cash rolls;
// the top rank band grants a DM to all this career's Benefit rolls. Pensions
// apply on leaving after enough terms (excluded careers get none). The career is
// then recorded in the history and the previous-career count is bumped.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { requireRule } from "@/lib/traveller/editions/strict";
import { getMongooseData, currentCareer, findRollRow, mongooseSkillNames, skillBaseName, ATTR_ABBREV, ATTR_CELL } from "@/lib/traveller/engine/mongoose/core";
import { skillLevel, applySkillCell } from "@/lib/traveller/engine/mongoose/skills";
import { consumePendingDm } from "@/lib/traveller/engine/mongoose/state";
import type { MongooseCareer, MongooseData } from "@/lib/traveller/engine/mongoose/types";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";

const clampMuster = (career: MongooseCareer, n: number): number =>
  Math.max(1, Math.min(career.musterOut.length, n));

/** Split a compound benefit cell ("Melee, Recon or Streetwise", "Deception,
 *  Persuade and Stealth") into its parts on commas and the trailing conjunction. */
function splitBenefitParts(benefit: string, conjunction: "or" | "and"): string[] {
  return benefit
    .split(new RegExp(`\\s*,\\s*|\\s+${conjunction}\\s+`))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Apply a single Material Benefit token: a characteristic increase, a
 *  relationship, or (for equipment/ships/memberships) a recorded benefit string.
 *  Die-string group resources ("1D Ship Shares", "2D Ship Shares") are recorded
 *  verbatim rather than rolled to a concrete count: Ship Shares are a shared
 *  group resource (Core p.46), meaningless to resolve for a solo Traveller, so
 *  the leading die is intentionally left unrolled (not a missing feature). */
function applySingleBenefit(ch: Character, benefit: string): void {
  const attr = benefit.match(ATTR_CELL);
  if (attr) {
    ch.improveAttribute(ATTR_ABBREV[attr[1]!]!, Number(attr[2]));
    return;
  }
  const lower = benefit.toLowerCase();
  if (lower === "ally" || lower === "contact") {
    ch.mongooseState!.connections.push({ relation: lower, note: "muster benefit" });
    ch.log(ev.mongooseConnection(lower));
    return;
  }
  ch.benefits.push(benefit);
  ch.log(ev.raw(`Benefit: ${benefit}.`));
}

/** Apply a Material Benefit cell. Compound cells split into parts on commas and
 *  the trailing conjunction: " or " (Core p.56) is a player choice of one part,
 *  " and " grants every part. Each part is routed by kind — a skill (present in
 *  mongooseSkillNames) via applySkillCell, otherwise (equipment, attribute,
 *  relationship: "Ship Share", "END +1", "Ally") via applySingleBenefit. A
 *  single (non-compound) token is always material/attr/relation, never a skill. */
function applyMaterialBenefit(ch: Character, benefit: string): void {
  const skills = mongooseSkillNames(ch);
  const routePart = (c: Character, part: string): void => {
    if (skills.has(part) || skills.has(skillBaseName(part))) applySkillCell(c, part, "Muster benefit");
    else applySingleBenefit(c, part);
  };
  if (benefit.includes(" or ")) {
    ch.pickOrDefer({
      kind: "mongooseMusterBenefit",
      label: `Choose a benefit: ${benefit}`,
      options: splitBenefitParts(benefit, "or"),
      onResolve: routePart,
    });
    return;
  }
  if (benefit.includes(" and ")) {
    for (const part of splitBenefitParts(benefit, "and")) routePart(ch, part);
    return;
  }
  applySingleBenefit(ch, benefit);
}

/** Resolve one Benefit roll: pick a column, roll 1D + DMs, apply the result. */
function resolveBenefitRoll(
  ch: Character, career: MongooseCareer, data: MongooseData, rankDm: number, index: number, total: number,
): void {
  const state = ch.mongooseState!;
  const canCash = state.cashRollsUsed < data.cashRollCap;
  const columns = optionDomain(ch.editionId, "mongoose.musterBenefitColumn").values;
  const options = canCash ? columns : columns.filter((col) => col !== "Cash");
  ch.pickOrDefer({
    kind: "musterRoll",
    label: "Choose a benefit column",
    options,
    progress: { current: index + 1, total },
    onResolve: (c, chosen) => {
      const st = c.mongooseState!;
      // Event-granted "DM+1 to any one Benefit roll" (Core p.46) is consumed on
      // the first roll taken (scope "next"); persistent ("any") DMs remain.
      const benefitDm = consumePendingDm(st.pendingDms.benefit);
      if (chosen === "Cash") {
        const cb = data.cashBonusSkill;
        const gambler = skillLevel(c, cb.skill) >= 0 ? cb.dm : 0;
        const roll = clampMuster(career, c.rng.roll(1) + rankDm + gambler + benefitDm);
        const row = findRollRow(
          career.musterOut, roll, `mongoose.careers.${career.id}.musterOut[${roll}]`, "MgT2 Core",
        );
        c.credits += row.cash;
        st.cashRollsUsed += 1;
        c.log(ev.raw(`Muster benefit (Cash): Cr${row.cash} (roll ${roll}).`));
      } else {
        const roll = clampMuster(career, c.rng.roll(1) + rankDm + benefitDm);
        const row = findRollRow(
          career.musterOut, roll, `mongoose.careers.${career.id}.musterOut[${roll}]`, "MgT2 Core",
        );
        applyMaterialBenefit(c, row.benefit);
      }
    },
  });
}

/** Record the pension a Traveller earns for leaving this career (Core p.49). */
function applyPension(ch: Character, career: MongooseCareer, data: MongooseData): void {
  const state = ch.mongooseState!;
  const p = data.pensions;
  if (state.termsInCareer < p.minTerms || p.excludedCareers.includes(career.id)) return;
  const tabled = p.table.find((t) => t.terms === state.termsInCareer);
  const pay = tabled
    ? tabled.pay
    : p.table[p.table.length - 1]!.pay + (state.termsInCareer - p.beyondTerm) * p.perTermPay;
  ch.benefits.push(`Pension Cr${pay}/year`);
  ch.log(ev.raw(`Pension: Cr${pay} per year (${state.termsInCareer} terms served).`));
}

/** Muster out of the current career (Core pp.46-49). */
export function musterOut(ch: Character): void {
  const { state, careerId, career } = currentCareer(ch);
  const data = getMongooseData(ch);
  const band = data.benefitsOfRank.find((b) => state.rank >= b.minRank && state.rank <= b.maxRank);
  const rankDm = band?.benefitDm ?? 0;
  let rolls = state.termsInCareer + (band?.bonusRolls ?? 0) + state.benefitRolls;
  if (state.perTerm.loseBenefitThisTerm) rolls -= 1;
  rolls = Math.max(0, rolls);
  // A mishap forfeited ALL Benefit rolls from this career (Core p.34/44/52):
  // no benefit rolls at all, not just the lost event bonuses.
  if (state.benefitsForfeited) rolls = 0;
  ch.log(ev.section(`Mustering out of ${career.displayName} (${rolls} benefit roll${rolls === 1 ? "" : "s"})`));
  for (let i = 0; i < rolls; i++) resolveBenefitRoll(ch, career, data, rankDm, i, rolls);
  applyPension(ch, career, data);
  state.history.push({
    career: careerId, assignment: requireRule(state.assignment, "mongooseState.assignment", "engine"),
    terms: state.termsInCareer, finalRank: state.rank, commissioned: state.commissioned,
  });
  state.careerCount += 1;
  state.benefitRolls = 0;
}
