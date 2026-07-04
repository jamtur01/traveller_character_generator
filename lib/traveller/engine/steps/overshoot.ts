// Shared "double bonus on overshoot" rule for the per-term checks. MT PM p. 17:
// commission / promotion / special-duty each grant a second bonus skill point
// when the (same, non-re-rolled) roll beats its target by `doubleBonusOvershoot`
// or more. The threshold is a per-step JSON config value; centralizing it here
// keeps the `unknown`-typed config read in one place across the three steps.

import { event as ev } from "@/lib/traveller/history";
import type { Character } from "@/lib/traveller/character";

/** Grant the second bonus skill point when `margin` (roll − target) meets the
 *  step's `doubleBonusOvershoot` threshold. No-op when the config omits it. */
export function applyOvershootBonus(
  ch: Character,
  config: Record<string, unknown>,
  margin: number,
  label: string,
): void {
  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && margin >= overshootN) {
    ch.skillPoints += 1;
    ch.log(ev.bonusSkillPoint(label, overshootN));
  }
}
