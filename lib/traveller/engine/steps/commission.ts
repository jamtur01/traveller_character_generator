// Commission step. Drafted characters skip in their first term (per TTB).
// On success, rank → 1, +1 skill point, edition-specific automatic effects
// fire via the service's doPromotion hook.
//
// config.doubleBonusOvershoot (MT): if the commission roll exceeded the
// target by N+, grant a second bonus skill point. Uses the same roll's
// margin (not a re-roll), per MT PM p. 17.

import { intToOrdinal } from "@/lib/traveller/formatting";
import { event as ev } from "@/lib/traveller/history";
import type { StepFn } from "./types";

export const commissionStep: StepFn = ({ ch, service, config, edition }) => {
  if (ch.deceased) return;
  if (ch.commissioned) return;
  if (ch.shortTermThisTerm) {
    ch.log(ev.statusChange(
      "commissionSkipped", "short term after survival failure",
    ));
    return;
  }
  if (edition.rules.draft?.noCommissionFirstTerm && ch.drafted && ch.terms === 1) {
    ch.log(ev.statusChange(
      "commissionSkipped", "drafted in first term",
    ));
    return;
  }
  if (service.commissionThrow === undefined) return;

  const { passed, margin } = service.checkCommission(ch);
  if (!passed) return;

  ch.commissioned = true;
  ch.rank += 1;
  ch.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && margin >= overshootN) {
    ch.skillPoints += 1;
    ch.log(ev.bonusSkillPoint("Commission", overshootN));
  }

  service.doPromotion(ch);
  ch.log(ev.promoted(
    service.ranks[ch.rank] ?? `rank ${ch.rank}`,
    `commissioned in ${intToOrdinal(ch.terms)} term`,
  ));
};
