// Mongoose 2e skill-grant semantics (Core p.19). A skill-table cell is either a
// bare skill (gain at 1, or +1 if trained), a skill with a level floor
// ("Streetwise 1", "Gambler 0" -> raise to that level only if higher), or a
// characteristic boost ("DEX +1"). Skill-level caps (max 4, total <= 3x(INT+EDU))
// are enforced in the skills-and-training step; basic training and background
// grants (level 0) never approach them.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getMongooseData, splitTopLevelOr, ATTR_ABBREV, ATTR_CELL } from "@/lib/traveller/engine/mongoose/core";

/** Current level of a skill, or -1 if untrained (distinct from a trained 0). */
export function skillLevel(ch: Character, name: string): number {
  const found = ch.skills.find(([n]) => n === name);
  return found ? found[1] : -1;
}

/** Levels still grantable before hitting the total skill-level cap (Core p.19:
 *  multiplier x sum of the capped attributes, i.e. 3 x (INT + EDU)). */
function remainingTotalCap(ch: Character): number {
  const { multiplier, attributes } = getMongooseData(ch).skillTotalCap;
  const cap = multiplier * attributes.reduce(
    (sum, a) => sum + ch.attributes[a as AttributeKey], 0,
  );
  return cap - ch.totalSkillLevels();
}

/** True when the character is at the total skill-level cap (Core p.19:
 *  multiplier x sum of the capped attributes, i.e. 3 x (INT + EDU)). */
function atTotalCap(ch: Character): boolean {
  return remainingTotalCap(ch) <= 0;
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
    if (target <= 0) {
      ch.addSkill(name, 0, source);
      return;
    }
    const add = Math.min(target, remainingTotalCap(ch));
    if (add > 0) ch.addSkill(name, add, source);
  } else if (target > cur) {
    const add = Math.min(target - cur, remainingTotalCap(ch));
    if (add > 0) ch.addSkill(name, add, source);
  }
}

/** Apply a skill-table / rank-benefit cell string (Core p.19), in order:
 *  1. "SOC 10 or SOC +1, whichever is higher" (officer ranks, Core p.25/32/36):
 *     set the characteristic to max(floor, current + delta) via improveAttribute
 *     of the difference, respecting attribute caps.
 *  2. A top-level "X or Y" cell ("Drive or Vacc Suit", "Gun Combat 1 or Melee 1"):
 *     a player choice of one part, each re-parsed through applySkillCell. A
 *     specialty parenthesis ("Pilot (small craft or spacecraft)") is NOT a choice.
 *  3. "DEX +1" / "SOC +1" -> raise that characteristic (respecting attribute caps).
 *  4. "Streetwise 1" / "Gambler 0" -> raise the skill to that level floor.
 *  5. "Gun Combat" / "Electronics (comms)" -> gain at 1, or +1 if trained
 *     (speciality parentheses preserved as part of the skill name). */
export function applySkillCell(ch: Character, cell: string, source?: string): void {
  const higher = cell.match(
    /^(STR|DEX|END|INT|EDU|SOC)\s+(\d+)\s+or\s+\1\s*\+(\d+),?\s*whichever is higher$/i,
  );
  if (higher) {
    const key = ATTR_ABBREV[higher[1]!.toUpperCase()]!;
    const target = Math.max(Number(higher[2]), ch.attributes[key] + Number(higher[3]));
    const diff = target - ch.attributes[key];
    if (diff > 0) ch.improveAttribute(key, diff);
    return;
  }
  const parts = splitTopLevelOr(cell);
  if (parts.length > 1) {
    ch.pickOrDefer({
      kind: "mongooseSkillChoice",
      label: `Choose one: ${cell}`,
      options: parts,
      onResolve: (c, chosen) => applySkillCell(c, chosen, source),
    });
    return;
  }
  const attr = cell.match(ATTR_CELL);
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
