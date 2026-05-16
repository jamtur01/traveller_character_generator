// Navy pathway implementation. Per MT Players' Manual pp. 52-55.
//
// Differences from Mercenary:
//   - Three fleets: Imperial Navy, Reserve Fleet, System Squadron.
//     System Squadron requires homeworld tech Early Stellar+.
//   - Six branches: Line, Flight, Gunnery, Engineering, Medical, Technical.
//     Branch is rolled on the Branch Assignment table (officers and
//     enlisted have different columns) at enlistment.
//   - Single-column assignment table (no per-branch column).
//   - Five assignment-resolution tables: lineCrew, flight, gunnery,
//     engineering, technicalMedical.
//   - Reenlistment is a single target with rank DM.

import type { Character } from "../../../character";
import { getEdition } from "../../../editions";
import { roll } from "../../../random";
import {
  applyDmRules, labelToColumnKey, lookupResolution, parseResolutionTarget,
  rollVsTarget,
} from "../tables";
import { awardBrownie, awardDecoration, runCourtMartial } from "../awards";
import { applyAcgSkillCell } from "./mercenary";

const PATHWAY = "navy";

interface NavyData {
  enlistment: {
    imperialNavy: { target: number; dms: Array<{ attribute: string; min: number; dm: number }> };
    reserveFleet: { target: number; dms: Array<{ attribute: string; min: number; dm: number }> };
    systemSquadron: { target: number; dms: Array<{ attribute: string; min: number; dm: number }>; requirement: string };
    startingRank: string;
    draft: { die: string; results: Record<string, string> };
    academyRanks?: Record<string, string>;
  };
  branchAssignment: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] };
  initialTraining?: string[];
  commandDuty: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] };
  assignment: { columns: string[]; rows: Array<Record<string, number | string>> };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: string[];
    notes?: string[];
  }>;
  retention?: unknown;
  specialAssignments?: { columns: string[]; rows: Array<Record<string, unknown>> };
  specialistSchool?: Record<string, unknown>;
  serviceSkills?: { columns: string[]; rows: Array<Record<string, unknown>> };
  branchSkills?: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] };
  ranks: { enlisted: Array<[string, string]>; officer: Array<[string, string, number]> };
  reenlistment: { target: number; dms: string[]; branchChange?: string };
}

function dataFor(ch: Character): NavyData {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) throw new Error("Navy pathway requires ACG data");
  return acg.navy as NavyData;
}

/** Enlistment + fleet selection + branch assignment. */
export function navyEnlist(
  ch: Character,
  fleet: "imperialNavy" | "reserveFleet" | "systemSquadron",
): void {
  const data = dataFor(ch);
  const spec = data.enlistment[fleet];
  ch.acgState!.fleet = fleet;

  let dm = 0;
  for (const d of spec.dms) {
    const attr = d.attribute as keyof typeof ch.attributes;
    if (ch.attributes[attr] >= d.min) dm += d.dm;
  }
  const r = roll(2);
  ch.verboseHistory(`Navy enlist (${fleet}): roll ${r} + ${dm} vs ${spec.target}`);

  if (r + dm >= spec.target) {
    ch.history.push(`Enlisted in the ${fleet} Navy.`);
    ch.acgState!.rankCode = data.enlistment.startingRank;
    ch.acgState!.isOfficer = data.enlistment.startingRank.startsWith("O");
  } else {
    // Try draft.
    const dr = roll(1);
    const drafted = data.enlistment.draft.results[String(dr)];
    if (!drafted) {
      throw new Error("Navy draft rejection — choose another path");
    }
    ch.drafted = true;
    ch.acgState!.fleet = "imperialNavy";
    ch.acgState!.rankCode = data.enlistment.startingRank;
    ch.acgState!.isOfficer = false;
    ch.history.push("Drafted into the Imperial Navy.");
  }

  // Branch assignment — different column for officers vs enlisted.
  navyAssignBranch(ch);
}

function navyAssignBranch(ch: Character): void {
  const data = dataFor(ch);
  const col = ch.acgState!.isOfficer ? "officer" : "enlisted";
  // DMs from rules: +2 if Edu 9+, +2 if Int 10+, -2 if Imperial Navy.
  let dm = 0;
  if (ch.attributes.education >= 9) dm += 2;
  if (ch.attributes.intelligence >= 10) dm += 2;
  if (ch.acgState!.fleet === "imperialNavy") dm -= 2;
  const r = Math.max(0, Math.min(7, roll(1) + dm));
  const row = data.branchAssignment.rows.find((row) => row.die === r);
  if (!row) {
    // Default to Line/Crew on miss.
    ch.acgState!.branch = ch.acgState!.isOfficer ? "Line" : "Crew";
    return;
  }
  ch.acgState!.branch = String(row[col] ?? "Line");
  ch.verboseHistory(`Navy branch: ${ch.acgState!.branch}`);
}

/** Initial training: roll 2 skills on Branch Skills table. */
export function navyInitialTraining(ch: Character): void {
  const data = dataFor(ch);
  ch.history.push("Initial Training in the Navy");
  if (!data.branchSkills) return;
  for (let i = 0; i < 2; i++) navyBranchSkillRoll(ch);
}

function navyBranchSkillRoll(ch: Character): void {
  const data = dataFor(ch);
  if (!data.branchSkills) return;
  const r = roll(1);
  const row = data.branchSkills.rows.find((row) => row.die === r);
  if (!row) return;
  // Convert branch to column key.
  const col = labelToColumnKey(ch.acgState!.branch ?? "Line");
  const candidates = [col, col === "line" ? "lineCrew" : col,
    col === "crew" ? "lineCrew" : col];
  let skill: string | undefined;
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === "string") { skill = v; break; }
  }
  if (skill) applyAcgSkillCell(ch, skill);
}

/** Command Duty roll (officers only). */
export function navyCommandDuty(ch: Character): void {
  if (!ch.acgState!.isOfficer) {
    ch.acgState!.inCommand = false;
    return;
  }
  const data = dataFor(ch);
  const branch = ch.acgState!.branch ?? "Line";
  const row = data.commandDuty.rows.find((r) => r.branch === branch);
  if (!row) { ch.acgState!.inCommand = false; return; }
  const parsed = parseResolutionTarget(row.target);
  if (parsed.target === "auto") { ch.acgState!.inCommand = true; return; }
  if (typeof parsed.target !== "number") { ch.acgState!.inCommand = false; return; }
  // DMs from manual: If rank O2-, -2. If Rank O4-, -1. If Int 7-, -1. If Edu 7-, -1.
  let dm = 0;
  const rankNum = parseInt(ch.acgState!.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if (ch.acgState!.isOfficer && rankNum <= 2) dm -= 2;
  if (ch.acgState!.isOfficer && rankNum <= 4) dm -= 1;
  if (ch.attributes.intelligence <= 7) dm -= 1;
  if (ch.attributes.education <= 7) dm -= 1;
  const r = roll(2);
  const success = r + dm >= parsed.target;
  ch.verboseHistory(
    `Navy Command Duty (${branch}): ${r}${dm ? `${dm}` : ""} vs ${parsed.target} → ${success ? "command" : "staff"}`,
  );
  ch.acgState!.inCommand = success;
}

/** Roll the year's assignment from the navy assignment table. */
export function navyRollAssignment(ch: Character): string {
  const data = dataFor(ch);
  if (ch.acgState!.justRetained && ch.acgState!.retainedAssignment) {
    const retained = ch.acgState!.retainedAssignment;
    ch.acgState!.justRetained = false;
    ch.acgState!.retainedAssignment = null;
    return retained;
  }
  // College/Academy E4-E9 → DM +1.
  let dm = 0;
  const rankNum = parseInt(ch.acgState!.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if (!ch.acgState!.isOfficer && rankNum >= 4) dm += 1;
  const r = Math.max(2, Math.min(12, roll(2) + dm));
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Navy assignment table missing row for die=${r}`);
  return String(row.assignment);
}

/** Resolve assignment. Branch picks which resolution sub-table to use. */
export function navyResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  // Map branch to resolution sub-table key.
  const branch = ch.acgState!.branch ?? "Line";
  const resKey =
    branch === "Flight" ? "flight" :
    branch === "Gunnery" ? "gunnery" :
    branch === "Engineering" ? "engineering" :
    (branch === "Medical" || branch === "Technical") ? "technicalMedical" :
    "lineCrew";
  const resTable = data.assignmentResolution[resKey];
  if (!resTable) {
    ch.verboseHistory(`No resolution table for branch ${branch} (sub-key ${resKey})`);
    return;
  }

  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    // Shore Duty / Training etc. — try a fallback resolution if the
    // assignment is "Frozen Watch" (special: 1 year passes, no skills).
    if (assignment === "Frozen Watch") {
      ch.history.push("Frozen Watch: 1 year in suspended animation.");
      ch.age -= 1; // physically 1 year younger than chronologically
      return;
    }
    ch.verboseHistory(`Unknown navy assignment "${assignment}" for branch ${branch}`);
    return;
  }

  const res = lookupResolution(resTable, assignment);
  const decStrategy = ch.acgState!.decorationDmStrategy;
  const survDm = applyDmRules(resTable.dms, ch, "survival") + (decStrategy < 0 ? decStrategy : 0);
  const decDm = applyDmRules(resTable.dms, ch, "decoration") - (decStrategy < 0 ? decStrategy : 0);
  const promoDm = applyDmRules(resTable.dms, ch, "promotion");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");

  const sv = rollVsTarget(res.survival, survDm);
  ch.verboseHistory(`Navy ${assignment} survival: ${sv.roll} + ${survDm} vs ${res.survival}`);
  if (!sv.success) {
    ch.history.push("Failed survival; invalided out of Navy service.");
    ch.activeDuty = false;
    return;
  }
  if (sv.margin === 0 && typeof res.survival === "number" &&
      ["Battle", "Siege", "Strike"].includes(assignment)) {
    ch.acgState!.decorations.push("Purple Heart");
    ch.history.push(`Wounded in ${assignment}; awarded Purple Heart.`);
    ch.acgState!.injuredThisYear = true;
  }

  if (res.decoration !== "none") {
    const dec = rollVsTarget(res.decoration, decDm);
    if (dec.margin >= 6) awardDecoration(ch, "SEH");
    else if (dec.margin >= 3) awardDecoration(ch, "MCG");
    else if (dec.margin >= 0) awardDecoration(ch, "MCUF");
    else if (dec.margin <= -6) runCourtMartial(ch);
  }

  if (res.promotion !== "none" &&
      !(ch.acgState!.isOfficer && res.promotionOfficersBarred) &&
      !(ch.acgState!.isOfficer && ch.acgState!.promotedThisTerm)) {
    const pr = rollVsTarget(res.promotion, promoDm);
    if (pr.success) promoteNavy(ch);
  }

  if (res.skills !== "none") {
    const sk = rollVsTarget(res.skills, skillDm);
    if (sk.success) navyBranchSkillRoll(ch);
  }

  if (["Battle", "Siege", "Strike"].includes(assignment)) {
    ch.acgState!.combatRibbons += 1;
    if (ch.acgState!.inCommand && ch.acgState!.isOfficer) {
      ch.acgState!.commandClusters += 1;
    }
  }

  ch.acgState!.assignmentHistory.push(assignment);
}

function promoteNavy(ch: Character): void {
  const data = dataFor(ch);
  // Rank caps per fleet: System Squadron O7, Reserve O8, Imperial O10.
  let cap = 999;
  if (ch.acgState!.fleet === "systemSquadron") cap = 7;
  else if (ch.acgState!.fleet === "reserveFleet") cap = 8;
  else cap = 10;

  if (ch.acgState!.isOfficer) {
    const codes = data.ranks.officer.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    const targetIdx = Math.min(idx + 1, cap - 1);
    if (idx >= 0 && idx < targetIdx && targetIdx < codes.length) {
      ch.acgState!.rankCode = codes[targetIdx]!;
      ch.acgState!.promotedThisTerm = true;
      ch.history.push(`Promoted to ${data.ranks.officer[targetIdx]![1]}.`);
    }
  } else {
    const codes = data.ranks.enlisted.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.history.push(`Promoted to ${data.ranks.enlisted[idx + 1]![1]}.`);
    }
  }
}

export function navyRetention(ch: Character, assignment: string): void {
  if (ch.acgState!.justRetained) {
    ch.acgState!.justRetained = false;
    return;
  }
  // Per manual p. 53: "no one can be retained in the same assignment more
  // than once in succession". Retention roll: 1D=6 → same next year.
  const r = roll(1);
  if (r === 6 && assignment !== "Special Duty" && assignment !== "Frozen Watch") {
    ch.acgState!.retainedAssignment = assignment;
    ch.acgState!.justRetained = true;
  } else {
    ch.acgState!.retainedAssignment = null;
  }
}

export function navySpecialAssignment(ch: Character): void {
  // Navy doesn't have a standardised specialAssignments table key in our
  // JSON; the manual lists Specialist School, Command College, Staff
  // College, Naval Academy. We treat "Special Duty" as a free skill
  // pick from branch skills + brownie point.
  const data = dataFor(ch);
  if (data.branchSkills) navyBranchSkillRoll(ch);
  awardBrownie(ch, 1, "Special Assignment");
  ch.acgState!.assignmentHistory.push("Special Duty");
}

export function navyReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  let dm = 0;
  const rankNum = parseInt(ch.acgState!.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if ((!ch.acgState!.isOfficer && rankNum >= 4) || ch.acgState!.isOfficer) dm += 1;
  const r = roll(2);
  if (r === 12) {
    ch.mandatoryReenlistment = true;
    return true;
  }
  return r + dm >= data.reenlistment.target;
}

export function getNavyPathway() {
  return {
    pathway: PATHWAY,
    enlist: navyEnlist,
    initialTraining: navyInitialTraining,
    commandDuty: navyCommandDuty,
    rollAssignment: navyRollAssignment,
    resolveAssignment: navyResolveAssignment,
    specialAssignment: navySpecialAssignment,
    retention: navyRetention,
    reenlist: navyReenlist,
  };
}
