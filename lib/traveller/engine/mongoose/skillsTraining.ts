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
import { optionDomain } from "@/lib/traveller/editions/optionDomains";

interface TrainingTable {
  readonly key: string;
  readonly label: string;
  readonly column: MongooseSkillColumn;
}

/** The skill tables the Traveller may roll on this term. */
export function availableTables(ch: Character): TrainingTable[] {
  const { state, career, asg } = currentAssignment(ch);
  const st = career.skillTables;
  const ae = st.advancedEducation;
  const aeMin = st.advancedEducationEduMin;
  const officer = st.officer;
  // Per-key {label, column} builder + availability gate (Core pp.18-19). A key
  // whose builder returns undefined is not offered this term: Advanced
  // Education is gated by EDU, Officer by commission. The offered key SET and
  // its order come from the edition's declared skillTrainingTables.
  const build: Record<string, () => { label: string; column: MongooseSkillColumn } | undefined> = {
    personalDevelopment: () => ({ label: "Personal Development", column: st.personalDevelopment }),
    serviceSkills: () => ({ label: "Service Skills", column: st.serviceSkills }),
    assignment: () => ({ label: asg.displayName, column: asg.skills }),
    advancedEducation: () =>
      ae && aeMin !== null && ch.attributes.education >= aeMin
        ? { label: "Advanced Education", column: ae }
        : undefined,
    officer: () =>
      state.commissioned && officer ? { label: "Officer", column: officer } : undefined,
  };
  const tables: TrainingTable[] = [];
  for (const key of optionDomain(ch.editionId, "mongoose.skillTable").values) {
    const entry = build[key]?.();
    if (entry) tables.push({ key, label: entry.label, column: entry.column });
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
      const roll = c.rng.roll(1);
      const cell = table.column[roll];
      if (typeof cell !== "string") {
        throw new Error(
          `Mongoose training column "${table.label}" has no skill at rolled index ${roll} ` +
          "(Core pp.18-19: every 1D cell grants a skill) — fix the edition JSON",
        );
      }
      applySkillCell(c, cell, table.label);
    },
  });
}
