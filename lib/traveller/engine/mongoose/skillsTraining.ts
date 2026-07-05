// Mongoose 2e Skills and Training (Core pp.18-19): each term the Traveller picks
// one available skill table and rolls 1D to gain/raise a skill. Available tables
// are Personal Development, Service Skills, the chosen assignment's specialist
// table, Advanced Education (only if EDU meets the table minimum) and, once
// commissioned, the Officer table. A successful advancement grants an extra
// roll (the model calls this again); the level-4 and total-skill caps are
// enforced by the skill-grant helpers.

import type { Character } from "@/lib/traveller/character";
import { currentAssignment } from "@/lib/traveller/engine/mongoose/core";
import { applySkillCell } from "@/lib/traveller/engine/mongoose/skills";
import type { MongooseSkillColumn } from "@/lib/traveller/engine/mongoose/types";

interface TrainingTable {
  readonly key: string;
  readonly label: string;
  readonly column: MongooseSkillColumn;
}

/** The skill tables the Traveller may roll on this term. */
export function availableTables(ch: Character): TrainingTable[] {
  const { state, career, asg } = currentAssignment(ch);
  const tables: TrainingTable[] = [
    { key: "personalDevelopment", label: "Personal Development", column: career.skillTables.personalDevelopment },
    { key: "serviceSkills", label: "Service Skills", column: career.skillTables.serviceSkills },
    { key: "assignment", label: asg.displayName, column: asg.skills },
  ];
  const ae = career.skillTables.advancedEducation;
  const aeMin = career.skillTables.advancedEducationEduMin;
  if (ae && aeMin !== null && ch.attributes.education >= aeMin) {
    tables.push({ key: "advancedEducation", label: "Advanced Education", column: ae });
  }
  if (state.commissioned && career.skillTables.officer) {
    tables.push({ key: "officer", label: "Officer", column: career.skillTables.officer });
  }
  return tables;
}

/** Roll one skill: the player picks a table, then a 1D roll selects the cell to
 *  apply (Core p.18). */
export function rollSkillTraining(ch: Character, current?: number, total?: number): void {
  const tables = availableTables(ch);
  ch.pickOrDefer({
    kind: "mongooseSkillTable",
    label: "Choose a skill table to train on",
    options: tables.map((t) => t.label),
    ...(current !== undefined && total !== undefined
      ? { progress: { current, total } }
      : {}),
    onResolve: (c, chosen) => {
      const table = tables.find((t) => t.label === chosen) ?? tables[0]!;
      const cell = table.column[c.rng.roll(1)];
      if (typeof cell === "string") applySkillCell(c, cell, table.label);
    },
  });
}
