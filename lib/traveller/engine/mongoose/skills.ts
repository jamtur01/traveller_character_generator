// Mongoose 2e skill-grant semantics (Core p.19). A skill-table cell is either a
// bare skill (gain at 1, or +1 if trained), a skill with a level floor
// ("Streetwise 1", "Gambler 0" -> raise to that level only if higher), or a
// characteristic boost ("DEX +1"). Skill-level caps (max 4, total <= 3x(INT+EDU))
// are enforced in the skills-and-training step; basic training and background
// grants (level 0) never approach them.

import type { Character } from "@/lib/traveller/character";

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
