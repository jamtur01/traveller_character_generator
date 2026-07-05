// Shared read helpers for the Mongoose 2e engine: strict data access and the
// characteristic-DM lookup used by every career check. Pure over the edition
// JSON (data.mongoose) — no game constants baked here.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule, parseDieCount } from "@/lib/traveller/editions/strict";
import { characteristicDm } from "@/lib/traveller/core";
import type { MongooseData, MongooseCareer, MongooseCheck } from "@/lib/traveller/engine/mongoose/types";

/** The edition's mongoose data block (throws if the edition lacks one). */
export function getMongooseData(ch: Character): MongooseData {
  return requireRule(
    getEdition(ch.editionId).data.mongoose, "mongoose", "MgT2 Core p.8",
  );
}

/** A career by id (throws with a citation path if absent). */
export function getCareer(ch: Character, id: string): MongooseCareer {
  return requireRule(
    getMongooseData(ch).careers[id],
    `mongoose.careers.${id}`, "MgT2 Core pp.22-45",
  );
}

/** The dice modifier a check contributes: the best characteristic DM among its
 *  characteristics (Mongoose "X or Y" takes the higher). An empty list (the
 *  Drifter automatic qualification) contributes 0. */
export function checkDm(ch: Character, check: MongooseCheck): number {
  if (check.characteristics.length === 0) return 0;
  const bands = getMongooseData(ch).characteristicDmBands;
  return Math.max(
    ...check.characteristics.map((k) =>
      characteristicDm(ch.attributes[k as AttributeKey], bands),
    ),
  );
}

/** Roll a fresh Parole Threshold for a Prisoner-career entry/reroll (Core
 *  p.52): the career's `parole.dice` + `parole.plus`, clamped to `parole.max`
 *  (never above 12). Pure over the JSON parole config + `ch.rng`. */
export function rollParoleThreshold(
  ch: Character, parole: { readonly dice: string; readonly plus: number; readonly max: number },
): number {
  const count = parseDieCount(parole.dice, "mongoose career parole.dice (Core p.52)");
  return Math.min(parole.max, ch.rng.roll(count) + parole.plus);
}

/** A characteristic-boost cell ("DEX +1", "SOC -1"): an attribute change, not a
 *  skill. */
const ATTR_CELL = /^(STR|DEX|END|INT|EDU|SOC)\s*[+-]\d+$/;

/** Strip a trailing level from a skill/benefit cell ("Streetwise 1" ->
 *  "Streetwise"), leaving the bare skill name. */
export function skillBaseName(cell: string): string {
  return cell.replace(/\s+[+-]?\d+$/, "");
}

/** Every skill NAME the Mongoose data can grant: the union of all careers'
 *  Personal Development / Service / Advanced Education tables, each assignment's
 *  specialist table, and the background-skills list — each stored as both the
 *  full cell and its level-stripped base name. Characteristic cells ("DEX +1")
 *  are excluded (they are attribute boosts). Used to tell a compound muster
 *  benefit's skill parts from its equipment/attribute parts (Core p.46). */
export function mongooseSkillNames(ch: Character): Set<string> {
  const data = getMongooseData(ch);
  const names = new Set<string>();
  const add = (cell: string | null): void => {
    if (cell === null || ATTR_CELL.test(cell)) return;
    names.add(cell);
    names.add(skillBaseName(cell));
  };
  for (const career of Object.values(data.careers)) {
    const t = career.skillTables;
    for (const col of [t.personalDevelopment, t.serviceSkills, t.advancedEducation]) {
      if (col) for (const cell of col) add(cell);
    }
    for (const asg of career.assignments) for (const cell of asg.skills) add(cell);
  }
  for (const skill of data.backgroundSkills) add(skill);
  return names;
}
