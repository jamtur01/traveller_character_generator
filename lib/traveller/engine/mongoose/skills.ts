// Mongoose 2e skill-grant semantics (Core p.19). A skill-table cell is either a
// bare skill (gain at 1, or +1 if trained), a skill with a level floor
// ("Streetwise 1", "Gambler 0" -> raise to that level only if higher), or a
// characteristic boost ("DEX +1"). Skill-level caps (max 4, total <= 3x(INT+EDU))
// are enforced in the skills-and-training step; basic training and background
// grants (level 0) never approach them.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getMongooseData } from "@/lib/traveller/engine/mongoose/core";

/** Printed characteristic abbreviations in skill/rank cells -> attribute keys. */
const ATTR_ABBREV: Record<string, AttributeKey> = {
  STR: "strength", DEX: "dexterity", END: "endurance",
  INT: "intelligence", EDU: "education", SOC: "social",
};

/** Current level of a skill, or -1 if untrained (distinct from a trained 0). */
export function skillLevel(ch: Character, name: string): number {
  const found = ch.skills.find(([n]) => n === name);
  return found ? found[1] : -1;
}

/** True when the character is at the total skill-level cap (Core p.19:
 *  multiplier x sum of the capped attributes, i.e. 3 x (INT + EDU)). */
function atTotalCap(ch: Character): boolean {
  const { multiplier, attributes } = getMongooseData(ch).skillTotalCap;
  const cap = multiplier * attributes.reduce(
    (sum, a) => sum + ch.attributes[a as AttributeKey], 0,
  );
  return ch.totalSkillLevels() >= cap;
}

/** "No level listed" cell: gain the skill at 1, or increase it by 1 if trained.
 *  Blocked at the level-4 cap or the total-skill cap (increases are lost). */
export function grantSkillIncrement(ch: Character, name: string, source?: string): void {
  const cur = skillLevel(ch, name);
  if (cur >= getMongooseData(ch).skillLevelMax) return;
  if (atTotalCap(ch)) return;
  ch.addSkill(name, 1, source);
}

/** "Level listed" cell: gain/raise the skill to `level` (clamped to the level-4
 *  cap) only if higher than the current level. A level-0 floor just ensures the
 *  skill is present (adds no levels, so it is never cap-blocked); raising an
 *  existing skill is blocked at the total-skill cap. */
export function grantSkillFloor(
  ch: Character, name: string, level: number, source?: string,
): void {
  const target = Math.min(level, getMongooseData(ch).skillLevelMax);
  const cur = skillLevel(ch, name);
  if (cur < 0) {
    if (target > 0 && atTotalCap(ch)) return;
    ch.addSkill(name, target, source);
  } else if (target > cur && !atTotalCap(ch)) {
    ch.addSkill(name, target - cur, source);
  }
}

/** Apply a skill-table / rank-benefit cell string (Core p.19):
 *  - "DEX +1" / "SOC +1" -> raise that characteristic (respecting attribute caps).
 *  - "Streetwise 1" / "Gambler 0" -> raise the skill to that level floor.
 *  - "Gun Combat" / "Electronics (comms)" -> gain at 1, or +1 if trained.
 *  Speciality parentheses are preserved as part of the skill name. */
export function applySkillCell(ch: Character, cell: string, source?: string): void {
  const attr = cell.match(/^(STR|DEX|END|INT|EDU|SOC)\s*([+-]\d+)$/);
  if (attr) {
    ch.improveAttribute(ATTR_ABBREV[attr[1]!]!, Number(attr[2]));
    return;
  }
  const floor = cell.match(/^(.+?)\s+(\d+)$/);
  if (floor) {
    grantSkillFloor(ch, floor[1]!, Number(floor[2]), source);
    return;
  }
  grantSkillIncrement(ch, cell, source);
}
