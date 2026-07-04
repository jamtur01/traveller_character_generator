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
  applyStructuredDms, columnDmFor, labelToColumnKey, lookupResolution,
  parseResolutionTarget,
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import { applySpecialAssignment } from "@/lib/traveller/engine/acg/schools";
import { applyAcgSkillCell } from "@/lib/traveller/engine/acg/skills";
import {
  applyOnce, markComplete, resetIfComplete,
  alreadyApplied, markApplied,
} from "@/lib/traveller/engine/acg/subStepCache";
import { runPhases, type PathwaySpec } from "@/lib/traveller/engine/acg/phaseRunner";
import { type PathwayCallbacks } from "@/lib/traveller/engine/acg/jsonPhases";
import {
  createPathwaySpecRegistry, resetCombatTermFlags, combatFinalize,
  combatResolutionDms, rollSpecialAssignment, runReenlist, offerRoleChange,
  applyPromotion, consumeRetainedAssignment, clampedRoll,
} from "./shared";
import { event as ev } from "@/lib/traveller/history";

const PATHWAY = "navy";

export interface NavyData {
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
    dms?: StructuredDm[];
    notes?: string[];
  }>;
  retention?: unknown;
  specialAssignments?: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  specialAssignmentDetails?: Record<string, unknown>;
  specialAssignmentRules?: Record<string, {
    noSkillRoll?: boolean;
    physicalAgeDelta?: number;
    noRetention?: boolean;
    historyLine?: string;
  }>;
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
  // System Squadron requires homeworld tech Early Stellar+ (PM p. 52).
  if (fleet === "systemSquadron") {
    const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
    const order = getEdition(ch.editionId).data.homeworld?.techCodeOrder
      ?? acg?.homeworld?.techCodeOrder;
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
  ch.requireAcgState().fleet = fleet;

  // Naval Academy / NOTC / Medical-School graduates: read the fleet
  // assignment from JSON (navy.preCareerFleetAssignment).
  if (ch.requireAcgState().preCareerCommission) {
    const policy = data.preCareerFleetAssignment;
    const schools = ch.requireAcgState().schoolsAttended;
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
      const branch = ch.requireAcgState().preCareerBranch;
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
      ch.requireAcgState().fleet = forcedFleet;
      ch.log(ev.transferred(
        forcedFleet, "fleet", fromFleet,
        "academy/NOTC commission (PM p. 52)",
      ));
    } else {
      ch.requireAcgState().fleet = forcedFleet ?? fleet;
    }
    // Medical School graduate joins the Medical Branch automatically.
    if (forcedBranch) {
      ch.requireAcgState().branch = forcedBranch;
      ch.log(ev.enlistmentAttempt(
        `${ch.requireAcgState().fleet} Navy ${forcedBranch} Branch (academy/school direct commission, ${ch.requireAcgState().rankCode})`,
        0, 0, 0, true,
      ));
    } else {
      ch.log(ev.enlistmentAttempt(
        `${ch.requireAcgState().fleet} Navy (academy/NOTC, ${ch.requireAcgState().rankCode})`,
        0, 0, 0, true,
      ));
      navyAssignBranch(ch);
    }
    return;
  }

  let dm = 0;
  for (const d of spec.dms) {
    const attr = d.attribute as keyof typeof ch.attributes;
    if (ch.attributes[attr] >= d.min) dm += d.dm;
  }
  const r = ch.rng.roll(2);
  const succeeded = r + dm >= spec.target;
  ch.log(ev.enlistmentAttempt(`${fleet} Navy`, r, dm, spec.target, succeeded));
  if (succeeded) {
    ch.requireAcgState().rankCode = data.enlistment.startingRank;
    ch.requireAcgState().isOfficer = data.enlistment.startingRank.startsWith("O");
  } else {
    // Try draft.
    const dr = ch.rng.roll(1);
    const drafted = data.enlistment.draft.results[String(dr)];
    if (!drafted) {
      throw new Error("Navy draft rejection — choose another path");
    }
    ch.drafted = true;
    ch.requireAcgState().fleet = "imperialNavy";
    ch.requireAcgState().rankCode = data.enlistment.startingRank;
    ch.requireAcgState().isOfficer = false;
    ch.log(ev.drafted("Imperial Navy"));
  }

  // Branch assignment — different column for officers vs enlisted.
  navyAssignBranch(ch);
}

function navyAssignBranch(ch: Character): void {
  const data = dataFor(ch);
  // Medical/Flight School graduates: automatic branch (manual p. 52).
  // Social 9+ characters may also pick any branch — that's a player choice
  // exposed in pickOrDefer.
  const schools = ch.requireAcgState().schoolsAttended;
  if (schools.includes("medicalSchool")) {
    ch.requireAcgState().branch = "Medical";
    return;
  }
  if (schools.includes("flightSchool")) {
    ch.requireAcgState().branch = "Flight";
    return;
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
      onResolve: (ch, branch) => { ch.requireAcgState().branch = branch; },
    });
    return;
  }
  const col = ch.requireAcgState().isOfficer ? "officer" : "enlisted";
  const dm = applyStructuredDms(data.branchAssignment.dms, ch);
  let rolled: string | null = null;
  // Re-roll if the rolled branch is Technical Services in a fleet that
  // doesn't have it (cap at 8 attempts as a safety net — the table has
  // multiple non-Tech-Services rows so re-roll converges quickly).
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = clampedRoll(ch, 1, dm, 0, 7);
    const row = data.branchAssignment.rows.find((row) => row.die === r);
    const candidate = String(row?.[col] ?? "Line");
    if (isBranchAllowedForFleet(ch, candidate)) {
      rolled = candidate;
      break;
    }
  }
  ch.requireAcgState().branch = rolled ?? (ch.requireAcgState().isOfficer ? "Line" : "Crew");
  // acgState.branch is read by subsequent branch-skill and assignment rolls.
}

/** F7: PM p. 52 — "The Technical Services branch exists only in the
 *  Imperial Navy." Read the restriction from the edition JSON (no
 *  hardcoded branch names in code). */
function isBranchAllowedForFleet(ch: Character, branch: string): boolean {
  const restrictions = dataFor(ch).branchFleetRestrictions ?? {};
  const allowedFleets = restrictions[branch];
  if (!allowedFleets) return true;
  return allowedFleets.includes(ch.acgState?.fleet ?? "");
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
  const isAcademyOrNotcOfficer = ch.requireAcgState().isOfficer &&
    ch.requireAcgState().preCareerCommission === true;
  if (isAcademyOrNotcOfficer && ch.choiceMode === "interactive") {
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
    onResolve: (ch, table) => {
      if (table === "Officer Staff Skills") navyServiceSkillRoll(ch, "staffOfficer");
      else navyBranchSkillRoll(ch);
    },
  });
}

function navyServiceSkillRoll(ch: Character, column: string): void {
  const data = dataFor(ch);
  if (!data.serviceSkills) return;
  const table = data.serviceSkills;
  const maxDie = Math.max(...table.rows.map((row) => row.die as number));
  const dm = columnDmFor(table.dms, column, ch);
  const r = clampedRoll(ch, 1, dm, 1, maxDie);
  const row = table.rows.find((row) => row.die === r);
  if (!row) return;
  const skill = row[column];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill, `Navy ${column}`);
}

function navyBranchSkillRoll(ch: Character): void {
  const data = dataFor(ch);
  if (!data.branchSkills) return;
  const table = data.branchSkills;
  const col = labelToColumnKey(ch.requireAcgState().branch ?? "Line");
  const maxDie = Math.max(...table.rows.map((row) => row.die as number));
  const dm = columnDmFor(table.dms, col, ch);
  const r = clampedRoll(ch, 1, dm, 1, maxDie);
  const row = table.rows.find((row) => row.die === r);
  if (!row) return;
  // Convert branch to column key.
  const candidates = [col, col === "line" ? "lineCrew" : col,
    col === "crew" ? "lineCrew" : col];
  let skill: string | undefined;
  for (const cand of candidates) {
    const v = row[cand];
    if (typeof v === "string") { skill = v; break; }
  }
  if (skill) applyAcgSkillCell(ch, skill, `Navy ${ch.requireAcgState().branch ?? "Line"} branch skills`);
}

/** Command Duty roll (officers only). */
export function navyCommandDuty(ch: Character): void {
  if (!ch.requireAcgState().isOfficer) {
    ch.requireAcgState().inCommand = false;
    return;
  }
  // Per manual: not consulting the table results in assignment to staff.
  // In interactive mode the player can decline the roll.
  if (ch.choiceMode === "interactive") {
    // Mark applied BEFORE pickOrDefer (which throws in interactive mode).
    // Without this gate, every "Run term" / runAcgYear re-entry — while
    // the choice is still queued OR after it resolves — re-fires this
    // function, queueing another identical prompt. The flag lives in
    // thisYearOutcomes.applied and is cleared at year boundary.
    if (alreadyApplied(ch, "navyCommandDutyOptIn-prompted")) return;
    markApplied(ch, "navyCommandDutyOptIn-prompted");
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
  const branch = ch.requireAcgState().branch ?? "Line";
  const row = data.commandDuty.rows.find((r) => r.branch === branch);
  if (!row) { ch.requireAcgState().inCommand = false; return; }
  const parsed = parseResolutionTarget(row.target);
  if (parsed.target === "auto") { ch.requireAcgState().inCommand = true; return; }
  if (typeof parsed.target !== "number") { ch.requireAcgState().inCommand = false; return; }
  const dm = applyStructuredDms(data.commandDuty.dms, ch);
  const r = ch.rng.roll(2);
  const success = r + dm >= parsed.target;
  ch.log(ev.commandDuty(success, r, dm, parsed.target));
  ch.requireAcgState().inCommand = success;
}

/** Roll the year's assignment from the navy assignment table. */
export function navyRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  const retained = consumeRetainedAssignment(acg);
  if (retained) return retained;
  const dm = applyStructuredDms(data.assignment.dms, ch);
  const r = clampedRoll(ch, 2, dm, 2, 12);
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Navy assignment table missing row for die=${r}`);
  return String(row.assignment);
}

const NAVY_CALLBACKS: PathwayCallbacks = {
  promoteNavy: (ctx) => promoteNavy(ctx.ch),
  navyBranchSkillRoll: (ctx) => navyBranchSkillRoll(ctx.ch),
  navyFinalize: (ctx) =>
    combatFinalize(ctx, dataFor(ctx.ch).combatAssignments ?? []),
};

const REGISTRY = createPathwaySpecRegistry<NavyData & { combatAssignments?: readonly string[] }>({
  pathwayKey: "navy",
  callbacks: NAVY_CALLBACKS,
  combatAssignments: (data) => data.combatAssignments ?? [],
});
export const validateNavyConfig = REGISTRY.validate;
function getNavySpec(ch: Character): PathwaySpec { return REGISTRY.get(ch); }

/** Resolve assignment. Branch picks which resolution sub-table to use. */
export function navyResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  const branch = ch.requireAcgState().branch ?? "Line";
  const resKey = data.branchResolution?.[branch] ?? "lineCrew";
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
      resetIfComplete(ch);
      applyOnce(ch, "navySpecialRuleApplied", () => {
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
      });
      markComplete(ch);
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

function promoteNavy(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireNavyAcg();
  // PM p. 55: per-fleet officer rank caps live in JSON (navy.rankCaps).
  const caps = data.rankCaps;
  if (!caps) {
    throw new Error(
      "Navy pathway requires rankCaps (advancedCharacterGeneration.navy.rankCaps).",
    );
  }
  const ladder = acg.isOfficer ? data.ranks.officer : data.ranks.enlisted;
  const opts = acg.isOfficer ? { cap: caps[acg.fleet] ?? 10 } : undefined;
  applyPromotion(ch, ladder, opts);
}

export function navyRetention(ch: Character, assignment: string): void {
  if (ch.requireAcgState().justRetained) {
    ch.requireAcgState().justRetained = false;
    return;
  }
  // Per manual p. 53: "no one can be retained in the same assignment more
  // than once in succession". Retention roll: 1D=6 → same next year.
  // Assignments flagged noRetention in navy.specialAssignmentRules are
  // excluded (Frozen Watch / Special Duty).
  const data = dataFor(ch);
  const specials = (data.specialAssignmentRules ?? {}) as
    Record<string, { noRetention?: boolean }>;
  const r = ch.rng.roll(1);
  if (r === 6 && !specials[assignment]?.noRetention) {
    ch.requireAcgState().retainedAssignment = assignment;
    ch.requireAcgState().justRetained = true;
  } else {
    ch.requireAcgState().retainedAssignment = null;
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
  const fleet = ch.requireAcgState().fleet ?? "imperialNavy";
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
  if (!ch.acgState || !ch.acgState.isOfficer) return;
  const current = ch.acgState.branch ?? "";
  const crossTrained = ch.acgState.crossTrainedBranches ?? [];
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
      if (!ch.acgState) return;
      ch.acgState.branch = chosen;
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
