// MegaTraveller Special Duty step (a fifth per-term check). Each career has
// a target; success grants +1 skill point. config.doubleBonusOvershoot of
// N grants +1 additional skill point on a roll N+ over the target.
//
// Editions without specialDuty in their lifecycle simply never reach this
// step. CT has no specialDuty target field on services and would no-op.

import { roll } from "../../random";
import type { StepFn } from "./types";

export const specialDutyStep: StepFn = ({ character, edition, config }) => {
  if (character.deceased) return;
  const data = edition.data.services[character.service];
  const target = data?.checks
    ? (data.checks as { specialDuty?: { target: number } }).specialDuty?.target
    : undefined;
  if (target === undefined) return;

  const r = roll(2);
  character.logRaw(`Special Duty roll ${r} vs ${target}`, "verbose");
  if (r < target) return;
  character.skillPoints += 1;

  const overshootN = config.doubleBonusOvershoot as number | undefined;
  if (overshootN && r >= target + overshootN) {
    character.skillPoints += 1;
    character.logRaw(`Special Duty overshoot +${overshootN}: +1 bonus skill`, "verbose");
  }
};
