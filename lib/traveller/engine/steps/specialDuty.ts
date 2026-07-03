// MegaTraveller Special Duty step (a fifth per-term check). Each career has
// a target; success grants +1 skill point. config.doubleBonusOvershoot of
// N grants +1 additional skill point on a roll N+ over the target.
//
// Editions without specialDuty in their lifecycle simply never reach this
// step. CT has no specialDuty target field on services and would no-op.

import { roll } from "@/lib/traveller/random";
import { event as ev } from "@/lib/traveller/history";
import type { StepFn } from "./types";

export const specialDutyStep: StepFn = ({ character, edition, config }) => {
  if (character.deceased) return;
  const data = edition.data.services[character.service];
  const target = data?.checks.specialDuty?.target;
  if (target === undefined) return;

  const r = roll(2);
  const succeeded = r >= target;
  character.log(ev.roll("Special Duty", r, 0, target, succeeded));
  if (!succeeded) return;
  character.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && r >= target + overshootN) {
    character.skillPoints += 1;
    character.log(ev.bonusSkillPoint("Special Duty", overshootN));
  }
};
