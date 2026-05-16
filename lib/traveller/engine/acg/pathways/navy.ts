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
  applyDmRules, applyStructuredDms, labelToColumnKey, lookupResolution,
  parseResolutionTarget, rollVsTarget,
  type StructuredDm,
} from "../tables";
import { awardDecoration, runCourtMartial } from "../awards";
import { tryMitigate } from "../browniePoints";
import { applySpecialAssignment } from "../schools";
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
  branchAssignment: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  branchResolution?: Record<string, string>;
  branches?: string[];
  initialTraining?: string[];
  commandDuty: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  assignment: {
    columns: string[];
    rows: Array<Record<string, number | string>>;
    dms?: StructuredDm[];
  };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: string[];
    notes?: string[];
  }>;
  retention?: unknown;
  specialAssignments?: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  specialAssignmentDetails?: Record<string, unknown>;
  combatAssignments?: string[];
  rankCaps?: { imperialNavy: number; reserveFleet: number; systemSquadron: number };
  specialistSchool?: Record<string, unknown>;
  serviceSkills?: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  branchSkills?: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  ranks: { enlisted: Array<[string, string]>; officer: Array<[string, string, number]> };
  reenlistment: {
    perFleet?: Record<string, {
      target: number;
      dms: Array<{ condition: string; dm: number }>;
    }>;
    target?: number;
    dms?: string[];
    branchChange?: string;
    fleetChange?: string;
  };
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
  // System Squadron requires homeworld tech Early Stellar+ (PM p. 52).
  if (fleet === "systemSquadron") {
    const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
      | { homeworld?: { techCodeOrder?: string[] } } | undefined;
    const order = (getEdition(ch.editionId).data as { homeworld?: { techCodeOrder?: string[] } })
      .homeworld?.techCodeOrder ?? acg?.homeworld?.techCodeOrder;
    const hwTech = ch.homeworld?.tech;
    if (order && hwTech) {
      const idx = order.indexOf(hwTech);
      const minIdx = order.indexOf("Early Stellar");
      if (idx < minIdx) {
        throw new Error(
          `System Squadron requires homeworld tech Early Stellar+; this homeworld is ${hwTech}`,
        );
      }
    }
  }
  const data = dataFor(ch);
  const spec = data.enlistment[fleet];
  ch.acgState!.fleet = fleet;

  // Naval Academy / NOTC graduates auto-enlist at O1 (Imperial Navy or
  // Reserve Fleet respectively, per manual p. 52).
  if (ch.acgState!.preCareerCommission) {
    ch.history.push(`Auto-enlisted in the ${fleet} Navy as ${ch.acgState!.rankCode} (academy/NOTC).`);
    navyAssignBranch(ch);
    return;
  }

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
  // Medical/Flight School graduates: automatic branch (manual p. 52).
  // Social 9+ characters may also pick any branch — that's a player choice
  // exposed in pickOrDefer.
  const schools = ch.acgState!.schoolsAttended;
  if (schools.includes("medicalSchool")) {
    ch.acgState!.branch = "Medical";
    ch.verboseHistory("Navy branch (auto from Medical School): Medical");
    return;
  }
  if (schools.includes("flightSchool")) {
    ch.acgState!.branch = "Flight";
    ch.verboseHistory("Navy branch (auto from Flight School): Flight");
    return;
  }
  if (ch.attributes.social >= 9 && data.branches && ch.choiceMode === "interactive") {
    ch.pickOrDefer({
      kind: "navyBranch",
      label: "Choose your Naval branch (Social 9+ may select).",
      options: data.branches,
      onResolve: (c, branch) => { c.acgState!.branch = branch; },
    });
    return;
  }
  const col = ch.acgState!.isOfficer ? "officer" : "enlisted";
  const dm = applyStructuredDms(data.branchAssignment.dms, ch);
  const r = Math.max(0, Math.min(7, roll(1) + dm));
  const row = data.branchAssignment.rows.find((row) => row.die === r);
  if (!row) {
    ch.acgState!.branch = ch.acgState!.isOfficer ? "Line" : "Crew";
    return;
  }
  ch.acgState!.branch = String(row[col] ?? "Line");
  ch.verboseHistory(`Navy branch: ${ch.acgState!.branch}`);
}

/** Initial training: 2 skills on Branch Skills (enlisted) or Officer Staff
 *  Skills (officers). Officers may choose which table per manual p. 52.
 *  Drafted characters and OCS commissions skip initial training entirely. */
export function navyInitialTraining(ch: Character): void {
  // OCS graduates from a previous term skip initial training (manual p. 52).
  // We use `preCareerCommission` as the trigger because the only way an ACG
  // navy character can have skipped initial training is academy/NOTC entry.
  // Drafted characters get standard initial training, but the manual exempts
  // OCS — that's handled when OCS fires mid-career, not at term 1.
  const data = dataFor(ch);
  ch.history.push("Initial Training in the Navy");
  if (!data.branchSkills) return;
  if (ch.acgState!.isOfficer && ch.choiceMode === "interactive") {
    // Officers may choose Branch Skills or Officer Staff Skills for each
    // of the two initial-training rolls. Expose as a player choice.
    for (let i = 0; i < 2; i++) navyOfficerSkillChoice(ch);
    return;
  }
  for (let i = 0; i < 2; i++) navyBranchSkillRoll(ch);
}

function navyOfficerSkillChoice(ch: Character): void {
  ch.pickOrDefer({
    kind: "navyOfficerSkillTable",
    label: "Officer training: roll on which skill table?",
    options: ["Branch Skills", "Officer Staff Skills"],
    onResolve: (c, table) => {
      if (table === "Officer Staff Skills") navyServiceSkillRoll(c, "staffOfficer");
      else navyBranchSkillRoll(c);
    },
  });
}

function navyServiceSkillRoll(ch: Character, column: string): void {
  const data = dataFor(ch);
  if (!data.serviceSkills) return;
  const r = roll(1);
  const row = data.serviceSkills.rows.find((row) => row.die === r);
  if (!row) return;
  const skill = row[column];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill);
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
  // Per manual: not consulting the table results in assignment to staff.
  // In interactive mode the player can decline the roll.
  if (ch.choiceMode === "interactive") {
    ch.pickOrDefer({
      kind: "commandDutyOptIn",
      label: "Attempt the command-duty roll this year?",
      options: ["Roll for command", "Take staff position"],
      onResolve: (c, choice) => {
        if (choice === "Take staff position") {
          c.acgState!.inCommand = false;
          return;
        }
        navyRollCommandDuty(c);
      },
    });
    return;
  }
  navyRollCommandDuty(ch);
}

function navyRollCommandDuty(ch: Character): void {
  const data = dataFor(ch);
  const branch = ch.acgState!.branch ?? "Line";
  const row = data.commandDuty.rows.find((r) => r.branch === branch);
  if (!row) { ch.acgState!.inCommand = false; return; }
  const parsed = parseResolutionTarget(row.target);
  if (parsed.target === "auto") { ch.acgState!.inCommand = true; return; }
  if (typeof parsed.target !== "number") { ch.acgState!.inCommand = false; return; }
  const dm = applyStructuredDms(data.commandDuty.dms, ch);
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
  const dm = applyStructuredDms(data.assignment.dms, ch);
  const r = Math.max(2, Math.min(12, roll(2) + dm));
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Navy assignment table missing row for die=${r}`);
  return String(row.assignment);
}

/** Resolve assignment. Branch picks which resolution sub-table to use. */
export function navyResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  const branch = ch.acgState!.branch ?? "Line";
  const resKey = data.branchResolution?.[branch] ?? "lineCrew";
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
  if (ch.choiceMode === "interactive" &&
      res.decoration !== "none" &&
      typeof res.survival === "number" &&
      typeof res.decoration === "number") {
    promptDecorationDmTradeoff(ch);
  }
  const decStrategy = ch.acgState!.decorationDmStrategy;
  const survDm = applyDmRules(resTable.dms, ch, "survival") + (decStrategy < 0 ? decStrategy : 0);
  const decDm = applyDmRules(resTable.dms, ch, "decoration") - (decStrategy < 0 ? decStrategy : 0);
  const promoDm = applyDmRules(resTable.dms, ch, "promotion");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");

  const sv = rollVsTarget(res.survival, survDm);
  ch.verboseHistory(`Navy ${assignment} survival: ${sv.roll} + ${survDm} vs ${res.survival}`);
  if (!sv.success) {
    const mit = tryMitigate(ch, {
      rollName: "survival",
      rollValue: sv.roll,
      dm: survDm,
      target: typeof res.survival === "number" ? res.survival : 0,
      margin: sv.margin,
      consequence: "Invalided out of Navy service",
    });
    if (mit.newMargin < 0) {
      ch.history.push("Failed survival; invalided out of Navy service.");
      ch.activeDuty = false;
      return;
    }
  }
  const combatAssignments = data.combatAssignments ?? [];
  if (sv.margin === 0 && typeof res.survival === "number" &&
      combatAssignments.includes(assignment)) {
    ch.acgState!.decorations.push("Purple Heart");
    ch.history.push(`Wounded in ${assignment}; awarded Purple Heart.`);
    ch.acgState!.injuredThisYear = true;
  }

  if (res.decoration !== "none") {
    const dec = rollVsTarget(res.decoration, decDm);
    if (dec.margin >= 6) awardDecoration(ch, "SEH");
    else if (dec.margin >= 3) awardDecoration(ch, "MCG");
    else if (dec.margin >= 0) awardDecoration(ch, "MCUF");
    else if (dec.margin <= -6) runCourtMartial(ch, assignment);
  }

  if (res.promotion !== "none" &&
      !(ch.acgState!.isOfficer && res.promotionOfficersBarred) &&
      !(ch.acgState!.isOfficer && ch.acgState!.promotedThisTerm)) {
    const penalty = ch.acgState!.nextPromotionPenalty ?? 0;
    const effectiveDm = promoDm + penalty;
    if (penalty < 0) ch.acgState!.nextPromotionPenalty = 0;
    const pr = rollVsTarget(res.promotion, effectiveDm);
    if (pr.success) promoteNavy(ch);
  }

  if (res.skills !== "none") {
    const sk = rollVsTarget(res.skills, skillDm);
    if (sk.success) navyBranchSkillRoll(ch);
  }

  if (combatAssignments.includes(assignment)) {
    ch.acgState!.combatRibbons += 1;
    if (ch.acgState!.inCommand && ch.acgState!.isOfficer) {
      ch.acgState!.commandClusters += 1;
    }
  }

  ch.acgState!.assignmentHistory.push(assignment);
}

function promptDecorationDmTradeoff(ch: Character): void {
  ch.pickOrDefer({
    kind: "decorationDmTradeoff",
    label:
      "Take a -N DM on survival in exchange for +N on decoration? " +
      "(Negative survival ↔ positive decoration.)",
    options: ["-2 survival / +2 decoration", "-1 survival / +1 decoration",
      "No tradeoff", "+1 survival / -1 decoration", "+2 survival / -2 decoration"],
    onResolve: (c, choice) => {
      if (choice.startsWith("-2")) c.acgState!.decorationDmStrategy = -2;
      else if (choice.startsWith("-1")) c.acgState!.decorationDmStrategy = -1;
      else if (choice.startsWith("+1")) c.acgState!.decorationDmStrategy = 1;
      else if (choice.startsWith("+2")) c.acgState!.decorationDmStrategy = 2;
      else c.acgState!.decorationDmStrategy = 0;
    },
  });
}

function promoteNavy(ch: Character): void {
  const data = dataFor(ch);
  const fleet = ch.acgState!.fleet ?? "imperialNavy";
  const caps = data.rankCaps ?? { imperialNavy: 10, reserveFleet: 8, systemSquadron: 7 };
  const cap = caps[fleet as keyof typeof caps] ?? 10;

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
  // Roll on the Navy Special Assignments table (officer vs enlisted column),
  // then apply that school's effects from JSON-driven specialAssignmentDetails.
  const data = dataFor(ch);
  if (!data.specialAssignments) return;
  const dm = applyStructuredDms(data.specialAssignments.dms, ch);
  const r = Math.max(1, Math.min(7, roll(1) + dm));
  const row = data.specialAssignments.rows.find((row) => row.die === r);
  if (!row) return;
  const col = ch.acgState!.isOfficer ? "officer" : "enlisted";
  const assignment = String(row[col]);
  ch.acgState!.assignmentHistory.push(assignment);
  applySpecialAssignment(ch, "navy", assignment);
}

export function navyReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const fleet = ch.acgState!.fleet ?? "imperialNavy";
  const spec = data.reenlistment.perFleet?.[fleet];
  if (!spec) {
    // Legacy single-target form (kept for back-compat).
    const r = roll(2);
    if (r === 12) { ch.mandatoryReenlistment = true; return true; }
    return r >= (data.reenlistment.target ?? 6);
  }
  let dm = 0;
  const rankNum = parseInt(ch.acgState!.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  for (const d of spec.dms) {
    if (d.condition === "rankE4orAbove" && !ch.acgState!.isOfficer && rankNum >= 4) dm += d.dm;
    else if (d.condition === "officer" && ch.acgState!.isOfficer) dm += d.dm;
  }
  const r = roll(2);
  ch.verboseHistory(`Navy reenlist (${fleet}): ${r} + ${dm} vs ${spec.target}`);
  if (r === 12) { ch.mandatoryReenlistment = true; return true; }
  return r + dm >= spec.target;
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
