// Promotion step. Only commissioned characters with rank < 6 may attempt.
// config.doubleBonusOvershoot mirrors commission step's MT semantics — the
// same roll's margin grants the second bonus, not a fresh roll.

import { roll } from "@/lib/traveller/random";
import { evaluateDM } from "@/lib/traveller/engine/dmEvaluator";
import { event as ev } from "@/lib/traveller/history";
import type { StepFn } from "./types";

export const promotionStep: StepFn = ({ ch, service, config, edition }) => {
  if (ch.deceased) return;
  if (ch.shortTermThisTerm) {
    ch.log(ev.statusChange(
      "promotionSkipped", "short term after survival failure",
    ));
    return;
  }
  if (!ch.commissioned) return;
  if (ch.rank >= 6) return;
  if (service.promotionThrow === undefined) return;

  const data = edition.data.services[ch.service];
  const dm = data?.checks.promotion
    ? evaluateDM(data.checks.promotion.dm, ch)
    : 0;
  const r = roll(2);
  const total = r + dm;
  const succeeded = total >= service.promotionThrow;
  ch.log(ev.roll("Promotion", r, dm, service.promotionThrow, succeeded));
  if (!succeeded) return;

  ch.rank += 1;
  ch.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && total >= service.promotionThrow + overshootN) {
    ch.skillPoints += 1;
    ch.log(ev.bonusSkillPoint("Promotion", overshootN));
  }

  service.doPromotion(ch);
  ch.log(ev.promoted(service.ranks[ch.rank] ?? `rank ${ch.rank}`));
};
