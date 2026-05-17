// Promotion step. Only commissioned characters with rank < 6 may attempt.
// config.doubleBonusOvershoot mirrors commission step's MT semantics — the
// same roll's margin grants the second bonus, not a fresh roll.

import { roll } from "../../random";
import { evaluateDM } from "../dmEvaluator";
import { event as ev } from "../../history";
import type { StepFn } from "./types";

export const promotionStep: StepFn = ({ character, service, config, edition }) => {
  if (character.deceased) return;
  if (character.shortTermThisTerm) {
    character.logRaw("Skipping promotion (short term after survival failure).", "verbose");
    return;
  }
  if (!character.commissioned) return;
  if (character.rank >= 6) return;
  if (service.promotionThrow === undefined) return;

  const data = edition.data.services[character.service];
  const dm = data?.checks.promotion
    ? evaluateDM(data.checks.promotion.dm, character)
    : 0;
  const r = roll(2);
  const total = r + dm;
  const succeeded = total >= service.promotionThrow;
  character.log(ev.roll("Promotion", r, dm, service.promotionThrow, succeeded));
  if (!succeeded) return;

  character.rank += 1;
  character.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && total >= service.promotionThrow + overshootN) {
    character.skillPoints += 1;
    character.logRaw(`Promotion overshoot +${overshootN}: +1 bonus skill`, "verbose");
  }

  service.doPromotion(character);
  character.log(ev.promoted(service.ranks[character.rank] ?? `rank ${character.rank}`));
};
