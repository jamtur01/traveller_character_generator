// Promotion step. Only commissioned chars below their service's top rank promote.
// config.doubleBonusOvershoot mirrors commission step's MT semantics — the
// same roll's margin grants the second bonus, not a fresh roll.

import { event as ev } from "@/lib/traveller/history";
import type { StepFn } from "./types";

export const promotionStep: StepFn = ({ ch, service, config }) => {
  if (ch.deceased) return;
  if (ch.shortTermThisTerm) {
    ch.log(ev.statusChange(
      "promotionSkipped", "short term after survival failure",
    ));
    return;
  }
  if (!ch.commissioned) return;
  const maxRank = Math.max(...Object.keys(service.ranks).map(Number));
  if (ch.rank >= maxRank) return;
  if (service.promotionThrow === undefined) return;

  const { passed, margin } = service.checkPromotion(ch);
  if (!passed) return;

  ch.rank += 1;
  ch.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && margin >= overshootN) {
    ch.skillPoints += 1;
    ch.log(ev.bonusSkillPoint("Promotion", overshootN));
  }

  service.doPromotion(ch);
  ch.log(ev.promoted(service.ranks[ch.rank] ?? `rank ${ch.rank}`));
};
