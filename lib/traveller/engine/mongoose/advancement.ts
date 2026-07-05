// Mongoose 2e Advancement and Commission (Core p.18).
//
// Advancement: roll 2D + the assignment's advancement characteristic DM +
// pending advancement DMs vs the target. Success promotes (rank +1, rank
// benefit, and the caller grants an extra skill-table roll). A natural 12 forces
// the Traveller to continue; an advancement roll <= the terms spent in this
// career forces leaving after this term. Only one attempt per term.
//
// Commission (military careers only): optional, in the first term or any term at
// SOC 9+, with DM-1 per term after the first. Success makes the Traveller a
// rank-1 officer; a commission forbids an advancement roll the same term.
// `termsInCareer` is 1-based (the model increments it at the start of each term).

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { rollCheck } from "@/lib/traveller/core";
import { requireRule } from "@/lib/traveller/editions/strict";
import { consumePendingDm } from "@/lib/traveller/engine/mongoose/state";
import { getCareer, checkDm, getMongooseData } from "@/lib/traveller/engine/mongoose/core";
import { promote, commission } from "@/lib/traveller/engine/mongoose/ranks";

/** Roll for advancement this term. Returns whether the Traveller was promoted. */
export function rollAdvancement(ch: Character): boolean {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const careerId = requireRule(state.career, "mongooseState.career", "engine (mongoose)");
  const career = getCareer(ch, careerId);
  const asg = requireRule(
    career.assignments.find((a) => a.id === state.assignment),
    `mongoose.careers.${careerId}.assignments.${state.assignment}`, "MgT2 Core",
  );
  const dm = checkDm(ch, asg.advancement) + consumePendingDm(state.pendingDms.advancement);
  const r = rollCheck(ch.rng, [dm], asg.advancement.target);
  ch.log(ev.roll("Advancement", r.roll, dm, asg.advancement.target, r.success));
  if (r.roll === 12) state.perTerm.mustContinue = true;
  else if (r.roll <= state.termsInCareer) state.perTerm.mustLeave = true;
  if (r.success) promote(ch);
  return r.success;
}

/** Attempt a commission (military careers only). Returns whether commissioned.
 *  Not eligible if the career has no commission, the Traveller is already an
 *  officer, or it is not the first term and SOC < 9. */
export function attemptCommission(ch: Character): boolean {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const careerId = requireRule(state.career, "mongooseState.career", "engine (mongoose)");
  const career = getCareer(ch, careerId);
  if (!career.commission || state.commissioned) return false;
  const firstTerm = state.termsInCareer <= 1;
  if (!firstTerm && ch.attributes.social < getMongooseData(ch).commissionAnyTermSocMin) {
    return false;
  }
  const termPenalty = Math.max(0, state.termsInCareer - 1); // DM-1 per term after the first
  const dm = checkDm(ch, career.commission) - termPenalty
    + consumePendingDm(state.pendingDms.advancement);
  const r = rollCheck(ch.rng, [dm], career.commission.target);
  ch.log(ev.roll("Commission", r.roll, dm, career.commission.target, r.success));
  if (r.success) {
    commission(ch);
    return true;
  }
  return false;
}
