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

import type { Character } from "@/lib/traveller/character";
import { getAcgPathway } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import { numCommaSep } from "@/lib/traveller/formatting";
import {
  applyDmRules, labelToColumnKey, lookupResolution,
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import { applyScoutSchool } from "@/lib/traveller/engine/acg/schools";
import { runPhases, type PathwaySpec } from "@/lib/traveller/engine/acg/phaseRunner";
import {
  createPathwaySpecRegistry, runReenlist,
  clearRetention, consumeRetainedAssignment, rollDieRow,
  EnlistmentValidationError,
} from "./shared";
import { event as ev } from "@/lib/traveller/history";
import { rankNum } from "@/lib/traveller/engine/predicate";
import { evaluateDM } from "@/lib/traveller/engine/dmEvaluator";

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
    /** PM p. 57: this natural roll always forces a wartime mission,
     *  regardless of any DM taken. */
    forcedMissionOnNatural?: number;
  };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  }>;
  /** PM p. 56: which division (field/bureaucracy) each entry route joins. */
  divisionPlacement?: {
    collegeGraduate: "field" | "bureaucracy";
    medSchoolCommission: "field" | "bureaucracy";
    default: "field" | "bureaucracy";
  };
  /** PM p. 57: which column the Special/War-Mission extra skill rolls on,
   *  per division; null = the division's normal office column. */
  specialWarMissionSkill?: {
    columnByDivision: Record<string, string | null>;
  };
  schoolAssignment?: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
  };
  schools?: { columns: string[]; rows: Array<Record<string, unknown>> };
  skillTables: { field: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] }; bureaucracy: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] } };
  ranks: { ordinary: Array<[string, string]>; administrator: Array<[string, string, number]> };
  reenlistment: {
    target: number;
    /** PM p. 57 up-or-out gate: when enlistedRankMinPerTerm is set, an
     *  ordinary-rank scout whose rank number is below terms served is
     *  denied reenlistment. */
    upOrOut?: { enlistedRankMinPerTerm?: boolean };
  };
  detachedDuty: { musterTarget: number; stipendPerYear: number };
}

function dataFor(ch: Character): ScoutData {
  const data = getAcgPathway(ch.editionId, "scout");
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
  // The pre-career rank is already set; record the JSON-declared division
  // (PM p. 56: the commission joins the Bureaucracy) and exit.
  if (ch.acgState?.preCareerCommission &&
      ch.acgState.schoolsAttended.includes("medicalSchool")) {
    ch.acgState.isOfficer = true;
    ch.requireScoutAcg().division = requireRule(
      data.divisionPlacement?.medSchoolCommission,
      "acg.scout.divisionPlacement.medSchoolCommission", "PM p. 56",
    );
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
  const acg = ch.requireAcgState();
  if (hasCollege) {
    ch.log(ev.enlistmentAttempt("Imperial Scout Service (college graduate)", 0, 0, 0, true));
    acg.rankCode = hasCollegeHonors
      ? requireRule(
          data.enlistment.collegeHonorsStartingRank,
          "acg.scout.enlistment.collegeHonorsStartingRank", "PM p. 56",
        )
      : data.enlistment.startingRank;
    acg.isOfficer = false;
    ch.requireScoutAcg().division = requireRule(
      data.divisionPlacement?.collegeGraduate,
      "acg.scout.divisionPlacement.collegeGraduate", "PM p. 56",
    );
  } else {
    const dm = evaluateDM(data.enlistment.dms, { attributes: ch.attributes, terms: ch.terms });
    const r = ch.rng.roll(2);
    const succeeded = r + dm >= data.enlistment.target;
    ch.log(ev.enlistmentAttempt("Imperial Scout Service", r, dm, data.enlistment.target, succeeded));
    if (succeeded) {
      acg.rankCode = data.enlistment.startingRank;
      acg.isOfficer = false;
    } else {
      const dr = ch.rng.roll(1);
      if (data.enlistment.draft.results[String(dr)] !== "Scouts") {
        throw new EnlistmentValidationError("Scout draft rejection — choose another path");
      }
      ch.drafted = true;
      acg.rankCode = data.enlistment.startingRank;
      ch.log(ev.drafted("Scout Service"));
    }
    ch.requireScoutAcg().division = requireRule(
      data.divisionPlacement?.default,
      "acg.scout.divisionPlacement.default", "PM p. 56",
    );
  }
  scoutAssignOffice(ch);
}

function scoutAssignOffice(ch: Character): void {
  const data = dataFor(ch);
  const division: "field" | "bureaucracy" = ch.requireScoutAcg().division;
  const row = rollDieRow(ch, data.officeAssignment, { dice: 2, dm: 0, lo: 2, hi: 12 });
  const off = row?.[division];
  if (typeof off !== "string") {
    throw new Error(
      `Scout officeAssignment table has no "${division}" cell for the ` +
      `rolled row (edition: ${ch.editionId}) — fix the edition JSON`,
    );
  }
  ch.requireScoutAcg().office = off;
  // acgState.office + acgState.division are read by subsequent assignment rolls.
}

/** The character's office assignment. scoutAssignOffice always sets it at
 *  enlistment; a null office means an office-keyed read ran before
 *  enlistment — fail loudly instead of silently defaulting to Survey. */
function scoutOfficeOf(ch: Character): string {
  const office = ch.requireScoutAcg().office;
  if (!office) {
    throw new Error(
      "Scout office is unset — enlistment must assign an office before " +
      "office-keyed rolls (PM p. 56)",
    );
  }
  return office;
}

/** Scout initial training (PM p. 56): "The initial year of service in the
 *  Scouts is dedicated to initial training. The character consults the
 *  Initial Training table entry corresponding to his office assignment and
 *  receives the skill shown." */
export function scoutInitialTraining(ch: Character): void {
  const data = dataFor(ch);
  const office = scoutOfficeOf(ch);
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

export function scoutRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  const retained = consumeRetainedAssignment(acg);
  if (retained) return retained;
  const division = ch.requireScoutAcg().division;
  // PM p. 57: administrators (rank ≥ the administrator floor) in the
  // Bureaucracy may voluntarily take a +DM on the duty roll. The
  // eligible-rank floor, the DM value, and the forced-mission natural
  // all come from JSON (the administrator ladder, the dutyAssignment.dms
  // rankAtLeast gate, and dutyAssignment.forcedMissionOnNatural).
  const adminMin = Math.min(
    ...data.ranks.administrator.map((r) => rankNum(String(r[0]))),
  );
  const adminDm = data.dutyAssignment.dms?.find((d) => d.rankAtLeast !== undefined)?.dm ?? 0;
  const rank = rankNum(acg.rankCode);
  const adminEligible = division === "bureaucracy" && rank >= adminMin;
  // Default to taking the DM; interactive mode exposes the choice. The
  // decision cursor runs onResolve inline, so the closure over the local
  // is applied before the roll below; on the frontier (unrecorded) case
  // pickOrDefer throws and the whole action re-executes with the pick.
  let useAdminDm = adminEligible;
  if (adminEligible && ch.choiceMode === "interactive") {
    const takeLabel = `Take DM +${adminDm}`;
    ch.pickOrDefer({
      kind: "scoutAdminDm",
      label: `Take administrator DM +${adminDm} on the duty roll? (Natural 2 still forces war mission.)`,
      options: [takeLabel, "Roll without DM"],
      onResolve: (_ch, choice) => {
        useAdminDm = choice === takeLabel;
      },
    });
  }
  const dm = useAdminDm ? adminDm : 0;
  const baseRoll = ch.rng.roll(2);
  // The forced-mission natural (PM p. 57: 2) bypasses any DM.
  const forced = data.dutyAssignment.forcedMissionOnNatural;
  const dieKey = (forced !== undefined && baseRoll === forced)
    ? forced : Math.max(2, Math.min(12, baseRoll + dm));
  const row = data.dutyAssignment.rows.find((row) => row.die === dieKey);
  const v = row?.[division];
  if (typeof v !== "string") {
    throw new Error(
      `Scout dutyAssignment table has no "${division}" cell for die=${dieKey} ` +
      `(edition: ${ch.editionId}) — fix the edition JSON`,
    );
  }
  return v;
}

export function scoutResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  // Transfer assignment (Field → Bureaucracy, per manual p. 56). The Scout
  // may decline; if declined, reroll once. If transfer is on the reroll, it
  // is mandatory. In auto mode we accept the transfer.
  if (assignment === "Transfer" && ch.requireScoutAcg().division === "field") {
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
  const officeKey = labelToColumnKey(scoutOfficeOf(ch));
  const resTable = data.assignmentResolution[officeKey];
  if (!resTable) {
    throw new Error(
      `Scout: no resolution sub-table for office "${ch.requireScoutAcg().office}" ` +
      `(key "${officeKey}", edition: ${ch.editionId}).`,
    );
  }
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    throw new Error(
      `Scout: assignment "${assignment}" (col "${assignmentCol}") not in ` +
      `resolution columns for office "${ch.requireScoutAcg().office}" ` +
      `(available: ${resTable.columns.join(", ")}).`,
    );
  }
  const res = lookupResolution(resTable, assignment);
  // Scout has no decoration phase per PM p. 59 — the resolution tables
  // omit a Decoration row. (The p. 65 checklist's "ch) Decoration" entry
  // is template-copied from other pathways; the actual data tables are
  // authoritative.) No `dms.decoration` is needed here.
  const dms = {
    survival: applyDmRules(resTable.dms, ch, "survival"),
    promotion: applyDmRules(resTable.dms, ch, "promotion"),
    skills: applyDmRules(resTable.dms, ch, "skills"),
  };
  runPhases(getScoutSpec(ch), { ch, assignment, resTable, res, dms });
}

const REGISTRY = createPathwaySpecRegistry<ScoutData>({
  pathwayKey: "scout",
  combatAssignments: () => [],
});
export const validateScoutConfig = REGISTRY.validate;
function getScoutSpec(ch: Character): PathwaySpec { return REGISTRY.get(ch); }

function routeScoutToSchool(ch: Character): void {
  const data = dataFor(ch);
  if (!data.schoolAssignment) return;
  const officeKey = labelToColumnKey(scoutOfficeOf(ch));
  const row = rollDieRow(ch, data.schoolAssignment, { dice: 1, dm: 0 });
  if (!row) return;
  const school = row[officeKey];
  if (typeof school !== "string") return;
  // applyScoutSchool emits ev.schoolAssigned for the school itself.
  applyScoutSchool(ch, school);
}

function scoutDecideTransfer(ch: Character, onReroll: boolean): boolean {
  if (onReroll) return true; // mandatory on reroll
  if (ch.choiceMode !== "interactive") return true; // auto accepts
  // The decision cursor runs onResolve inline, so the closure over the
  // local applies before the return; on the frontier (unrecorded) case
  // pickOrDefer throws and the whole action re-executes with the pick.
  let accept = true;
  ch.pickOrDefer({
    kind: "scoutTransferDecline",
    label: "Accept transfer from Field to Bureaucracy? (Mandatory on reroll if declined.)",
    options: ["Accept transfer", "Decline (reroll once)"],
    onResolve: (_ch, choice) => {
      accept = choice === "Accept transfer";
    },
  });
  return accept;
}

function applyScoutTransferToBureaucracy(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireScoutAcg();
  const fromDivision = acg.division;
  acg.division = "bureaucracy";
  // Reroll office assignment under the Bureaucracy division.
  const row = rollDieRow(ch, data.officeAssignment, { dice: 2, dm: 0, lo: 2, hi: 12 });
  const off = row?.bureaucracy;
  if (typeof off !== "string") {
    throw new Error(
      `Scout officeAssignment table has no "bureaucracy" cell for the ` +
      `rolled row (edition: ${ch.editionId}) — fix the edition JSON`,
    );
  }
  acg.office = off;
  // Bureaucracy has rank; ordinary rank becomes terms served, capped at
  // the top ordinary rank defined in JSON (PM p. 57: IS-9).
  const termsServed = Math.max(1, ch.terms);
  const ordinaryMax = Math.max(...data.ranks.ordinary.map((r) => rankNum(String(r[0]))));
  acg.rankCode = `IS-${Math.min(ordinaryMax, termsServed)}`;
  ch.log(ev.transferred("Scout Bureaucracy", "division", fromDivision));
  // Resolve a fresh assignment in the new division.
  const nextAssign = scoutRollAssignment(ch);
  if (nextAssign !== "Transfer") {
    scoutResolveAssignment(ch, nextAssign);
  }
}

/** Detached Duty benefit at muster (PM p. 57): "Any scout who is serving
 *  in the Detached Duty division when he leaves the service is given
 *  permanent detached duty on a roll of 9+ (DM + number of terms served).
 *  Although the assignment has no responsibilities, the individual receives
 *  a scout/courier (if he has not already received one through mustering
 *  out) and a stipend ... of Cr4000 per year." */
export function scoutFinalizeMuster(ch: Character): void {
  const acg = ch.acgState;
  if (acg?.pathway !== "scout" || acg.office !== "Detached Duty") return;
  const { musterTarget, stipendPerYear } = dataFor(ch).detachedDuty;
  const r = ch.rng.roll(2);
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

export function scoutReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  // Up-or-out (PM p. 57): ordinary rank must be ≥ terms served. The gate
  // is declared in scout.reenlistment.upOrOut.
  const acg = ch.requireAcgState();
  if (data.reenlistment.upOrOut?.enlistedRankMinPerTerm === true &&
      !acg.isOfficer && rankNum(acg.rankCode) < ch.terms) {
    acg.reenlistDenialReason = "up-or-out: insufficient rank";
    return false;
  }
  return runReenlist(ch, {
    target: data.reenlistment.target,
    label: "scout",
    onContinue: () => {},
  });
}

export function getScoutPathway() {
  return {
    pathway: PATHWAY,
    enlist: scoutEnlist,
    initialTraining: scoutInitialTraining,
    rollAssignment: scoutRollAssignment,
    resolveAssignment: scoutResolveAssignment,
    retention: clearRetention,
    reenlist: scoutReenlist,
  };
}
