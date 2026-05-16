// Specialist school / special-assignment resolution. Each special
// assignment that lands a character at a school or specialty programme
// runs through this module to apply the school's specific effects per
// MT Players' Manual pp. 50-51 (Mercenary), 54-55 (Navy), 56-59 (Scout).
//
// All per-school skill batches, target numbers, and effects live in the
// edition JSON under `advancedCharacterGeneration.<pathway>.specialAssignmentDetails`.
// This module dispatches the effect objects against the character.

import type { Character } from "../../character";
import { getEdition } from "../../editions";
import { roll, arnd } from "../../random";
import { awardBrownie } from "./awards";
import { applyAcgSkillCell } from "./pathways/mercenary";
import { recordTransfer } from "./types";

type Effect = Record<string, unknown> & { type: string };

interface SchoolSpec {
  summary?: string;
  effects: Effect[];
  ageLimit?: number;
}

interface PathwayData {
  specialAssignmentDetails?: Record<string, SchoolSpec>;
  combatArms?: string[];
  branches?: string[];
  mos?: { rows: Array<Record<string, unknown>> };
  specialistSchool?: { rows: Array<Record<string, unknown>>; notes?: string[] };
  serviceSkills?: { rows: Array<Record<string, unknown>> };
  branchSkills?: { rows: Array<Record<string, unknown>> };
  ranks?: { officer: Array<unknown[]> };
}

function pathwayData(ch: Character, pathway: string): PathwayData | null {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) return null;
  return (acg[pathway] as PathwayData | undefined) ?? null;
}

/** Run a special-assignment / school by name for the given pathway. */
export function applySpecialAssignment(
  ch: Character,
  pathway: "mercenary" | "navy",
  assignment: string,
): void {
  if (!ch.acgState) return;
  ch.acgState.schoolsAttended.push(assignment);
  awardBrownie(ch, 1, `Special Assignment: ${assignment}`);

  const data = pathwayData(ch, pathway);
  const spec = data?.specialAssignmentDetails?.[assignment];
  if (!spec) {
    ch.history.push(`Special Assignment "${assignment}" (no JSON detail)`);
    return;
  }
  // Age limits (e.g., OCS over 38) are evaluated by the caller before
  // dispatching here — by the time we run, the caller has either rerolled
  // or invoked the waiver and we apply the school normally.

  for (const effect of spec.effects) {
    runEffect(ch, pathway, assignment, effect, data!);
  }
}

/** Back-compat shim — many call sites still use the mercenary-specific entry. */
export function applyMercenarySchool(ch: Character, assignment: string): void {
  applySpecialAssignment(ch, "mercenary", assignment);
}

function runEffect(
  ch: Character,
  pathway: "mercenary" | "navy",
  schoolName: string,
  effect: Effect,
  data: PathwayData,
): void {
  if (!ch.acgState) return;
  switch (effect.type) {
    case "setCombatArm":
      ch.acgState.combatArm = String(effect.value);
      return;
    case "crossTrainCombatArm": {
      const excl = Array.isArray(effect.exclude) ? (effect.exclude as string[]) : [];
      const arms = (data.combatArms ?? []).filter((a) => !excl.includes(a));
      if (arms.length === 0) return;
      const newArm = arnd(arms);
      const fromArm = ch.acgState.combatArm ?? "";
      recordTransfer(ch.acgState, "combatArm", fromArm, newArm,
        ch.acgState.yearsServed ?? 0);
      ch.acgState.combatArm = newArm;
      ch.acgState.crossTrainedArms = ch.acgState.crossTrainedArms ?? [];
      if (!ch.acgState.crossTrainedArms.includes(newArm)) {
        ch.acgState.crossTrainedArms.push(newArm);
      }
      ch.history.push(`Cross-trained in ${newArm}`);
      return;
    }
    case "crossTrainBranch": {
      const branches = data.branches ?? [];
      if (branches.length === 0) return;
      const current = ch.acgState.branch ?? branches[0]!;
      const opts = branches.filter((b) => b !== current);
      if (opts.length === 0) return;
      const newBranch = arnd(opts);
      recordTransfer(ch.acgState, "branch", current, newBranch,
        ch.acgState.yearsServed ?? 0);
      ch.acgState.branch = newBranch;
      ch.history.push(`Cross-trained in ${newBranch}`);
      return;
    }
    case "rollOnMosTable": {
      const rolls = (effect.rolls as number) ?? 1;
      for (let i = 0; i < rolls; i++) rollOnMos(ch, data);
      return;
    }
    case "rollOnBranchSkillsTable": {
      const rolls = (effect.rolls as number) ?? 1;
      for (let i = 0; i < rolls; i++) rollOnBranchSkills(ch, data);
      return;
    }
    case "rollOnSpecialistSchoolTable":
      rollOnSpecialistSchool(ch, data, schoolName);
      return;
    case "rollOnServiceSkillsTable": {
      const rolls = (effect.rolls as number) ?? 1;
      for (let i = 0; i < rolls; i++) rollOnServiceSkills(ch, data);
      return;
    }
    case "rollSkillBatch": {
      const target = effect.throwTarget as number;
      const skills = effect.skills as string[];
      runSkillBatch(ch, schoolName, target, skills);
      return;
    }
    case "fixedSkill": {
      const skill = String(effect.skill);
      const levels = (effect.levels as number) ?? 1;
      ch.addSkill(skill, levels);
      ch.history.push(`${schoolName}: ${skill}-${levels}`);
      return;
    }
    case "ocsCommission":
      ocsCommission(ch);
      return;
    case "attacheOrAide":
      attacheOrAide(ch, pathway, data);
      return;
    default:
      // Unknown effect type — record and move on rather than crashing.
      ch.history.push(`${schoolName}: unhandled effect ${effect.type}`);
      return;
  }
}

function runSkillBatch(
  ch: Character,
  schoolName: string,
  target: number,
  skills: string[],
): void {
  const awarded: string[] = [];
  for (const skill of skills) {
    if (roll(1) >= target) {
      ch.addSkill(skill, 1);
      awarded.push(skill);
    }
  }
  if (awarded.length > 0) {
    ch.history.push(`${schoolName}: ${awarded.join(", ")}`);
  } else {
    ch.history.push(`${schoolName}: no skills rolled (all 1D < ${target}+)`);
  }
}

function rollOnMos(ch: Character, data: PathwayData): void {
  if (!ch.acgState || !data.mos) return;
  const armKey = (ch.acgState.combatArm ?? "Infantry").toLowerCase();
  const r = roll(1);
  const row = data.mos.rows.find((row) => row.die === r);
  const skill = row?.[armKey];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill);
}

function rollOnBranchSkills(ch: Character, data: PathwayData): void {
  if (!ch.acgState || !data.branchSkills) return;
  const branchKey = (ch.acgState.branch ?? "Line").toLowerCase();
  const r = roll(1);
  const row = data.branchSkills.rows.find((row) => row.die === r);
  if (!row) return;
  const candidates = [branchKey, branchKey === "line" ? "lineCrew" : branchKey,
    branchKey === "crew" ? "lineCrew" : branchKey];
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === "string") { applyAcgSkillCell(ch, v); return; }
  }
}

function rollOnSpecialistSchool(
  ch: Character, data: PathwayData, schoolName: string,
): void {
  if (!ch.acgState || !data.specialistSchool) return;
  const r = roll(1);
  const row = data.specialistSchool.rows.find((row) => row.die === r);
  if (!row) return;
  const useSchooling =
    (ch.attributes.intelligence + ch.attributes.education) > 16;
  const col = useSchooling ? "schooling" : "training";
  const skill = row[col];
  if (typeof skill === "string") {
    ch.history.push(`${schoolName} (${col}): ${skill}-1`);
    applyAcgSkillCell(ch, skill);
  }
}

function rollOnServiceSkills(ch: Character, data: PathwayData): void {
  if (!ch.acgState || !data.serviceSkills) return;
  const r = roll(1);
  const row = data.serviceSkills.rows.find((row) => row.die === r);
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

function ocsCommission(ch: Character): void {
  if (!ch.acgState) return;
  const rankNum = parseInt(ch.acgState.rankCode.replace("E", ""), 10) || 0;
  if (rankNum === 7) {
    ch.acgState.isOfficer = true;
    ch.acgState.rankCode = "O2";
  } else if (rankNum >= 8) {
    ch.acgState.isOfficer = true;
    ch.acgState.rankCode = "O3";
    ch.history.push("OCS: promoted to O3 (no skills due to senior rank)");
  } else {
    ch.acgState.isOfficer = true;
    ch.acgState.rankCode = "O1";
  }
  ch.history.push(`OCS graduation: rank ${ch.acgState.rankCode}`);
}

function attacheOrAide(
  ch: Character,
  pathway: "mercenary" | "navy",
  data: PathwayData,
): void {
  if (!ch.acgState) return;
  const r = roll(1);
  if (r <= 4) {
    promoteOfficer(ch, data);
    ch.improveAttribute("social", 1);
    ch.history.push(`${pathway === "navy" ? "Naval" : "Military"} Attache: promotion + 1 Social`);
  } else {
    ch.improveAttribute("social", 1);
    const role = pathway === "navy" ? "an admiral" : "a general";
    ch.history.push(`Aide to ${role}: + 1 Social`);
  }
}

function promoteOfficer(ch: Character, data: PathwayData): void {
  if (!ch.acgState || !data.ranks?.officer) return;
  const codes = data.ranks.officer.map((r) => r[0] as string);
  const idx = codes.indexOf(ch.acgState.rankCode);
  if (idx >= 0 && idx < codes.length - 1) {
    ch.acgState.rankCode = codes[idx + 1]!;
  }
}

/** Apply Scout school awards. The Scout school assignment table picks
 *  one of six schools; each school then uses 1D on the schools table to
 *  determine the awarded skill. */
/** Scout schools that grant 2 skills per attendance (manual p. 57:
 *  "Certain schools confer two skills, while others confer only one"). */
const TWO_ROLL_SCOUT_SCHOOLS = new Set([
  "Ship School", "Intelligence School", "Contact School",
]);

/** Administrator School: may only be attended once per character; only
 *  characters in the Bureaucracy may attend. A subsequent assignment to
 *  Administrator School calls for a reroll (manual p. 57). */
function scoutCanAttendAdminSchool(ch: Character): boolean {
  if (!ch.acgState) return false;
  if (ch.acgState.division !== "bureaucracy") return false;
  if (ch.acgState.schoolsAttended.includes("Administrator School")) return false;
  return true;
}

export function applyScoutSchool(ch: Character, school: string): void {
  if (!ch.acgState) return;

  // Administrator School constraints. Caller is expected to pre-roll the
  // school name; if it lands on Administrator and the character is barred,
  // we no-op here — the caller (scoutResolveAssignment) is responsible for
  // rolling again. We still record the attempt for visibility.
  if (school === "Administrator School") {
    if (!scoutCanAttendAdminSchool(ch)) {
      ch.verboseHistory("Scout Administrator School denied (already taken or not in Bureaucracy)");
      return;
    }
    ch.acgState.schoolsAttended.push(school);
    awardBrownie(ch, 1, `Scout school: ${school}`);
    // Administrator School promotes ordinary rank holders into the
    // administrator ladder at rank IS-10 (manual p. 57).
    ch.acgState.isOfficer = true;
    if (!ch.acgState.rankCode.match(/^IS-1\d$/)) {
      ch.acgState.rankCode = "IS-10";
      ch.history.push("Promoted to administrator rank IS-10 after Administrator School.");
    }
    return;
  }

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
  const rolls = TWO_ROLL_SCOUT_SCHOOLS.has(school) ? 2 : 1;
  for (let i = 0; i < rolls; i++) {
    const r = roll(1);
    const row = schools.rows.find((row) => row.die === r);
    if (!row) continue;
    const skill = row[col];
    if (typeof skill === "string") applyAcgSkillCell(ch, skill);
  }
}
