// Promotion step. Only commissioned chars below their service's top rank promote.
// config.doubleBonusOvershoot mirrors commission step's MT semantics — the
// same roll's margin grants the second bonus, not a fresh roll.

import { event as ev } from "@/lib/traveller/history";
import type { StepFn } from "./types";
import { applyOvershootBonus } from "./overshoot";

export const promotionStep: StepFn = ({ ch, service, config }) => {
  if (ch.deceased) return;
  // Non-officers have no promotion roll (basic chargen has no enlisted-rank
  // ladder), so there is nothing to "skip" — return silently, as the normal
  // path does. Only a commissioned officer who lost the term to injury gets
  // the short-term skip note.
  if (!ch.commissioned) return;
  if (ch.shortTermThisTerm) {
    ch.log(ev.statusChange(
      "promotionSkipped", "short term after survival failure",
    ));
    return;
  }
  // Real cap = highest rank index with a non-empty name. serviceLoader fills
  // ranks 0-6 with "" for undefined slots, so Object.keys() is always 0-6;
  // deriving the cap from it would let services topping at rank 5 (merchants,
  // pirates, nobles, barbarians — ranks[6] is null/"") over-promote into an
  // empty rank 6 with a spurious skill point.
  const maxRank = Math.max(
    0,
    ...Object.entries(service.ranks)
      .filter(([, name]) => name !== "")
      .map(([idx]) => Number(idx)),
  );
  if (ch.rank >= maxRank) return;
  if (service.promotionThrow === undefined) return;

  const { passed, margin } = service.checkPromotion(ch);
  if (!passed) return;

  ch.rank += 1;
  ch.skillPoints += 1;

  applyOvershootBonus(ch, config, margin, "Promotion");

  service.doPromotion(ch);
  ch.log(ev.promoted(service.ranks[ch.rank] ?? `rank ${ch.rank}`));
};
