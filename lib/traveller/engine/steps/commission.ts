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
import { event as ev } from "../../history";
import type { StepFn } from "./types";

export const commissionStep: StepFn = ({ character, service, config, edition }) => {
  if (character.deceased) return;
  if (character.commissioned) return;
  if (character.shortTermThisTerm) {
    character.log(ev.statusChange(
      "commissionSkipped", "short term after survival failure",
    ));
    return;
  }
  if (character.drafted && character.terms === 1) {
    character.log(ev.statusChange(
      "commissionSkipped", "drafted in first term",
    ));
    return;
  }
  if (service.commissionThrow === undefined) return;

  const data = edition.data.services[character.service];
  const dm = data?.checks.position
    ? evaluateDM(data.checks.position.dm, character)
    : 0;
  const r = roll(2);
  const total = r + dm;
  const succeeded = total >= service.commissionThrow;
  character.log(ev.roll("Commission", r, dm, service.commissionThrow, succeeded));
  if (!succeeded) return;

  character.commissioned = true;
  character.rank += 1;
  character.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && total >= service.commissionThrow + overshootN) {
    character.skillPoints += 1;
    character.log(ev.bonusSkillPoint("Commission", overshootN));
  }

  service.doPromotion(character);
  character.log(ev.promoted(
    service.ranks[character.rank] ?? `rank ${character.rank}`,
    `commissioned in ${intToOrdinal(character.terms)} term`,
  ));
};
