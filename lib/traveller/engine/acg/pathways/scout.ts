// Scout pathway implementation. Per MT Players' Manual pp. 56-59.
//
// Scout-specific structure:
//   - No officer/enlisted distinction. "Ordinary" rank IS-1..IS-9
//     corresponds to enlisted; "Administrator" rank IS-10..IS-18
//     corresponds to officer.
//   - College honors graduates start at IS-10 (administrator).
//   - Two divisions: Field and Bureaucracy. College grads → Bureaucracy.
//   - Office assignment within division (Survey/Communications/Exploration
//     for Field; Technical/Operations/Administration/Detached Duty for
//     Bureaucracy).
//   - No command duty step.
//   - Per-assignment resolution: survival → promotion → skills. No
//     decoration step (scouts don't earn decorations — the manual omits
//     it from the resolution tables).
//   - Reenlistment: 3+, with up-or-out rule (ordinary rank must be ≥
//     terms served or no reenlistment).

import type { Character } from "../../../character";
import { getEdition } from "../../../editions";
import { roll } from "../../../random";
import {
  applyDmRules, labelToColumnKey, lookupResolution, rollVsTarget,
} from "../tables";
import { applyAcgSkillCell } from "./mercenary";

const PATHWAY = "scout";

interface ScoutData {
  enlistment: {
    target: number;
    dms: Array<{ attribute: string; min: number; dm: number }>;
    startingRank: string;
    automatic?: string;
    draft: { die: string; results: Record<string, string> };
  };
  officeAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  initialTraining?: Record<string, unknown>;
  dutyAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  assignmentResolution: Record<string, { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] }>;
  schoolAssignment?: Record<string, unknown>;
  schools?: { columns: string[]; rows: Array<Record<string, unknown>> };
  skillTables: { field: { columns: string[]; rows: Array<Record<string, unknown>> }; bureaucracy: { columns: string[]; rows: Array<Record<string, unknown>> } };
  ranks: { ordinary: Array<[string, string]>; administrator: Array<[string, string, number]> };
  reenlistment: { target: number; upOrOut: string };
}

function dataFor(ch: Character): ScoutData {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) throw new Error("Scout pathway requires ACG data");
  return acg.scout as ScoutData;
}

export function scoutEnlist(ch: Character): void {
  const data = dataFor(ch);
  let dm = 0;
  for (const d of data.enlistment.dms) {
    const attr = d.attribute as keyof typeof ch.attributes;
    if (ch.attributes[attr] >= d.min) dm += d.dm;
  }
  const r = roll(2);
  ch.verboseHistory(`Scout enlist: ${r} + ${dm} vs ${data.enlistment.target}`);
  if (r + dm >= data.enlistment.target) {
    ch.history.push("Enlisted in the Imperial Scout Service.");
    ch.acgState!.rankCode = data.enlistment.startingRank;
    ch.acgState!.isOfficer = false;
  } else {
    const dr = roll(1);
    if (data.enlistment.draft.results[String(dr)] !== "Scouts") {
      throw new Error("Scout draft rejection — choose another path");
    }
    ch.drafted = true;
    ch.acgState!.rankCode = data.enlistment.startingRank;
    ch.history.push("Drafted into the Scout Service.");
  }
  // Office selection — Field is default (non-college); Bureaucracy for
  // college grads. Roll once on officeAssignment for the chosen division.
  scoutAssignOffice(ch);
}

function scoutAssignOffice(ch: Character): void {
  const data = dataFor(ch);
  // Without pre-career college rolls we default everyone to Field. A UI
  // upgrade later can let the player pick the division.
  const division: "field" | "bureaucracy" = ch.acgState!.division ?? "field";
  ch.acgState!.division = division;
  const r = Math.max(2, Math.min(12, roll(2)));
  const row = data.officeAssignment.rows.find((row) => row.die === r);
  if (!row) { ch.acgState!.office = "Survey"; return; }
  const off = row[division];
  ch.acgState!.office = typeof off === "string" ? off : "Survey";
  ch.verboseHistory(`Scout office: ${ch.acgState!.office} (${division})`);
}

export function scoutInitialTraining(ch: Character): void {
  ch.history.push("Initial Training in the Scout Service");
  scoutRollSkill(ch);
}

function scoutRollSkill(ch: Character): void {
  const data = dataFor(ch);
  const division = ch.acgState!.division ?? "field";
  const table = data.skillTables[division];
  const r = roll(1);
  const row = table.rows.find((row) => row.die === r);
  if (!row) return;
  // The skill table columns vary; just take the first column that has a value.
  for (const col of table.columns) {
    if (col === "die") continue;
    const v = row[col];
    if (typeof v === "string") {
      applyAcgSkillCell(ch, v);
      return;
    }
  }
}

export function scoutRollAssignment(ch: Character): string {
  const data = dataFor(ch);
  if (ch.acgState!.justRetained && ch.acgState!.retainedAssignment) {
    const retained = ch.acgState!.retainedAssignment;
    ch.acgState!.justRetained = false;
    ch.acgState!.retainedAssignment = null;
    return retained;
  }
  const division = ch.acgState!.division ?? "field";
  // Bureaucracy admin rank → DM +2 (voluntary). For now we apply it
  // automatically since the player would normally take it.
  let dm = 0;
  if (division === "bureaucracy" && ch.acgState!.rankCode.startsWith("IS-1") &&
      ch.acgState!.rankCode !== "IS-1") {
    // crude: IS-10+ → admin rank → +2
    dm += 2;
  }
  const r = Math.max(2, Math.min(12, roll(2) + dm));
  // Natural 2 = wartime mission regardless of DM.
  const dieKey = (r === 2 ? 2 : r);
  const row = data.dutyAssignment.rows.find((row) => row.die === dieKey);
  if (!row) return "Routine";
  const v = row[division];
  return typeof v === "string" ? v : "Routine";
}

export function scoutResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  // Resolution sub-table keyed by office.
  const officeKey = labelToColumnKey(ch.acgState!.office ?? "Survey");
  const resTable = data.assignmentResolution[officeKey];
  if (!resTable) {
    ch.verboseHistory(`Scout: no resolution sub-table for office ${ch.acgState!.office}`);
    return;
  }
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    ch.verboseHistory(`Scout: assignment "${assignment}" not in resolution columns`);
    return;
  }
  const res = lookupResolution(resTable, assignment);
  const survDm = applyDmRules(resTable.dms, ch, "survival");
  const promoDm = applyDmRules(resTable.dms, ch, "promotion");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");

  const sv = rollVsTarget(res.survival, survDm);
  ch.verboseHistory(`Scout ${assignment} survival: ${sv.roll} + ${survDm} vs ${res.survival}`);
  if (!sv.success) {
    ch.history.push("Failed survival; invalided out of Scout service.");
    ch.activeDuty = false;
    return;
  }

  // Bureaucracy → administrator rank ladder is climbed via promotion
  // throws. Field → no promotion possible. Per manual.
  const division = ch.acgState!.division ?? "field";
  if (division === "bureaucracy" && res.promotion !== "none" &&
      !(ch.acgState!.isOfficer && ch.acgState!.promotedThisTerm)) {
    const pr = rollVsTarget(res.promotion, promoDm);
    if (pr.success) promoteScout(ch);
  }

  if (res.skills !== "none") {
    const sk = rollVsTarget(res.skills, skillDm);
    if (sk.success) scoutRollSkill(ch);
  }

  // Special/War mission → extra skill.
  if (assignment === "Special Mission" || assignment === "Wartime Mission") {
    scoutRollSkill(ch);
  }

  ch.acgState!.assignmentHistory.push(assignment);
}

function promoteScout(ch: Character): void {
  const data = dataFor(ch);
  // Ordinary rank can climb to IS-9; beyond that requires admin school.
  if (!ch.acgState!.isOfficer) {
    const codes = data.ranks.ordinary.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.history.push(`Promoted to ${data.ranks.ordinary[idx + 1]![1]}.`);
    }
  } else {
    const codes = data.ranks.administrator.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.acgState!.promotedThisTerm = true;
      ch.history.push(`Promoted to ${data.ranks.administrator[idx + 1]![1]}.`);
    }
  }
}

export function scoutRetention(ch: Character, assignment: string): void {
  if (ch.acgState!.justRetained) {
    ch.acgState!.justRetained = false;
    return;
  }
  const r = roll(1);
  if (r === 6 && assignment !== "Special Duty" && assignment !== "Special Mission" &&
      assignment !== "Wartime Mission") {
    ch.acgState!.retainedAssignment = assignment;
    ch.acgState!.justRetained = true;
  } else {
    ch.acgState!.retainedAssignment = null;
  }
}

export function scoutReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  // Up-or-out: ordinary rank must be ≥ terms served.
  const rankNum = parseInt(ch.acgState!.rankCode.replace("IS-", ""), 10) || 0;
  if (!ch.acgState!.isOfficer && rankNum < ch.terms) {
    ch.history.push("Up-or-out: insufficient rank to reenlist.");
    return false;
  }
  const r = roll(2);
  if (r === 12) {
    ch.mandatoryReenlistment = true;
    return true;
  }
  return r >= data.reenlistment.target;
}

export function getScoutPathway() {
  return {
    pathway: PATHWAY,
    enlist: scoutEnlist,
    initialTraining: scoutInitialTraining,
    rollAssignment: scoutRollAssignment,
    resolveAssignment: scoutResolveAssignment,
    retention: scoutRetention,
    reenlist: scoutReenlist,
  };
}
