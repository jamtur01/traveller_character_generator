// Shared ACG skill-cell application. Resolution tables, MOS tables, and
// school tables all yield cells that are either a plain skill name
// ("Gun Combat", "Pilot") or an attribute-bump form ("+1 Strength").
// Lives in its own module so all four pathways and schools.ts can import
// without forming a pathway → pathway cross-dependency.

import type { Character } from "../../character";

const ATTR_PREFIX_MAP: ReadonlyArray<[string, "strength" | "dexterity" | "endurance" | "intelligence" | "education" | "social"]> = [
  ["str", "strength"],
  ["dex", "dexterity"],
  ["end", "endurance"],
  ["int", "intelligence"],
  ["edu", "education"],
  ["soc", "social"],
];

/** Apply an ACG skill table cell to the character. Cells may be plain
 *  skill names ("Gun Combat", "Heavy Weapons") or "+1 Attribute" forms.
 *  `source` is recorded on the resulting ev.skillLearned so the history
 *  panel attributes the grant to its originating table/school. */
export function applyAcgSkillCell(ch: Character, cell: string, source?: string): void {
  const attrMatch = cell.match(/^\+(\d+)\s+(\w+)$/);
  if (attrMatch) {
    const delta = parseInt(attrMatch[1]!, 10);
    const a = attrMatch[2]!.toLowerCase();
    const match = ATTR_PREFIX_MAP.find(([prefix]) => a.startsWith(prefix));
    if (match) ch.improveAttribute(match[1], delta);
    return;
  }
  ch.addSkill(cell, 1, source);
}
