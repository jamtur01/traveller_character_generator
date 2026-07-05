// Mongoose 2e rank mechanics (Core p.18): the rank ladder a character advances
// on, applying a rank's on-attainment benefit, promotion, and commission.
// Shared by the advancement/commission step and the autoPromote/autoCommission
// event effects.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { requireRule } from "@/lib/traveller/editions/strict";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";
import { applySkillCell } from "@/lib/traveller/engine/mongoose/skills";
import type { MongooseRank } from "@/lib/traveller/engine/mongoose/types";

/** The rank ladder the character currently advances on: the officer ladder once
 *  commissioned, else the enlisted ladder mapped to the current assignment. */
export function currentLadder(ch: Character): readonly MongooseRank[] {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const careerId = requireRule(state.career, "mongooseState.career", "engine (mongoose)");
  const career = getCareer(ch, careerId);
  if (state.commissioned) {
    return requireRule(
      career.ranks.officer, `mongoose.careers.${careerId}.ranks.officer`, "MgT2 Core",
    );
  }
  const assignment = requireRule(
    state.assignment, "mongooseState.assignment", "engine (mongoose)",
  );
  const key = requireRule(
    career.ranks.enlistedByAssignment[assignment],
    `mongoose.careers.${careerId}.ranks.enlistedByAssignment.${assignment}`, "MgT2 Core",
  );
  return requireRule(
    career.ranks.enlisted[key],
    `mongoose.careers.${careerId}.ranks.enlisted.${key}`, "MgT2 Core",
  );
}

/** Apply the skill/characteristic benefit a rank grants on attainment. All cell
 *  parsing — a compound "X or Y" choice (Marine rank 0, Rogue, Drifter) and the
 *  officer "SOC 10 or SOC +1, whichever is higher" form — is centralized in
 *  applySkillCell. */
export function applyRankBenefit(
  ch: Character, ladder: readonly MongooseRank[], rank: number,
): void {
  const row = ladder.find((r) => r.rank === rank);
  if (!row?.benefit) return;
  applySkillCell(ch, row.benefit, `Rank ${rank}`);
}

/** Advance one rank on the current ladder: +1 rank, apply the new rank's
 *  benefit, log. The caller grants the extra skill-table roll (Core p.18). */
export function promote(ch: Character): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const ladder = currentLadder(ch);
  const maxRank = Math.max(...ladder.map((r) => r.rank));
  if (state.rank < maxRank) {
    state.rank += 1;
    applyRankBenefit(ch, ladder, state.rank);
    const row = ladder.find((r) => r.rank === state.rank);
    ch.log(ev.mongooseRank(state.rank, row?.title ?? null, false));
  }
  state.perTerm.advancedThisTerm = true;
}

/** Gain a commission (Core p.18, military only): become a rank-1 officer and
 *  apply the officer rank-1 benefit. */
export function commission(ch: Character): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  state.commissioned = true;
  state.rank = 1;
  const ladder = currentLadder(ch);
  applyRankBenefit(ch, ladder, 1);
  const row = ladder.find((r) => r.rank === 1);
  ch.log(ev.mongooseRank(1, row?.title ?? null, true));
  state.perTerm.commissionedThisTerm = true;
}
