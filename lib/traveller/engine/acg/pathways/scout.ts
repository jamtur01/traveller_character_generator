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
  type StructuredDm,
} from "../tables";
import { tryMitigate } from "../browniePoints";
import { applyAcgSkillCell } from "./mercenary";
import { applyScoutSchool } from "../schools";
import { recordTransfer } from "../types";
import { event as ev } from "../../../history";

const PATHWAY = "scout";

interface ScoutData {
  enlistment: {
    target: number;
    dms: Array<{ attribute: string; min: number; dm: number }>;
    startingRank: string;
    collegeHonorsStartingRank?: string;
    automatic?: string;
    draft: { die: string; results: Record<string, string> };
  };
  officeAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  initialTraining?: Record<string, unknown>;
  dutyAssignment: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: Array<string | StructuredDm>;
  }>;
  schoolAssignment?: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
  };
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
  const schools = ch.acgState?.schoolsAttended ?? [];
  const honors = ch.acgState?.honorsGraduations ?? [];
  const hasCollege = schools.includes("college");
  const hasCollegeHonors = honors.includes("college");

  // PM p. 47 medical school direct commission: O3 carries into Scouts.
  // The pre-career rank is already set; just record division and exit.
  if (ch.acgState?.preCareerCommission &&
      ch.acgState.schoolsAttended.includes("medicalSchool")) {
    ch.acgState.isOfficer = true;
    ch.acgState.division = "bureaucracy";
    ch.log(ev.enlistmentAttempt(
      `Imperial Scout Service Medical Branch (medical school direct commission, ${ch.acgState.rankCode})`,
      0, 0, 0, true,
    ));
    scoutAssignOffice(ch);
    return;
  }

  // PM p. 56: college graduates auto-enlist; college honors graduates start
  // at IS-10 (not IS-1); college graduates go into the Bureaucracy, others
  // into the Field. Read pre-career state to honor these rules.
  if (hasCollege) {
    ch.log(ev.enlistmentAttempt("Imperial Scout Service (college graduate)", 0, 0, 0, true));
    ch.acgState!.rankCode = hasCollegeHonors
      ? (data.enlistment.collegeHonorsStartingRank ?? data.enlistment.startingRank)
      : data.enlistment.startingRank;
    ch.acgState!.isOfficer = false;
    ch.acgState!.division = "bureaucracy";
  } else {
    let dm = 0;
    for (const d of data.enlistment.dms) {
      const attr = d.attribute as keyof typeof ch.attributes;
      if (ch.attributes[attr] >= d.min) dm += d.dm;
    }
    const r = roll(2);
    const succeeded = r + dm >= data.enlistment.target;
    ch.log(ev.enlistmentAttempt("Imperial Scout Service", r, dm, data.enlistment.target, succeeded));
    if (succeeded) {
      ch.acgState!.rankCode = data.enlistment.startingRank;
      ch.acgState!.isOfficer = false;
    } else {
      const dr = roll(1);
      if (data.enlistment.draft.results[String(dr)] !== "Scouts") {
        throw new Error("Scout draft rejection — choose another path");
      }
      ch.drafted = true;
      ch.acgState!.rankCode = data.enlistment.startingRank;
      ch.log(ev.drafted("Scout Service"));
    }
    ch.acgState!.division = "field";
  }
  scoutAssignOffice(ch);
}

function scoutAssignOffice(ch: Character): void {
  const data = dataFor(ch);
  const division: "field" | "bureaucracy" = ch.acgState!.division ?? "field";
  ch.acgState!.division = division;
  const r = Math.max(2, Math.min(12, roll(2)));
  const row = data.officeAssignment.rows.find((row) => row.die === r);
  if (!row) { ch.acgState!.office = "Survey"; return; }
  const off = row[division];
  ch.acgState!.office = typeof off === "string" ? off : "Survey";
  // acgState.office + acgState.division are read by subsequent assignment rolls.
}

/** Scout initial training (PM p. 56): "The initial year of service in the
 *  Scouts is dedicated to initial training. The character consults the
 *  Initial Training table entry corresponding to his office assignment and
 *  receives the skill shown." */
export function scoutInitialTraining(ch: Character): void {
  const data = dataFor(ch);
  const office = ch.acgState!.office ?? "Survey";
  const skill = (data.initialTraining as Record<string, string> | undefined)?.[office];
  if (typeof skill === "string") {
    ch.addSkill(skill, 1, `Initial Training (${office})`);
  } else {
    throw new Error(
      `Scout Initial Training: no skill specified in data for office ` +
      `"${office}" (edition: ${ch.editionId}).`,
    );
  }
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
      applyAcgSkillCell(ch, v, `Scout ${division} ${col}`);
      return;
    }
  }
}

/** Scout administrators (IS-10..IS-18) may voluntarily apply DM +2 to the
 *  Duty Assignment roll (manual p. 57: "Scouts in the Bureaucracy who hold
 *  administrator rank are allowed a DM of +2 on the duty assignment table,
 *  which allows them to avoid some training (the DM is voluntary).
 *  However, a natural roll of 2 always means a war mission, regardless of
 *  the DM."). Auto-mode applies the DM; interactive mode asks the player. */
function isScoutAdministratorRank(rankCode: string): boolean {
  const m = rankCode.match(/^IS-(\d+)$/);
  if (!m) return false;
  return parseInt(m[1]!, 10) >= 10;
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
  const adminEligible = division === "bureaucracy" &&
    isScoutAdministratorRank(ch.acgState!.rankCode);
  // Default to taking the DM; interactive mode exposes the choice.
  let useAdminDm = adminEligible;
  if (adminEligible && ch.choiceMode === "interactive") {
    // Resolve synchronously by short-circuit: pickOrDefer auto-mode applies
    // immediately; interactive mode queues and we proceed without the DM
    // for this year (the player's decision applies next year).
    let decided = false;
    ch.pickOrDefer({
      kind: "scoutAdminDm",
      label: "Take administrator DM +2 on the duty roll? (Natural 2 still forces war mission.)",
      options: ["Take DM +2", "Roll without DM"],
      onResolve: (_c, choice) => {
        useAdminDm = choice === "Take DM +2";
        decided = true;
      },
    });
    if (!decided) useAdminDm = false;
  }
  const dm = useAdminDm ? 2 : 0;
  const baseRoll = roll(2);
  // Natural 2 always means war mission regardless of any DM.
  const dieKey = baseRoll === 2 ? 2 : Math.max(2, Math.min(12, baseRoll + dm));
  const row = data.dutyAssignment.rows.find((row) => row.die === dieKey);
  if (!row) return "Routine";
  const v = row[division];
  return typeof v === "string" ? v : "Routine";
}

export function scoutResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  // Transfer assignment (Field → Bureaucracy, per manual p. 56). The Scout
  // may decline; if declined, reroll once. If transfer is on the reroll, it
  // is mandatory. In auto mode we accept the transfer.
  if (assignment === "Transfer" && ch.acgState!.division === "field") {
    const accept = scoutDecideTransfer(ch, /*onReroll*/ false);
    if (accept) {
      applyScoutTransferToBureaucracy(ch);
      return;
    }
    // Declined → reroll once.
    const next = scoutRollAssignment(ch);
    if (next === "Transfer") {
      // Forced.
      applyScoutTransferToBureaucracy(ch);
      return;
    }
    scoutResolveAssignment(ch, next);
    return;
  }
  // Training assignment routes through the School Assignment table (PM
  // p. 57): "Individuals who receive training as an assignment are sent
  // to a service school."
  if (assignment === "Training" && data.schoolAssignment) {
    routeScoutToSchool(ch);
    ch.acgState!.assignmentHistory.push(assignment);
    return;
  }
  // Resolution sub-table keyed by office.
  const officeKey = labelToColumnKey(ch.acgState!.office ?? "Survey");
  const resTable = data.assignmentResolution[officeKey];
  if (!resTable) {
    throw new Error(
      `Scout: no resolution sub-table for office "${ch.acgState!.office}" ` +
      `(key "${officeKey}", edition: ${ch.editionId}).`,
    );
  }
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    throw new Error(
      `Scout: assignment "${assignment}" (col "${assignmentCol}") not in ` +
      `resolution columns for office "${ch.acgState!.office}" ` +
      `(available: ${resTable.columns.join(", ")}).`,
    );
  }
  const res = lookupResolution(resTable, assignment);
  const survDm = applyDmRules(resTable.dms, ch, "survival");
  const promoDm = applyDmRules(resTable.dms, ch, "promotion");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");

  const sv = rollVsTarget(res.survival, survDm);
  ch.log(ev.roll(
    "Survival", sv.roll, survDm,
    typeof res.survival === "number" ? res.survival : 0,
    sv.success, assignment,
  ));
  if (!sv.success) {
    const mit = tryMitigate(ch, {
      rollName: "survival",
      rollValue: sv.roll,
      dm: survDm,
      target: typeof res.survival === "number" ? res.survival : 0,
      margin: sv.margin,
      consequence: "Invalided out of Scout service",
      onMitigated: (c) => {
        c.resumeActive();
        c.log(ev.statusChange("revived", "BP spend saved Scout survival"));
      },
    });
    if (mit.newMargin < 0) {
      ch.endChargenRetired("invalided out of Scout service");
      return;
    }
  }

  // Bureaucracy → administrator rank ladder is climbed via promotion
  // throws. Field → no promotion possible. Per manual.
  const division = ch.acgState!.division ?? "field";
  if (division === "bureaucracy" && res.promotion !== "none" &&
      !(ch.acgState!.isOfficer && ch.acgState!.promotedThisTerm)) {
    const pr = rollVsTarget(res.promotion, promoDm);
    let promoMargin = pr.margin;
    if (!pr.success) {
      const target = typeof res.promotion === "number" ? res.promotion : 0;
      const mit = tryMitigate(ch, {
        rollName: "promotion",
        rollValue: pr.roll, dm: promoDm, target, margin: pr.margin,
        consequence: "Earn promotion (administrator ladder)",
      });
      promoMargin = mit.newMargin;
    }
    if (promoMargin >= 0) promoteScout(ch);
  }

  if (res.skills !== "none") {
    const sk = rollVsTarget(res.skills, skillDm);
    let skMargin = sk.margin;
    if (!sk.success) {
      const target = typeof res.skills === "number" ? res.skills : 0;
      const mit = tryMitigate(ch, {
        rollName: "skills",
        rollValue: sk.roll, dm: skillDm, target, margin: sk.margin,
        consequence: "Earn a skill this assignment",
      });
      skMargin = mit.newMargin;
    }
    if (skMargin >= 0) scoutRollSkill(ch);
  }

  // Special/War mission → extra skill from the dedicated column (PM p. 57:
  // "the extra training and preparation for the assignment results in an
  // extra skill taken from the special or war mission column").
  if (assignment === "Special Mission" || assignment === "Wartime Mission") {
    scoutRollSkillFromColumn(ch, "specialOrWarMission");
  }

  ch.acgState!.assignmentHistory.push(assignment);
}

function scoutRollSkillFromColumn(ch: Character, column: string): void {
  const data = dataFor(ch);
  const division = ch.acgState!.division ?? "field";
  const table = data.skillTables[division];
  if (!table.columns.includes(column)) {
    // Fallback to the office's normal column if the manual column isn't
    // present in JSON (defensive).
    scoutRollSkill(ch);
    return;
  }
  const r = roll(1);
  const row = table.rows.find((row) => row.die === r);
  if (!row) return;
  const v = row[column];
  if (typeof v === "string") applyAcgSkillCell(ch, v, `Scout ${column}`);
}

function routeScoutToSchool(ch: Character): void {
  const data = dataFor(ch);
  if (!data.schoolAssignment) return;
  const officeKey = labelToColumnKey(ch.acgState!.office ?? "Survey");
  const r = roll(1);
  const row = data.schoolAssignment.rows.find((row) => row.die === r);
  if (!row) return;
  const school = row[officeKey];
  if (typeof school !== "string") return;
  // applyScoutSchool emits ev.schoolAssigned for the school itself.
  applyScoutSchool(ch, school);
}

function scoutDecideTransfer(ch: Character, onReroll: boolean): boolean {
  if (onReroll) return true; // mandatory on reroll
  if (ch.choiceMode !== "interactive") return true; // auto accepts
  let accept = true;
  let decided = false;
  ch.pickOrDefer({
    kind: "scoutTransferDecline",
    label: "Accept transfer from Field to Bureaucracy? (Mandatory on reroll if declined.)",
    options: ["Accept transfer", "Decline (reroll once)"],
    onResolve: (_c, choice) => {
      accept = choice === "Accept transfer";
      decided = true;
    },
  });
  if (!decided) accept = true;
  return accept;
}

function applyScoutTransferToBureaucracy(ch: Character): void {
  const data = dataFor(ch);
  const fromDivision = ch.acgState!.division ?? "field";
  recordTransfer(ch.acgState!, "division", fromDivision, "bureaucracy",
    ch.acgState!.yearsServed ?? 0);
  const fromOffice = ch.acgState!.office ?? "";
  ch.acgState!.division = "bureaucracy";
  // Reroll office assignment under the Bureaucracy division.
  const r = Math.max(2, Math.min(12, roll(2)));
  const row = data.officeAssignment.rows.find((row) => row.die === r);
  const off = row?.bureaucracy;
  const newOffice = typeof off === "string" ? off : "Technical";
  recordTransfer(ch.acgState!, "office", fromOffice, newOffice,
    ch.acgState!.yearsServed ?? 0);
  ch.acgState!.office = newOffice;
  // Bureaucracy has rank; ordinary rank becomes terms served.
  const termsServed = Math.max(1, ch.terms);
  ch.acgState!.rankCode = `IS-${Math.min(9, termsServed)}`;
  ch.log(ev.transferred("Scout Bureaucracy", "division", fromDivision));
  // Resolve a fresh assignment in the new division.
  const nextAssign = scoutRollAssignment(ch);
  if (nextAssign !== "Transfer") {
    scoutResolveAssignment(ch, nextAssign);
  }
}

function promoteScout(ch: Character): void {
  const data = dataFor(ch);
  // Ordinary rank can climb to IS-9; beyond that requires admin school.
  // Per PM p. 57: "Each time a promotion is received, the individual is
  // allowed to receive one new skill. Ordinary rank allows a skill from the
  // appropriate office column or the scout life column; administrator rank
  // allows a skill from the administrator rank column."
  if (!ch.acgState!.isOfficer) {
    const codes = data.ranks.ordinary.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.log(ev.promoted(data.ranks.ordinary[idx + 1]![1]));
      // Ordinary promotion: one skill from office column or scout life.
      scoutRollSkill(ch);
    }
  } else {
    const codes = data.ranks.administrator.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.acgState!.promotedThisTerm = true;
      ch.log(ev.promoted(data.ranks.administrator[idx + 1]![1]));
      // Administrator promotion: one skill from administrator rank column.
      scoutRollSkillFromColumn(ch, "administratorRank");
    }
  }
}

/** Detached Duty benefit at muster (PM p. 57): "Any scout who is serving
 *  in the Detached Duty division when he leaves the service is given
 *  permanent detached duty on a roll of 9+ (DM + number of terms served).
 *  Although the assignment has no responsibilities, the individual receives
 *  a scout/courier (if he has not already received one through mustering
 *  out) and a stipend ... of Cr4000 per year." */
export function scoutFinalizeMuster(ch: Character): void {
  if (!ch.acgState) return;
  if (ch.acgState.office !== "Detached Duty") return;
  const r = roll(2);
  const dm = ch.terms;
  const succeeded = r + dm >= 9;
  ch.log(ev.roll("Detached Duty", r, dm, 9, succeeded));
  if (!succeeded) return;
  ch.log(ev.decoration("Permanent Detached Duty", "PM p. 57"));
  const hasScout = ch.benefits.some((b) => /scout|courier/i.test(b));
  if (!hasScout) {
    ch.log(ev.raw("Scout/Courier (Detached Duty)", "simple"));
    ch.addBenefit("Scout/Courier (Detached Duty)");
  }
  ch.retirementPay = (ch.retirementPay ?? 0) + 4000;
  ch.log(ev.raw("Cr4,000/yr Detached Duty stipend", "simple"));
  ch.addBenefit("Cr4,000/yr Detached Duty stipend");
}

/** Retention is Navy-only in MT. Kept as a no-op for back-compat. */
export function scoutRetention(ch: Character, _assignment: string): void {
  if (ch.acgState) {
    ch.acgState.justRetained = false;
    ch.acgState.retainedAssignment = null;
  }
}

export function scoutReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  // Up-or-out: ordinary rank must be ≥ terms served.
  const rankNum = parseInt(ch.acgState!.rankCode.replace("IS-", ""), 10) || 0;
  if (!ch.acgState!.isOfficer && rankNum < ch.terms) {
    ch.acgState!.reenlistDenialReason = "up-or-out: insufficient rank";
    return false;
  }
  const r = roll(2);
  const target = data.reenlistment.target;
  const succeeded = r === 12 || r >= target;
  ch.log(ev.roll("Reenlistment", r, 0, target, succeeded, "scout"));
  if (r === 12) {
    ch.enterMandatoryReenlist();
    return true;
  }
  return r >= target;
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
