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
import { numCommaSep } from "../../../formatting";
import {
  applyDmRules, labelToColumnKey, lookupResolution,
  type StructuredDm,
} from "../tables";
import { applyAcgSkillCell } from "../skills";
import { applyScoutSchool } from "../schools";
import { runPhases, type PathwaySpec } from "../phaseRunner";
import { type PathwayCallbacks } from "../jsonPhases";
import { createPathwaySpecRegistry, advanceRankRow } from "./shared";
import { recordTransfer } from "../state";
import { event as ev } from "../../../history";

const PATHWAY = "scout";

export interface ScoutData {
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
  reenlistment: { target: number };
  detachedDuty: { musterTarget: number; stipendPerYear: number };
}

function dataFor(ch: Character): ScoutData {
  const data = getEdition(ch.editionId).data.advancedCharacterGeneration?.scout;
  if (!data) throw new Error("Scout pathway requires ACG data");
  return data;
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
    ch.requireAcgState().rankCode = hasCollegeHonors
      ? (data.enlistment.collegeHonorsStartingRank ?? data.enlistment.startingRank)
      : data.enlistment.startingRank;
    ch.requireAcgState().isOfficer = false;
    ch.requireAcgState().division = "bureaucracy";
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
      ch.requireAcgState().rankCode = data.enlistment.startingRank;
      ch.requireAcgState().isOfficer = false;
    } else {
      const dr = roll(1);
      if (data.enlistment.draft.results[String(dr)] !== "Scouts") {
        throw new Error("Scout draft rejection — choose another path");
      }
      ch.drafted = true;
      ch.requireAcgState().rankCode = data.enlistment.startingRank;
      ch.log(ev.drafted("Scout Service"));
    }
    ch.requireAcgState().division = "field";
  }
  scoutAssignOffice(ch);
}

function scoutAssignOffice(ch: Character): void {
  const data = dataFor(ch);
  const division: "field" | "bureaucracy" = ch.requireAcgState().division ?? "field";
  ch.requireAcgState().division = division;
  const r = Math.max(2, Math.min(12, roll(2)));
  const row = data.officeAssignment.rows.find((row) => row.die === r);
  if (!row) { ch.requireAcgState().office = "Survey"; return; }
  const off = row[division];
  ch.requireAcgState().office = typeof off === "string" ? off : "Survey";
  // acgState.office + acgState.division are read by subsequent assignment rolls.
}

/** Scout initial training (PM p. 56): "The initial year of service in the
 *  Scouts is dedicated to initial training. The character consults the
 *  Initial Training table entry corresponding to his office assignment and
 *  receives the skill shown." */
export function scoutInitialTraining(ch: Character): void {
  const data = dataFor(ch);
  const office = ch.requireAcgState().office ?? "Survey";
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
  const division = ch.requireAcgState().division ?? "field";
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

/** Parse the numeric part of a scout rank code ("IS-10" → 10); NaN if the
 *  code is not an IS-rank. Ordinary ranks and the administrator floor are
 *  compared against the ranks ladders in JSON rather than hardcoded. */
function scoutRankNum(rankCode: string): number {
  const m = rankCode.match(/^IS-(\d+)$/);
  return m ? parseInt(m[1]!, 10) : NaN;
}

export function scoutRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  if (acg.justRetained && acg.retainedAssignment) {
    const retained = acg.retainedAssignment;
    acg.justRetained = false;
    acg.retainedAssignment = null;
    return retained;
  }
  const division = ch.requireAcgState().division ?? "field";
  // PM p. 57: administrators (rank ≥ the administrator floor) in the
  // Bureaucracy may voluntarily take a +DM on the duty roll. Both the
  // eligible-rank floor and the DM value come from JSON (the administrator
  // ladder and the dutyAssignment.dms rankAtLeast gate). A natural 2 always
  // forces a war mission regardless of the DM.
  const adminMin = Math.min(
    ...data.ranks.administrator.map((r) => scoutRankNum(String(r[0]))),
  );
  const adminDm = data.dutyAssignment.dms?.find((d) => d.rankAtLeast !== undefined)?.dm ?? 0;
  const rankNum = scoutRankNum(ch.requireAcgState().rankCode);
  const adminEligible = division === "bureaucracy" &&
    !Number.isNaN(rankNum) && rankNum >= adminMin;
  // Default to taking the DM; interactive mode exposes the choice.
  let useAdminDm = adminEligible;
  if (adminEligible && ch.choiceMode === "interactive") {
    const acg = ch.requireAcgState();
    const takeLabel = `Take DM +${adminDm}`;
    if (acg.scoutAdminDmDecision !== undefined) {
      // Resume case — decision was made in the previous pause/resume
      // cycle. Consume it.
      useAdminDm = acg.scoutAdminDmDecision;
      delete acg.scoutAdminDmDecision;
    } else {
      // First visit: queue the choice. pickOrDefer throws in interactive
      // mode, so the line after this call is unreachable; the decision
      // is captured on acgState so the resumed call reads it above.
      ch.pickOrDefer({
        kind: "scoutAdminDm",
        label: `Take administrator DM +${adminDm} on the duty roll? (Natural 2 still forces war mission.)`,
        options: [takeLabel, "Roll without DM"],
        onResolve: (c, choice) => {
          c.requireAcgState().scoutAdminDmDecision = choice === takeLabel;
        },
      });
    }
  }
  const dm = useAdminDm ? adminDm : 0;
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
  if (assignment === "Transfer" && ch.requireAcgState().division === "field") {
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
    ch.requireAcgState().assignmentHistory.push(assignment);
    return;
  }
  // Resolution sub-table keyed by office.
  const officeKey = labelToColumnKey(ch.requireAcgState().office ?? "Survey");
  const resTable = data.assignmentResolution[officeKey];
  if (!resTable) {
    throw new Error(
      `Scout: no resolution sub-table for office "${ch.requireAcgState().office}" ` +
      `(key "${officeKey}", edition: ${ch.editionId}).`,
    );
  }
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    throw new Error(
      `Scout: assignment "${assignment}" (col "${assignmentCol}") not in ` +
      `resolution columns for office "${ch.requireAcgState().office}" ` +
      `(available: ${resTable.columns.join(", ")}).`,
    );
  }
  const res = lookupResolution(resTable, assignment);
  // Scout has no decoration phase per PM p. 59 — the resolution tables
  // omit a Decoration row. (The p. 65 checklist's "c) Decoration" entry
  // is template-copied from other pathways; the actual data tables are
  // authoritative.) No `dms.decoration` is needed here.
  const dms = {
    survival: applyDmRules(resTable.dms, ch, "survival"),
    promotion: applyDmRules(resTable.dms, ch, "promotion"),
    skills: applyDmRules(resTable.dms, ch, "skills"),
  };
  runPhases(getScoutSpec(ch), { ch, assignment, resTable, res, dms });
}

const SCOUT_CALLBACKS: PathwayCallbacks = {
  promoteScout: (ctx) => promoteScout(ctx.ch),
  scoutRollSkill: (ctx) => scoutRollSkill(ctx.ch),
  scoutFinalize: (ctx) => {
    // Special/War mission → extra skill from the dedicated column (PM
    // p. 57): "the extra training and preparation for the assignment
    // results in an extra skill".
    if (ctx.assignment === "Special Mission" || ctx.assignment === "Wartime Mission") {
      scoutRollSkillFromColumn(ctx.ch, "specialOrWarMission");
    }
    ctx.ch.requireAcgState().assignmentHistory.push(ctx.assignment);
  },
};

const REGISTRY = createPathwaySpecRegistry<ScoutData>({
  pathwayKey: "scout",
  callbacks: SCOUT_CALLBACKS,
  combatAssignments: () => [],
});
export const clearScoutSpecCache = REGISTRY.clear;
export const validateScoutConfig = REGISTRY.validate;
function getScoutSpec(ch: Character): PathwaySpec { return REGISTRY.get(ch); }

function scoutRollSkillFromColumn(ch: Character, column: string): void {
  const data = dataFor(ch);
  const division = ch.requireAcgState().division ?? "field";
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
  const officeKey = labelToColumnKey(ch.requireAcgState().office ?? "Survey");
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
  const acg = ch.requireAcgState();
  if (acg.scoutTransferDecision !== undefined) {
    // Resume case — decision made in prior pause/resume cycle.
    const accept = acg.scoutTransferDecision;
    delete acg.scoutTransferDecision;
    return accept;
  }
  // First visit: queue the choice. pickOrDefer throws in interactive
  // mode; the return below is dead code there. The decision is
  // captured on acgState so the resumed call reads it above.
  ch.pickOrDefer({
    kind: "scoutTransferDecline",
    label: "Accept transfer from Field to Bureaucracy? (Mandatory on reroll if declined.)",
    options: ["Accept transfer", "Decline (reroll once)"],
    onResolve: (c, choice) => {
      c.requireAcgState().scoutTransferDecision = choice === "Accept transfer";
    },
  });
  return true; // unreachable in interactive mode (pickOrDefer threw)
}

function applyScoutTransferToBureaucracy(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireAcgState();
  // Idempotency guard: if the recursive scoutResolveAssignment below
  // pauses on an interactive choice, the runner re-invokes the outer
  // resolveAssignment with assignment="Transfer" on resume. Without this
  // marker the transfer side effects (rank change, division change,
  // recordTransfer, office reroll) would re-apply on every resume.
  if (!acg.transferAppliedThisYear) {
    acg.transferAppliedThisYear = true;
    const fromDivision = acg.division ?? "field";
    recordTransfer(acg, "division", fromDivision, "bureaucracy",
      acg.yearsServed ?? 0);
    const fromOffice = acg.office ?? "";
    acg.division = "bureaucracy";
    // Reroll office assignment under the Bureaucracy division.
    const r = Math.max(2, Math.min(12, roll(2)));
    const row = data.officeAssignment.rows.find((row) => row.die === r);
    const off = row?.bureaucracy;
    const newOffice = typeof off === "string" ? off : "Technical";
    recordTransfer(acg, "office", fromOffice, newOffice,
      acg.yearsServed ?? 0);
    acg.office = newOffice;
    // Bureaucracy has rank; ordinary rank becomes terms served, capped at
    // the top ordinary rank defined in JSON (PM p. 57: IS-9).
    const termsServed = Math.max(1, ch.terms);
    const ordinaryMax = Math.max(...data.ranks.ordinary.map((r) => scoutRankNum(String(r[0]))));
    acg.rankCode = `IS-${Math.min(ordinaryMax, termsServed)}`;
    ch.log(ev.transferred("Scout Bureaucracy", "division", fromDivision));
  }
  // Resolve a fresh assignment in the new division. Cache the rolled
  // assignment so a pause inside the recursive resolve doesn't re-roll
  // (non-deterministically) on resume.
  if (acg.scoutTransferNextAssign === undefined) {
    acg.scoutTransferNextAssign = scoutRollAssignment(ch);
  }
  const nextAssign = acg.scoutTransferNextAssign;
  if (nextAssign !== "Transfer") {
    scoutResolveAssignment(ch, nextAssign);
  }
}

function promoteScout(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireAcgState();
  // PM p. 57: each promotion grants one skill — the office/scout-life
  // column for ordinary rank, the administrator column for administrator
  // rank (a separate ladder). Ordinary caps at IS-9; higher requires
  // administrator school.
  const ladder = acg.isOfficer ? data.ranks.administrator : data.ranks.ordinary;
  const next = advanceRankRow(ladder, acg.rankCode);
  if (!next) return;
  acg.rankCode = next[0];
  ch.log(ev.promoted(next[1]));
  if (acg.isOfficer) {
    acg.promotedThisTerm = true;
    scoutRollSkillFromColumn(ch, "administratorRank");
  } else {
    scoutRollSkill(ch);
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
  const { musterTarget, stipendPerYear } = dataFor(ch).detachedDuty;
  const r = roll(2);
  const dm = ch.terms;
  const succeeded = r + dm >= musterTarget;
  ch.log(ev.roll("Detached Duty", r, dm, musterTarget, succeeded));
  if (!succeeded) return;
  ch.log(ev.decoration("Permanent Detached Duty", "PM p. 57"));
  const hasScout = ch.benefits.some((b) => /scout|courier/i.test(b));
  if (!hasScout) {
    ch.log(ev.raw("Scout/Courier (Detached Duty)", "simple"));
    ch.addBenefit("Scout/Courier (Detached Duty)");
  }
  ch.retirementPay = (ch.retirementPay ?? 0) + stipendPerYear;
  const stipendLabel = `Cr${numCommaSep(stipendPerYear)}/yr Detached Duty stipend`;
  ch.log(ev.raw(stipendLabel, "simple"));
  ch.addBenefit(stipendLabel);
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
  const rankNum = parseInt(ch.requireAcgState().rankCode.replace("IS-", ""), 10) || 0;
  if (!ch.requireAcgState().isOfficer && rankNum < ch.terms) {
    ch.requireAcgState().reenlistDenialReason = "up-or-out: insufficient rank";
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
