// Shared read helpers for the Mongoose 2e engine: strict data access and the
// characteristic-DM lookup used by every career check. Pure over the edition
// JSON (data.mongoose) — no game constants baked here.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule, parseDieCount } from "@/lib/traveller/editions/strict";
import { characteristicDm } from "@/lib/traveller/core";
import type { MongooseData, MongooseCareer, MongooseCheck, MongooseAssignment } from "@/lib/traveller/engine/mongoose/types";
import type { MongooseState } from "@/lib/traveller/engine/mongoose/state";

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

/** The current career context every per-term step needs: the mongoose state,
 *  the current career id, and the resolved career (all fail-loud with a
 *  citation). Collapses the copy-pasted state -> careerId -> career preamble. */
export function currentCareer(ch: Character): {
  state: MongooseState;
  careerId: string;
  career: MongooseCareer;
} {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const careerId = requireRule(state.career, "mongooseState.career", "engine (mongoose)");
  return { state, careerId, career: getCareer(ch, careerId) };
}

/** Resolve one assignment on a career by id (fail-loud with a citation path). */
export function requireAssignment(career: MongooseCareer, id: string): MongooseAssignment {
  return requireRule(
    career.assignments.find((a) => a.id === id),
    `mongoose.careers.${career.id}.assignments.${id}`, "MgT2 Core",
  );
}

/** The current career context plus the resolved current assignment. Used by the
 *  survival / advancement / skills-training steps. */
export function currentAssignment(ch: Character): {
  state: MongooseState;
  careerId: string;
  career: MongooseCareer;
  asg: MongooseAssignment;
} {
  const cc = currentCareer(ch);
  const assignmentId = requireRule(
    cc.state.assignment, "mongooseState.assignment", "engine (mongoose)",
  );
  return { ...cc, asg: requireAssignment(cc.career, assignmentId) };
}

/** Find a table row keyed by its `.roll` value (2D events / 1D mishaps / injury
 *  / life events / draft), failing loud with the JSON `what` path + `rule`
 *  citation if absent. The caller keeps its own roll, log, and
 *  applyEffects/applyReductions tail. */
export function findRollRow<T extends { readonly roll: number }>(
  rows: readonly T[], roll: number, what: string, rule: string,
): T {
  return requireRule(rows.find((r) => r.roll === roll), what, rule);
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

/** Printed characteristic abbreviations in skill / rank / benefit cells ->
 *  attribute keys. The only valid characteristic tokens in a cell (a full name
 *  is a data typo). Shared by the skills / effects / muster cell parsers. */
export const ATTR_ABBREV: Record<string, AttributeKey> = {
  STR: "strength", DEX: "dexterity", END: "endurance",
  INT: "intelligence", EDU: "education", SOC: "social",
};

/** A characteristic-boost cell ("DEX +1", "SOC -1"): an attribute change, not a
 *  skill. Capture group 1 is the abbreviation, group 2 the signed delta ("+1"),
 *  so the same regex serves both the boolean test and the parse-and-apply. */
export const ATTR_CELL = /^(STR|DEX|END|INT|EDU|SOC)\s*([+-]\d+)$/;

/** Strip a trailing level from a skill/benefit cell ("Streetwise 1" ->
 *  "Streetwise"), leaving the bare skill name. */
export function skillBaseName(cell: string): string {
  return cell.replace(/\s+[+-]?\d+$/, "");
}

/** Split a skill/benefit cell on top-level " or " (parenthesis depth 0 only):
 *  "Drive or Vacc Suit" -> ["Drive", "Vacc Suit"], but a specialty parenthesis
 *  is preserved ("Pilot (small craft or spacecraft)" stays a single part). A
 *  cell with no top-level " or " returns as a one-element list. */
export function splitTopLevelOr(cell: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cell.length; i++) {
    const c = cell[i]!;
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && cell.startsWith(" or ", i)) {
      parts.push(cell.slice(start, i).trim());
      i += 3;
      start = i + 1;
    }
  }
  parts.push(cell.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** Every skill NAME the Mongoose data can grant: the union of all careers'
 *  Personal Development / Service / Advanced Education tables, each assignment's
 *  specialist table, and the background-skills list — each stored as both the
 *  full cell and its level-stripped base name. A "X or Y" cell is split on its
 *  top-level " or " so the catalog holds the atomic skill names ("Drive or
 *  Flyer" contributes "Drive" and "Flyer", never the merged string).
 *  Characteristic cells ("DEX +1") are excluded (they are attribute boosts).
 *  Used to tell a compound muster benefit's skill parts from its equipment/
 *  attribute parts (Core p.46). */
export function mongooseSkillNames(ch: Character): Set<string> {
  const data = getMongooseData(ch);
  const names = new Set<string>();
  const add = (cell: string | null): void => {
    if (cell === null) return;
    for (const part of splitTopLevelOr(cell)) {
      if (ATTR_CELL.test(part)) continue;
      names.add(part);
      names.add(skillBaseName(part));
    }
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
