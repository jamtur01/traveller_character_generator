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

/** Whether the Traveller may attempt a commission this term (Core p.18-19): the
 *  career offers one, they are not already an officer, and it is the first term
 *  or their SOC meets the any-term minimum. */
export function commissionEligible(ch: Character): boolean {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const career = getCareer(ch, requireRule(state.career, "mongooseState.career", "engine (mongoose)"));
  if (!career.commission || state.commissioned) return false;
  const firstTerm = state.termsInCareer <= 1;
  return firstTerm || ch.attributes.social >= getMongooseData(ch).commissionAnyTermSocMin;
}

/** Attempt a commission (military careers only). Returns whether commissioned.
 *  DM-1 per term after the first; a commission does not consume advancement DMs
 *  (those belong to the separate advancement roll). */
export function attemptCommission(ch: Character): boolean {
  if (!commissionEligible(ch)) return false;
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const career = getCareer(ch, requireRule(state.career, "mongooseState.career", "engine (mongoose)"));
  const check = requireRule(
    career.commission, `mongoose.careers.${state.career}.commission`, "MgT2 Core",
  );
  const termPenalty = Math.max(0, state.termsInCareer - 1); // DM-1 per term after the first
  const dm = checkDm(ch, check) - termPenalty;
  const r = rollCheck(ch.rng, [dm], check.target);
  ch.log(ev.roll("Commission", r.roll, dm, check.target, r.success));
  if (r.success) {
    commission(ch);
    return true;
  }
  return false;
}

/** Resolve the commission/advancement phase (Core p.18). A commission is
 *  optional: eligible Travellers are prompted (auto attempts). If not
 *  commissioned this term, roll for advancement. */
export function resolveAdvancementPhase(ch: Character): void {
  if (!commissionEligible(ch)) {
    rollAdvancement(ch);
    return;
  }
  ch.pickOrDefer({
    kind: "mongooseCommission",
    label: "Attempt a commission?",
    options: ["Attempt", "Decline"],
    preferred: ["Attempt"],
    onResolve: (c, choice) => {
      if (choice === "Attempt" && attemptCommission(c)) return;
      rollAdvancement(c);
    },
  });
}
