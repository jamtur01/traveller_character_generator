// Specialist school / special-assignment resolution. Each special
// assignment that lands a character at a school or specialty programme
// runs through this module to apply the school's specific skill awards
// per the MT manual (pp. 50–51 for Mercenary; pp. 54–55 for Navy; pp.
// 56–59 for Scout; pp. 60–63 for Merchant Prince).
//
// Pattern: most schools list a set of skills, each rolled on 1D against
// a per-school target. Some grant fixed awards. OCS/officer promotions
// are handled as rank advancements rather than skill awards.

import type { Character } from "../../character";
import { getEdition } from "../../editions";
import { roll, arnd } from "../../random";
import { awardBrownie } from "./awards";
import { applyAcgSkillCell } from "./pathways/mercenary";

interface SkillBatch {
  /** Target on 1D to gain the listed skill at level 1. */
  target: number;
  skills: string[];
}

/** Apply Mercenary special-assignment school awards. Called by
 *  mercenarySpecialAssignment after picking the assignment label. */
export function applyMercenarySchool(ch: Character, assignment: string): void {
  if (!ch.acgState) return;
  ch.acgState.schoolsAttended.push(assignment);
  // Brownie point for the assignment itself (per manual p. 46).
  awardBrownie(ch, 1, `Special Assignment: ${assignment}`);

  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) return;
  const merc = acg.mercenary as Record<string, unknown> | undefined;
  if (!merc) return;

  switch (assignment) {
    case "Cross-Training": {
      // Pick any non-Commando arm; roll on MOS table for new arm.
      const arms = (merc.combatArms as string[]).filter((a) => a !== "Commando");
      const newArm = arnd(arms);
      const armKey = newArm.toLowerCase();
      const mos = merc.mos as { rows: Array<Record<string, unknown>> };
      const r = roll(1);
      const row = mos.rows.find((row) => row.die === r);
      const skill = row?.[armKey];
      if (typeof skill === "string") {
        ch.history.push(`Cross-Training in ${newArm}: ${skill}-1`);
        applyAcgSkillCell(ch, skill);
      }
      return;
    }
    case "Specialist School": {
      const spec = merc.specialistSchool as {
        rows: Array<Record<string, unknown>>;
        notes?: string[];
      };
      const r = roll(1);
      const row = spec.rows.find((row) => row.die === r);
      if (!row) return;
      // Note: schooling column used when Int + Edu > 16.
      const useSchooling =
        (ch.attributes.intelligence + ch.attributes.education) > 16;
      const col = useSchooling ? "schooling" : "training";
      const skill = row[col];
      if (typeof skill === "string") {
        ch.history.push(`Specialist School (${col}): ${skill}-1`);
        applyAcgSkillCell(ch, skill);
      }
      return;
    }
    case "Commando School": {
      // Cross-training in Commandos; throw 5+ for each of:
      ch.acgState.combatArm = "Commando";
      rollSkillBatch(ch, "Commando School", {
        target: 5,
        skills: ["Brawling", "Gun Combat", "Demolitions", "Intrusion",
          "Stealth", "Survival", "Recon", "Vacc Suit", "Blade Combat",
          "Instruction"],
      });
      return;
    }
    case "Protected Forces": {
      rollSkillBatch(ch, "Protected Forces", {
        target: 3,
        skills: ["Vacc Suit", "High-G Environ", "Zero-G Environ"],
      });
      return;
    }
    case "Recruiting Duty":
      ch.addSkill("Recruiting", 1);
      ch.history.push("Recruiting Duty: Recruiting-1");
      return;
    case "OCS": {
      // Enlisted advance to O1 (E7 → O2). Two rolls on Service Skills +
      // one on MOS. E8/E9 → O3, no skills. Prohibited over age 38.
      if (ch.age > 38) {
        ch.history.push("OCS waiver required for age > 38");
        return;
      }
      const rankNum = parseInt(ch.acgState.rankCode.replace("E", ""), 10) || 0;
      if (rankNum === 7) {
        ch.acgState.isOfficer = true;
        ch.acgState.rankCode = "O2";
      } else if (rankNum >= 8) {
        ch.acgState.isOfficer = true;
        ch.acgState.rankCode = "O3";
        ch.history.push("OCS: promoted to O3 (no skills due to senior rank)");
        return;
      } else {
        ch.acgState.isOfficer = true;
        ch.acgState.rankCode = "O1";
      }
      ch.history.push(`OCS graduation: rank ${ch.acgState.rankCode}`);
      // Two rolls on Service Skills + one on MOS.
      rollMercenaryServiceSkill(ch);
      rollMercenaryServiceSkill(ch);
      rollMercenaryMosSkill(ch);
      return;
    }
    case "Intelligence School":
      rollSkillBatch(ch, "Intelligence School", {
        target: 4,
        skills: ["Forgery", "Bribery", "Streetwise", "Interrogation", "Vice"],
      });
      return;
    case "Command College":
      rollSkillBatch(ch, "Command College", {
        target: 4,
        skills: ["Tactics", "Leader", "Recon"],
      });
      return;
    case "Staff College":
      rollSkillBatch(ch, "Staff College", {
        target: 4,
        skills: ["Admin", "Combat Engineering", "Computer", "Robot Ops"],
      });
      return;
    case "Attache/Aide": {
      // 1D: 1-4 attache (rank + Social +1); 5-6 aide (Social +1)
      const r = roll(1);
      if (r <= 4) {
        promoteOfficer(ch);
        ch.improveAttribute("social", 1);
        ch.history.push("Military Attache: promotion + 1 Social");
      } else {
        ch.improveAttribute("social", 1);
        ch.history.push("Aide to a general: + 1 Social");
      }
      return;
    }
    default:
      // Unknown assignment label — at least record it.
      return;
  }
}

/** Roll one skill on Mercenary's serviceSkills table, using the column
 *  appropriate for the character's rank/branch/duty. */
function rollMercenaryServiceSkill(ch: Character): void {
  if (!ch.acgState) return;
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown>;
  const merc = acg.mercenary as Record<string, unknown>;
  const svc = merc.serviceSkills as { rows: Array<Record<string, unknown>> };
  const r = roll(1);
  const row = svc.rows.find((row) => row.die === r);
  if (!row) return;
  let col: string;
  const rankNum = parseInt(ch.acgState.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if (ch.acgState.isOfficer) {
    col = ch.acgState.inCommand ? "commandSkills" : "staffSkills";
  } else if (rankNum >= 3) {
    col = "ncoSkills";
  } else {
    col = ch.acgState.branch === "Marines" ? "marineLife" : "armyLife";
  }
  const skill = row[col];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill);
}

function rollMercenaryMosSkill(ch: Character): void {
  if (!ch.acgState) return;
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown>;
  const merc = acg.mercenary as Record<string, unknown>;
  const mos = merc.mos as { rows: Array<Record<string, unknown>> };
  const armKey = (ch.acgState.combatArm ?? "Infantry").toLowerCase();
  const r = roll(1);
  const row = mos.rows.find((row) => row.die === r);
  if (!row) return;
  const skill = row[armKey];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill);
}

function promoteOfficer(ch: Character): void {
  if (!ch.acgState) return;
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown>;
  const merc = acg.mercenary as { ranks: { officer: unknown[][] } };
  const codes = merc.ranks.officer.map((r) => r[0] as string);
  const idx = codes.indexOf(ch.acgState.rankCode);
  if (idx >= 0 && idx < codes.length - 1) {
    ch.acgState.rankCode = codes[idx + 1]!;
  }
}

/** Apply Scout school awards. The Scout school assignment table picks
 *  one of six schools; each school then uses 1D on the schools table to
 *  determine the awarded skill. */
export function applyScoutSchool(ch: Character, school: string): void {
  if (!ch.acgState) return;
  ch.acgState.schoolsAttended.push(school);
  awardBrownie(ch, 1, `Scout school: ${school}`);

  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown>;
  const scout = acg.scout as Record<string, unknown>;
  const schools = scout.schools as {
    columns: string[];
    rows: Array<Record<string, unknown>>;
  };
  const colMap: Record<string, string> = {
    "Ship School": "shipSchool",
    "Intelligence School": "intelligenceSchool",
    "Technology School": "technologySchool",
    "Specialist School": "specialistSchool",
    "Field Training": "fieldTraining",
    "Contact School": "contactSchool",
  };
  const col = colMap[school];
  if (!col) return;
  const r = roll(1);
  const row = schools.rows.find((row) => row.die === r);
  if (!row) return;
  const skill = row[col];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill);
  // Schools with 2 skills: ship/intelligence (per manual). For now we
  // award one; a second roll gates on a future "honors" rule we don't
  // yet model.
}

/** Helper: for each skill in a batch, roll 1D and award the skill if the
 *  roll meets the target. Used by mercenary special-assignment schools. */
function rollSkillBatch(ch: Character, schoolName: string, batch: SkillBatch): void {
  const awarded: string[] = [];
  for (const skill of batch.skills) {
    const r = roll(1);
    if (r >= batch.target) {
      ch.addSkill(skill, 1);
      awarded.push(skill);
    }
  }
  if (awarded.length > 0) {
    ch.history.push(`${schoolName}: ${awarded.join(", ")}`);
  } else {
    ch.history.push(`${schoolName}: no skills rolled (all 1D < ${batch.target}+)`);
  }
}
