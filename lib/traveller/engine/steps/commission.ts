// Commission step. Drafted characters skip in their first term (per TTB).
// On success, rank → 1, +1 skill point, edition-specific automatic effects
// fire via the service's doPromotion hook.
//
// config.doubleBonusOvershoot (MT): if the commission roll exceeded the
// target by N+ (re-rolled here for fidelity to the JS source), grant a
// second bonus skill point. Note: this re-rolls; for that reason MT and
// CT runs are not bit-identical even with the same RNG seed.

import { intToOrdinal } from "../../formatting";
import { roll } from "../../random";
import { evaluateDM } from "../dmEvaluator";
import type { StepFn } from "./types";

export const commissionStep: StepFn = ({ character, service, config, edition }) => {
  if (character.deceased) return;
  if (character.commissioned) return;
  if (character.drafted && character.terms === 1) {
    character.verboseHistory("Skipping commission because of draft.");
    return;
  }
  if (service.commissionThrow === undefined) return;

  if (!service.checkCommission(character)) return;
  character.commissioned = true;
  character.rank += 1;
  character.skillPoints += 1;

  // MT double-bonus on overshoot: re-roll commission against target+N to
  // decide if a second bonus skill applies. Implemented as a second
  // independent check rather than tracking the original roll's margin.
  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && service.commissionThrow !== undefined) {
    const data = edition.data.services[character.service];
    const dm = data?.checks.position
      ? evaluateDM(data.checks.position.dm, character)
      : 0;
    const r = roll(2);
    if (r + dm >= service.commissionThrow + overshootN) {
      character.skillPoints += 1;
      character.verboseHistory(`Commission overshoot +${overshootN}: +1 bonus skill`);
    }
  }

  service.doPromotion(character);
  character.history.push(
    `Commissioned during ${intToOrdinal(character.terms)} term of service as ${service.ranks[character.rank]}.`,
  );
};
