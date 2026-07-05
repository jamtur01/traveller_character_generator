// Mongoose 2e Survival (Core p.18): each term the Traveller rolls 2D + the
// assignment's survival characteristic DM + pending survival DMs vs the target.
// A natural 2 always fails. On failure the Traveller rolls on the career's
// Mishap table (ejected, losing the term's Benefit roll) via the shared
// effect interpreter's resolveMishap.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { rollCheck } from "@/lib/traveller/core";
import { consumePendingDm } from "@/lib/traveller/engine/mongoose/state";
import { currentAssignment, getMongooseData, checkDm } from "@/lib/traveller/engine/mongoose/core";
import { resolveMishap } from "@/lib/traveller/engine/mongoose/effects";

/** Roll survival for the current term. Returns whether the Traveller survived;
 *  a failure resolves a Mishap (which ejects unless it says otherwise). */
export function rollSurvival(ch: Character): boolean {
  const { state, asg } = currentAssignment(ch);
  const dm = checkDm(ch, asg.survival) + consumePendingDm(state.pendingDms.survival);
  const r = rollCheck(ch.rng, [dm], asg.survival.target);
  const survived = r.success && r.roll !== getMongooseData(ch).survivalNaturalFail; // natural fail (Core p.18)
  ch.log(ev.roll("Survival", r.roll, dm, asg.survival.target, survived));
  state.perTerm.survived = survived;
  if (!survived) resolveMishap(ch, true);
  return survived;
}
