// Shared roll/check helpers used by every service definition.

import { roll } from "../random";
import type { Character } from "../character";

export function survivalCheck(ch: Character, target: number, dm: number): boolean {
  const sv = roll(2);
  ch.verboseHistory(`Survival roll ${sv} + ${dm} vs ${target}`);
  return sv + dm >= target;
}

export function commissionCheck(ch: Character, target: number, dm: number): boolean {
  const sv = roll(2);
  ch.verboseHistory(`Commission roll ${sv} + ${dm} vs ${target}`);
  return sv + dm >= target;
}

export function promotionCheck(ch: Character, target: number, dm: number): boolean {
  const sv = roll(2);
  ch.verboseHistory(`Promotion roll ${sv} + ${dm} vs ${target}`);
  return sv + dm >= target;
}
