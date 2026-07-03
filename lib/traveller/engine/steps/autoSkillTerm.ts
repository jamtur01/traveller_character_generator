// Auto-skill (trigger="term") step. Walks the active service's
// automaticSkills entries and applies any whose trigger is "term" and whose
// term value matches the character's current term. MT Belter Zero-G
// Environ-1 at term 3 is the canonical case.

import { applyCell } from "@/lib/traveller/engine/cellResolver";
import type { StepFn } from "./types";

export const autoSkillTermStep: StepFn = ({ ch, edition }) => {
  if (ch.deceased) return;
  const serviceData = edition.data.services[ch.service];
  if (!serviceData) return;
  for (const entry of serviceData.automaticSkills) {
    if (entry.trigger !== "term") continue;
    if (entry.term !== ch.terms) continue;
    const source = `term ${entry.term} auto-skill`;
    if (entry.effect) {
      applyCell(ch, entry.effect, "skill", undefined, source);
      continue;
    }
    if (entry.skill) {
      ch.addSkill(entry.skill, entry.level ?? 1, source);
    }
  }
};
