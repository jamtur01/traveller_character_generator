// Commission step. Drafted characters skip in their first term (per TTB).
// On success, rank → 1, +1 skill point, edition-specific automatic effects
// fire via the service's doPromotion hook.
//
// config.doubleBonusOvershoot (MT): if the commission roll exceeded the
// target by N+, grant a second bonus skill point. Uses the same roll's
// margin (not a re-roll), per MT PM p. 17.

import { intToOrdinal } from "../../formatting";
import { roll } from "../../random";
import { evaluateDM } from "../dmEvaluator";
import type { StepFn } from "./types";

export const commissionStep: StepFn = ({ character, service, config, edition }) => {
  if (character.deceased) return;
  if (character.commissioned) return;
  if (character.shortTermThisTerm) {
    character.logRaw("Skipping commission (short term after survival failure).", "verbose");
    return;
  }
  if (character.drafted && character.terms === 1) {
    character.logRaw("Skipping commission because of draft.", "verbose");
    return;
  }
  if (service.commissionThrow === undefined) return;

  const data = edition.data.services[character.service];
  const dm = data?.checks.position
    ? evaluateDM(data.checks.position.dm, character)
    : 0;
  const r = roll(2);
  const total = r + dm;
  character.logRaw(`Commission roll ${r} + ${dm} vs ${service.commissionThrow}`, "verbose");
  if (total < service.commissionThrow) return;

  character.commissioned = true;
  character.rank += 1;
  character.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && total >= service.commissionThrow + overshootN) {
    character.skillPoints += 1;
    character.logRaw(`Commission overshoot +${overshootN}: +1 bonus skill`, "verbose");
  }

  service.doPromotion(character);
  character.logRaw(
    `Commissioned during ${intToOrdinal(character.terms)} term of service as ${service.ranks[character.rank]}.`,
  );
};
