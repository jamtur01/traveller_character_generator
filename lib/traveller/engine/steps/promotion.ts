// Promotion step. Only commissioned characters with rank < 6 may attempt.
// config.doubleBonusOvershoot mirrors commission step's MT semantics.

import { roll } from "../../random";
import { evaluateDM } from "../dmEvaluator";
import type { StepFn } from "./types";

export const promotionStep: StepFn = ({ character, service, config, edition }) => {
  if (character.deceased) return;
  if (!character.commissioned) return;
  if (character.rank >= 6) return;
  if (service.promotionThrow === undefined) return;

  if (!service.checkPromotion(character)) return;
  character.rank += 1;
  character.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN) {
    const data = edition.data.services[character.service];
    const dm = data?.checks.promotion
      ? evaluateDM(data.checks.promotion.dm, character)
      : 0;
    const r = roll(2);
    if (r + dm >= service.promotionThrow + overshootN) {
      character.skillPoints += 1;
      character.verboseHistory(`Promotion overshoot +${overshootN}: +1 bonus skill`);
    }
  }

  service.doPromotion(character);
  character.history.push(`Promoted to ${service.ranks[character.rank]}.`);
};
