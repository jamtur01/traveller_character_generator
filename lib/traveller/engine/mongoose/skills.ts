// Mongoose 2e skill-grant semantics (Core p.19). A skill-table cell is either a
// bare skill (gain at 1, or +1 if trained), a skill with a level floor
// ("Streetwise 1", "Gambler 0" -> raise to that level only if higher), or a
// characteristic boost ("DEX +1"). Skill-level caps (max 4, total <= 3x(INT+EDU))
// are enforced in the skills-and-training step; basic training and background
// grants (level 0) never approach them.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";

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

/** "No level listed" cell: gain the skill at 1, or increase it by 1 if trained. */
export function grantSkillIncrement(ch: Character, name: string, source?: string): void {
  ch.addSkill(name, 1, source);
}

/** "Level listed" cell: gain/raise the skill to `level` only if higher than the
 *  current level (an untrained skill is raised straight to `level`). A level-0
 *  floor simply ensures the skill is present at 0. */
export function grantSkillFloor(
  ch: Character, name: string, level: number, source?: string,
): void {
  const cur = skillLevel(ch, name);
  if (cur < 0) {
    ch.addSkill(name, level, source);
  } else if (level > cur) {
    ch.addSkill(name, level - cur, source);
  }
  // else: current level already meets or exceeds the floor — no change.
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
