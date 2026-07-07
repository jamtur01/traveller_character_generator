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

import type { Character } from "@/lib/traveller/character";
import { getEdition, getAcgPathway } from "@/lib/traveller/editions";
import {
  applyStructuredDms, labelToColumnKey, lookupResolution,
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import { applySpecialAssignment } from "@/lib/traveller/engine/acg/schools";
import { runPhases, type PathwaySpec } from "@/lib/traveller/engine/acg/phaseRunner";
import {
  createPathwaySpecRegistry, resetCombatTermFlags,
  combatResolutionDms, rollSpecialAssignment, runReenlist, offerRoleChange,
  consumeRetainedAssignment, rollDieRowOrThrow, rollSkillFromColumn,
  rollDieRow, resolveCommandDuty, branchSkillCandidates, EnlistmentValidationError,
  type SkillColumnPolicy,
} from "./shared";
import { requireRule } from "@/lib/traveller/editions/strict";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import { event as ev } from "@/lib/traveller/history";
import { evaluateDM } from "@/lib/traveller/engine/dmEvaluator";

const PATHWAY = "navy";

export interface NavyData {
  enlistment: {
    imperialNavy: { target: number; dms: Array<{ attribute: string; min: number; dm: number }> };
    reserveFleet: { target: number; dms: Array<{ attribute: string; min: number; dm: number }> };
    systemSquadron: {
      target: number;
      dms: Array<{ attribute: string; min: number; dm: number }>;
      requirement: string;
      /** PM p. 52: minimum homeworld tech code for System Squadron entry. */
      techMinimum?: string;
    };
    startingRank: string;
    /** PM p. 52: the subsector tech code floor (homeworld tech, at minimum
     *  this value). Read by beginAcg when recording subsectorTechCode. */
    subsectorTechMinimum?: string;
    draft: { die: string; results: Record<string, string> };
    academyRanks?: Record<string, string>;
  };
  branchAssignment: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  branchResolution?: Record<string, string>;
  branches?: string[];
  /** Social standing at/above which a character may CHOOSE their branch
   *  interactively instead of rolling (PM p. 52). */
  branchChoiceSocialMin: number;
  branchFleetRestrictions?: Record<string, string[]>;
  preCareerFleetAssignment?: {
    bySchool?: Record<string, { fleet?: string; branch?: string }>;
    byPreCareerBranch?: Record<string, { fleet?: string; branch?: string }>;
  };
  ocsAdvancement?: {
    tiers?: Array<{ fromRanks?: string[]; toRank: string; skipsSkills?: boolean }>;
    defaultToRank?: string;
    ageLimit?: number;
  };
  initialTraining?: { rolls?: number; enlisted?: string; officer?: string };
  commandDuty: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  assignment: {
    columns: string[];
    rows: Array<Record<string, number | string>>;
    dms?: StructuredDm[];
  };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
    notes?: string[];
  }>;
  /** PM p. 53: retention throw — roll `die`D; at/above `target` the next
   *  assignment repeats the previous one. */
  retention?: { throw?: { die: number; target: number }; rule?: string };
  specialAssignments?: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  specialAssignmentDetails?: Record<string, unknown>;
  specialAssignmentRules?: Record<string, {
    noSkillRoll?: boolean;
    physicalAgeDelta?: number;
    noRetention?: boolean;
    historyLine?: string;
  }>;
  combatAssignments?: string[];
  rankCaps?: Record<string, number>;
  specialistSchool?: Record<string, unknown>;
  /** PM p. 55 rank-keyed Service Skills column policy (read by the
   *  special-assignment service-skill roll via serviceSkillColumnFor). */
  skillColumnPolicy?: SkillColumnPolicy;
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
    perFleet: Record<string, { target: number; dms: StructuredDm[] }>;
    branchChange?: string;
    fleetChange?: string;
  };
}

function dataFor(ch: Character): NavyData {
  const data = getAcgPathway(ch.editionId, "navy");
  if (!data) throw new Error("Navy pathway requires ACG data");
  return data;
}

/** Enlistment + fleet selection + branch assignment. */
export function navyEnlist(
  ch: Character,
  fleet: "imperialNavy" | "reserveFleet" | "systemSquadron",
): void {
  // System Squadron requires a minimum homeworld tech code (PM p. 52);
  // the threshold is strict-read from JSON.
  if (fleet === "systemSquadron") {
    const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
    const order = getEdition(ch.editionId).data.homeworld?.techCodeOrder
      ?? acg?.homeworld?.techCodeOrder;
    const hwTech = ch.homeworld?.tech;
    if (order && hwTech) {
      const minTech = requireRule(
        dataFor(ch).enlistment.systemSquadron.techMinimum,
        "acg.navy.enlistment.systemSquadron.techMinimum", "PM p. 52",
      );
      const idx = order.indexOf(hwTech);
      const minIdx = order.indexOf(minTech);
      if (idx < minIdx) {
        throw new EnlistmentValidationError(
          `System Squadron requires homeworld tech ${minTech}+; this homeworld is ${hwTech}`,
        );
      }
    }
  }
  const data = dataFor(ch);
  const spec = data.enlistment[fleet];
  ch.requireNavyAcg().fleet = fleet;

  // Naval Academy / NOTC / Medical-School graduates: read the fleet
  // assignment from JSON (navy.preCareerFleetAssignment).
  const acg = ch.requireAcgState();
  if (acg.preCareerCommission) {
    const policy = data.preCareerFleetAssignment;
    const schools = acg.schoolsAttended;
    let forcedFleet: typeof fleet | null = null;
    let forcedBranch: string | null = null;
    if (policy) {
      // Schools (e.g. Naval Academy, Medical School) take precedence.
      for (const school of schools) {
        const entry = policy.bySchool?.[school];
        if (entry?.fleet) {
          forcedFleet = entry.fleet as typeof fleet;
          forcedBranch = entry.branch ?? forcedBranch;
          break;
        }
      }
      // Otherwise consider preCareerBranch (e.g. college NOTC → Reserve Fleet).
      const branch = acg.preCareerBranch;
      if (!forcedFleet && branch) {
        const entry = policy.byPreCareerBranch?.[branch];
        if (entry?.fleet) {
          forcedFleet = entry.fleet as typeof fleet;
          forcedBranch = entry.branch ?? forcedBranch;
        }
      }
    }
    if (forcedFleet && fleet !== forcedFleet) {
      const fromFleet = fleet ?? undefined;
      ch.requireNavyAcg().fleet = forcedFleet;
      ch.log(ev.transferred(
        forcedFleet, "fleet", fromFleet,
        "academy/NOTC commission (PM p. 52)",
      ));
    } else {
      ch.requireNavyAcg().fleet = forcedFleet ?? fleet;
    }
    // Medical School graduate joins the Medical Branch automatically.
    if (forcedBranch) {
      ch.requireNavyAcg().branch = forcedBranch;
      ch.log(ev.enlistmentAttempt(
        `${ch.requireNavyAcg().fleet} Navy ${forcedBranch} Branch (academy/school direct commission, ${acg.rankCode})`,
        0, 0, 0, true,
      ));
    } else {
      ch.log(ev.enlistmentAttempt(
        `${ch.requireNavyAcg().fleet} Navy (academy/NOTC, ${acg.rankCode})`,
        0, 0, 0, true,
      ));
      navyAssignBranch(ch);
    }
    return;
  }

  const dm = evaluateDM(spec.dms, { attributes: ch.attributes, terms: ch.terms });
  const r = ch.rng.roll(2);
  const succeeded = r + dm >= spec.target;
  ch.log(ev.enlistmentAttempt(`${fleet} Navy`, r, dm, spec.target, succeeded));
  if (succeeded) {
    acg.rankCode = data.enlistment.startingRank;
    acg.isOfficer = data.enlistment.startingRank.startsWith("O");
  } else {
    // Try draft.
    const dr = ch.rng.roll(1);
    const drafted = data.enlistment.draft.results[String(dr)];
    if (!drafted) {
      throw new EnlistmentValidationError("Navy draft rejection — choose another path");
    }
    ch.drafted = true;
    // Fleet + log label derive from the rolled JSON draft result (PM p. 52)
    // rather than code literals that could silently diverge from the data.
    ch.requireNavyAcg().fleet = navyFleetKeyOf(drafted);
    acg.rankCode = data.enlistment.startingRank;
    acg.isOfficer = false;
    ch.log(ev.drafted(drafted));
  }

  // Branch assignment — different column for officers vs enlisted.
  navyAssignBranch(ch);
}

/** Map a printed fleet label ("Imperial Navy") to its fleet key, failing
 *  loudly on unknown labels so JSON drift can't silently mis-file a draftee. */
function navyFleetKeyOf(
  label: string,
): "imperialNavy" | "reserveFleet" | "systemSquadron" {
  const key = labelToColumnKey(label);
  if (key === "imperialNavy" || key === "reserveFleet" || key === "systemSquadron") {
    return key;
  }
  throw new Error(`Navy draft result "${label}" is not a known fleet (PM p. 52)`);
}

/** The single fleet the JSON draft table names (PM p. 52). Used by the
 *  pre-career wash-out draft default (chargen/enlistment.ts) so that code
 *  cannot diverge from the declared draft destination. */
export function navyDraftFleetKey(
  editionId: string,
): "imperialNavy" | "reserveFleet" | "systemSquadron" {
  const results = requireRule(
    getAcgPathway(editionId, "navy")?.enlistment?.draft?.results,
    "acg.navy.enlistment.draft.results", "PM p. 52",
  );
  const labels = [...new Set(Object.values(results))];
  if (labels.length !== 1 || typeof labels[0] !== "string") {
    throw new Error(
      "acg.navy.enlistment.draft.results must name exactly one fleet (PM p. 52)",
    );
  }
  return navyFleetKeyOf(labels[0]);
}

function navyAssignBranch(ch: Character): void {
  const data = dataFor(ch);
  // Medical/Flight School graduates: automatic branch (PM p. 52/47) —
  // read from preCareerFleetAssignment.bySchool so the school -> branch
  // mapping lives only in JSON. Social 9+ characters may instead pick any
  // branch — that's a player choice exposed in pickOrDefer.
  const acg = ch.requireAcgState();
  const bySchool = data.preCareerFleetAssignment?.bySchool ?? {};
  for (const school of acg.schoolsAttended) {
    const branch = bySchool[school]?.branch;
    if (branch) {
      ch.requireNavyAcg().branch = branch;
      return;
    }
  }
  if (ch.attributes.social >= data.branchChoiceSocialMin
    && data.branches && ch.choiceMode === "interactive") {
    // F7: Technical Services exists only in the Imperial Navy (PM p. 52
    // line 3261). Filter the available branches accordingly.
    const filtered = filterBranchesByFleet(ch, data.branches);
    ch.pickOrDefer({
      kind: "navyBranch",
      label: "Choose your Naval branch (Social 9+ may select).",
      options: filtered,
      onResolve: (ch, branch) => { ch.requireNavyAcg().branch = branch; },
    });
    return;
  }
  const col = acg.isOfficer ? "officer" : "enlisted";
  const dm = applyStructuredDms(data.branchAssignment.dms, ch);
  let rolled: string | null = null;
  // Re-roll if the rolled branch is Technical Services in a fleet that
  // doesn't have it (cap at 8 attempts as a safety net — the table has
  // multiple non-Tech-Services rows so re-roll converges quickly).
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = rollDieRow(ch, data.branchAssignment, { dice: 1, dm });
    const cell = row?.[col];
    if (cell === undefined || cell === null) {
      throw new Error(
        `Navy branchAssignment table has no "${col}" cell for the rolled ` +
        `die (edition: ${ch.editionId}) — fix the edition JSON`,
      );
    }
    const candidate = String(cell);
    if (isBranchAllowedForFleet(ch, candidate)) {
      rolled = candidate;
      break;
    }
  }
  if (!rolled) {
    throw new Error(
      "Navy branch assignment failed: 8 consecutive rolls yielded branches " +
      `not allowed in the ${ch.requireNavyAcg().fleet} (branchFleetRestrictions)`,
    );
  }
  ch.requireNavyAcg().branch = rolled;
  // acgState.branch is read by subsequent branch-skill and assignment rolls.
}

/** F7: PM p. 52 — "The Technical Services branch exists only in the
 *  Imperial Navy." Read the restriction from the edition JSON (no
 *  hardcoded branch names in code). */
function isBranchAllowedForFleet(ch: Character, branch: string): boolean {
  const restrictions = dataFor(ch).branchFleetRestrictions ?? {};
  const allowedFleets = restrictions[branch];
  if (!allowedFleets) return true;
  return allowedFleets.includes(ch.acgState?.pathway === "navy" ? ch.acgState.fleet : "");
}

function filterBranchesByFleet(ch: Character, branches: string[]): string[] {
  return branches.filter((b) => isBranchAllowedForFleet(ch, b));
}

/** Initial training: 2 skills on Branch Skills (enlisted) or Officer Staff
 *  Skills (officers). Officers may choose which table per manual p. 52.
 *  Drafted characters and OCS commissions skip Officer Staff Skills —
 *  see the OCS gate below. */
export function navyInitialTraining(ch: Character): void {
  // F6 PM p. 52 line 3272: "officers with commissions from OCS do not
  // undergo this training." Initial training fires at the very start of
  // term 1 year 1, so the natural ordering puts OCS commissions after
  // this point (OCS is a special-duty result, which can only fire from
  // term 1 year 2 onward — never before initial training).
  //
  // For defence-in-depth: if some future flow ever calls
  // navyInitialTraining after an OCS-induced isOfficer=true with no
  // preCareerCommission flag set, we still treat the character as
  // ineligible for Officer Staff Skills.
  const data = dataFor(ch);
  if (!data.branchSkills) return;
  const acg = ch.requireAcgState();
  const isAcademyOrNotcOfficer = acg.isOfficer &&
    acg.preCareerCommission === true;
  const rolls = requireRule(
    data.initialTraining?.rolls, "acg.navy.initialTraining.rolls", "PM p. 52",
  );
  if (isAcademyOrNotcOfficer && ch.choiceMode === "interactive") {
    // Officers may choose Branch Skills or Officer Staff Skills for each
    // initial-training roll. Expose as a player choice.
    for (let i = 0; i < rolls; i++) navyOfficerSkillChoice(ch);
    return;
  }
  for (let i = 0; i < rolls; i++) navyBranchSkillRoll(ch);
}

function navyOfficerSkillChoice(ch: Character): void {
  ch.pickOrDefer({
    kind: "navyOfficerSkillTable",
    label: "Officer training: roll on which skill table?",
    options: optionDomain(ch.editionId, "acg.navy.officerSkillTable").values,
    onResolve: (ch, table) => {
      if (table === "Officer Staff Skills") navyServiceSkillRoll(ch, "staffOfficer");
      else navyBranchSkillRoll(ch);
    },
  });
}

function navyServiceSkillRoll(ch: Character, column: string): void {
  const data = dataFor(ch);
  if (!data.serviceSkills) return;
  rollSkillFromColumn(ch, data.serviceSkills, column, `Navy ${column}`);
}

function navyBranchSkillRoll(ch: Character): void {
  const data = dataFor(ch);
  if (!data.branchSkills) return;
  const branch = navyBranchOf(ch);
  const candidates = branchSkillCandidates(labelToColumnKey(branch));
  rollSkillFromColumn(ch, data.branchSkills, { candidates },
    `Navy ${branch} branch skills`);
}

/** The character's naval branch. Enlistment (navyAssignBranch) always sets
 *  it; an empty branch means a branch-keyed roll ran before enlistment —
 *  fail loudly instead of silently defaulting to Line. */
function navyBranchOf(ch: Character): string {
  const branch = ch.requireNavyAcg().branch;
  if (!branch) {
    throw new Error(
      "Navy branch is unset — enlistment must assign a branch before " +
      "branch-keyed rolls (PM p. 52)",
    );
  }
  return branch;
}

/** Command Duty roll (officers only). */
export function navyCommandDuty(ch: Character): void {
  const acg = ch.requireAcgState();
  if (!acg.isOfficer) {
    acg.inCommand = false;
    return;
  }
  // Per manual: not consulting the table results in assignment to staff.
  // In interactive mode the player can decline the roll.
  if (ch.choiceMode === "interactive") {
    ch.pickOrDefer({
      kind: "commandDutyOptIn",
      label: "Attempt the command-duty roll this year?",
      options: ["Roll for command", "Take staff position"],
      onResolve: (ch, choice) => {
        if (choice === "Take staff position") {
          ch.requireAcgState().inCommand = false;
          return;
        }
        navyRollCommandDuty(ch);
      },
    });
    return;
  }
  navyRollCommandDuty(ch);
}

function navyRollCommandDuty(ch: Character): void {
  const data = dataFor(ch);
  resolveCommandDuty(ch, {
    rows: data.commandDuty.rows,
    role: navyBranchOf(ch),
    cellKey: "target",
    dm: applyStructuredDms(data.commandDuty.dms, ch),
  });
}

/** Roll the year's assignment from the navy assignment table. */
export function navyRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  const retained = consumeRetainedAssignment(acg);
  if (retained) return retained;
  const dm = applyStructuredDms(data.assignment.dms, ch);
  const row = rollDieRowOrThrow(ch, data.assignment, { dice: 2, dm, lo: 2, hi: 12 }, "Navy assignment");
  return String(row.assignment);
}

const REGISTRY = createPathwaySpecRegistry<NavyData & { combatAssignments?: readonly string[] }>({
  pathwayKey: "navy",
  callbacks: {},
  combatAssignments: (data) => data.combatAssignments ?? [],
});
export const validateNavyConfig = REGISTRY.validate;
function getNavySpec(ch: Character): PathwaySpec { return REGISTRY.get(ch); }

/** Resolve assignment. Branch picks which resolution sub-table to use. */
export function navyResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  const branch = navyBranchOf(ch);
  const resKey = requireRule(
    data.branchResolution?.[branch],
    `acg.navy.branchResolution["${branch}"]`, "PM p. 53",
  );
  const resTable = data.assignmentResolution[resKey];
  if (!resTable) {
    throw new Error(
      `Navy: no resolution table for branch "${branch}" ` +
      `(sub-key "${resKey}", edition: ${ch.editionId}).`,
    );
  }

  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    // Special-assignment rule (Frozen Watch et al.) — PM p. 53.
    const specials = (data.specialAssignmentRules ?? {}) as Record<string, {
      noSkillRoll?: boolean;
      physicalAgeDelta?: number;
      historyLine?: string;
    }>;
    const rule = specials[assignment];
    if (rule) {
      const acg = ch.requireAcgState();
      acg.assignmentHistory.push(assignment);
      // Frozen Watch (and any cold-sleep rule): the year still advances
      // chronological age in runAcgYear, but physical aging is offset so
      // the character is one year older chronologically than physically
      // (PM p. 56). doAging drives the aging saving throws off physical
      // age. noSkillRoll is honored implicitly — this branch skips every
      // resolution phase, so no skill is rolled.
      if (rule.physicalAgeDelta) {
        acg.physicalAgeOffset = (acg.physicalAgeOffset ?? 0) + rule.physicalAgeDelta;
      }
      if (rule.historyLine) ch.log(ev.raw(rule.historyLine));
      return;
    }
    throw new Error(
      `Navy: unknown assignment "${assignment}" (col "${assignmentCol}") for ` +
      `branch "${branch}" (resKey "${resKey}", available: ` +
      `${resTable.columns.join(", ")}).`,
    );
  }

  const res = lookupResolution(resTable, assignment);
  const dms = combatResolutionDms(ch, resTable);
  runPhases(getNavySpec(ch), { ch, assignment, resTable, res, dms });
}

export function navyRetention(ch: Character, assignment: string): void {
  const acg = ch.requireAcgState();
  if (acg.justRetained) {
    acg.justRetained = false;
    return;
  }
  // Per manual p. 53: "no one can be retained in the same assignment more
  // than once in succession". The retention throw (6+ on 1D) is declared
  // in navy.retention.throw. Assignments flagged noRetention in
  // navy.specialAssignmentRules are excluded (Frozen Watch / Special Duty).
  const data = dataFor(ch);
  const spec = requireRule(
    data.retention?.throw, "navy.retention.throw", "PM p. 53",
  );
  const specials = (data.specialAssignmentRules ?? {}) as
    Record<string, { noRetention?: boolean }>;
  const r = ch.rng.roll(spec.die);
  if (r >= spec.target && !specials[assignment]?.noRetention) {
    acg.retainedAssignment = assignment;
    acg.justRetained = true;
  } else {
    acg.retainedAssignment = null;
  }
}

export function navySpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  if (!data.specialAssignments) return;
  const sa = rollSpecialAssignment(ch, data.specialAssignments, data.ocsAdvancement?.ageLimit);
  if (!sa) return;
  ch.requireAcgState().assignmentHistory.push(sa);
  applySpecialAssignment(ch, "navy", sa);
}

export function navyReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const fleet = ch.requireNavyAcg().fleet;
  const spec = data.reenlistment.perFleet[fleet];
  if (!spec) {
    throw new Error(`Navy reenlistment missing perFleet config for "${fleet}"`);
  }
  // Reenlist DMs use the shared structured shape + evaluator (PM p. 53:
  // DM +1/+2 for enlisted E4+ or officer, per fleet).
  return runReenlist(ch, {
    target: spec.target,
    dms: spec.dms,
    label: `navy ${fleet}`,
    onContinue: () => offerNavyBranchChange(ch),
  });
}

/** PM p. 53: at reenlistment a character may transfer to a branch they
 *  have been cross-trained into (recorded via crossTrainedBranches). The
 *  choice is surfaced in interactive mode; auto mode keeps the current
 *  branch. A character with no cross-training has only their current
 *  branch as an option and no prompt is shown. */
function offerNavyBranchChange(ch: Character): void {
  const acg = ch.acgState;
  if (acg?.pathway !== "navy" || !acg.isOfficer) return;
  const current = acg.branch || "";
  const crossTrained = acg.crossTrainedBranches ?? [];
  // F7: filter cross-trained branches by fleet eligibility too.
  const eligible = [
    current,
    ...crossTrained.filter((b) => b !== current && isBranchAllowedForFleet(ch, b)),
  ];
  const label = `Change navy branch for next term (current: ${current}; `
    + `eligible via cross-training: ${crossTrained.join(", ")})`;
  offerRoleChange(ch, {
    current,
    options: eligible,
    label,
    context: { source: "reenlist", reenlistChangeBranch: true },
    apply: (ch, chosen) => {
      const acg = ch.acgState;
      if (acg?.pathway !== "navy") return;
      acg.branch = chosen;
      ch.log(ev.transferred(chosen, "branch", current, "reenlist (via cross-training)"));
    },
  });
}

/** Per-term reset shared with mercenary — see resetCombatTermFlags. */
export const navyStartOfTerm = resetCombatTermFlags;

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
    startOfTerm: navyStartOfTerm,
  };
}
