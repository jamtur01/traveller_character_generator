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
  parseResolutionTarget,
  type StructuredDm,
} from "../tables";
import { applySpecialAssignment } from "../schools";
import { applyAcgSkillCell } from "../skills";
import {
  applyOnce, markComplete, resetIfComplete,
} from "../subStepCache";
import { runPhases, type PathwaySpec } from "../phaseRunner";
import {
  buildPathwaySpecFromConfig, type PathwayCallbacks,
  type ResolveAssignmentConfig,
} from "../jsonPhases";
import { event as ev } from "../../../history";

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
    dms?: string[];
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
    perFleet?: Record<string, {
      target: number;
      dms: Array<{
        condition?: string;
        when?: { enlistedRankAtLeast?: number; officer?: boolean };
        dm: number;
      }>;
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
  const r = roll(2);
  const succeeded = r + dm >= spec.target;
  ch.log(ev.enlistmentAttempt(`${fleet} Navy`, r, dm, spec.target, succeeded));
  if (succeeded) {
    ch.requireAcgState().rankCode = data.enlistment.startingRank;
    ch.requireAcgState().isOfficer = data.enlistment.startingRank.startsWith("O");
  } else {
    // Try draft.
    const dr = roll(1);
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
  if (ch.attributes.social >= 9 && data.branches && ch.choiceMode === "interactive") {
    // F7: Technical Services exists only in the Imperial Navy (PM p. 52
    // line 3261). Filter the available branches accordingly.
    const filtered = filterBranchesByFleet(ch, data.branches);
    ch.pickOrDefer({
      kind: "navyBranch",
      label: "Choose your Naval branch (Social 9+ may select).",
      options: filtered,
      onResolve: (c, branch) => { c.requireAcgState().branch = branch; },
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
    const r = Math.max(0, Math.min(7, roll(1) + dm));
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
  if (typeof skill === "string") applyAcgSkillCell(ch, skill, `Navy ${column}`);
}

function navyBranchSkillRoll(ch: Character): void {
  const data = dataFor(ch);
  if (!data.branchSkills) return;
  const r = roll(1);
  const row = data.branchSkills.rows.find((row) => row.die === r);
  if (!row) return;
  // Convert branch to column key.
  const col = labelToColumnKey(ch.requireAcgState().branch ?? "Line");
  const candidates = [col, col === "line" ? "lineCrew" : col,
    col === "crew" ? "lineCrew" : col];
  let skill: string | undefined;
  for (const c of candidates) {
    const v = row[c];
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
    ch.pickOrDefer({
      kind: "commandDutyOptIn",
      label: "Attempt the command-duty roll this year?",
      options: ["Roll for command", "Take staff position"],
      onResolve: (c, choice) => {
        if (choice === "Take staff position") {
          c.requireAcgState().inCommand = false;
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
  const branch = ch.requireAcgState().branch ?? "Line";
  const row = data.commandDuty.rows.find((r) => r.branch === branch);
  if (!row) { ch.requireAcgState().inCommand = false; return; }
  const parsed = parseResolutionTarget(row.target);
  if (parsed.target === "auto") { ch.requireAcgState().inCommand = true; return; }
  if (typeof parsed.target !== "number") { ch.requireAcgState().inCommand = false; return; }
  const dm = applyStructuredDms(data.commandDuty.dms, ch);
  const r = roll(2);
  const success = r + dm >= parsed.target;
  ch.log(ev.commandDuty(success, r, dm, parsed.target));
  ch.requireAcgState().inCommand = success;
}

/** Roll the year's assignment from the navy assignment table. */
export function navyRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  if (acg.justRetained && acg.retainedAssignment) {
    const retained = acg.retainedAssignment;
    acg.justRetained = false;
    acg.retainedAssignment = null;
    return retained;
  }
  const dm = applyStructuredDms(data.assignment.dms, ch);
  const r = Math.max(2, Math.min(12, roll(2) + dm));
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Navy assignment table missing row for die=${r}`);
  return String(row.assignment);
}

const NAVY_CALLBACKS: PathwayCallbacks = {
  promoteNavy: (ctx) => promoteNavy(ctx.ch),
  navyBranchSkillRoll: (ctx) => navyBranchSkillRoll(ctx.ch),
  navyFinalize: (ctx) => {
    const data = dataFor(ctx.ch);
    const combat = (data.combatAssignments ?? []).includes(ctx.assignment);
    if (combat) {
      ctx.ch.requireAcgState().combatRibbons += 1;
      ctx.ch.log(ev.decoration("Combat Ribbon", `for ${ctx.assignment}`));
      const acg = ctx.ch.requireAcgState();
      if (acg.inCommand && acg.isOfficer) {
        acg.commandClusters += 1;
        ctx.ch.log(ev.decoration("Command Cluster", `command of ${ctx.assignment}`));
      }
    }
    ctx.ch.requireAcgState().assignmentHistory.push(ctx.assignment);
  },
};

const NAVY_SPEC_CACHE = new Map<string, PathwaySpec>();
export function clearNavySpecCache(): void {
  NAVY_SPEC_CACHE.clear();
}
export function validateNavyConfig(editionId: string): void {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) return;
  const data = acg.navy as (NavyData & {
    resolveAssignment?: ResolveAssignmentConfig;
    combatAssignments?: string[];
  }) | undefined;
  if (!data?.resolveAssignment) return;
  buildPathwaySpecFromConfig(data.resolveAssignment, NAVY_CALLBACKS, {
    combatAssignments: () => data.combatAssignments ?? [],
  });
}
function getNavySpec(ch: Character): PathwaySpec {
  let spec = NAVY_SPEC_CACHE.get(ch.editionId);
  if (spec) return spec;
  const data = dataFor(ch);
  const config = (data as NavyData & {
    resolveAssignment?: ResolveAssignmentConfig;
  }).resolveAssignment;
  if (!config) {
    throw new Error(
      `Edition "${ch.editionId}" navy block is missing resolveAssignment config.`,
    );
  }
  spec = buildPathwaySpecFromConfig(config, NAVY_CALLBACKS, {
    combatAssignments: (c) => dataFor(c).combatAssignments ?? [],
  });
  NAVY_SPEC_CACHE.set(ch.editionId, spec);
  return spec;
}

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
        if (assignment === "Frozen Watch") {
          ch.requireAcgState().frozenWatchYears = (ch.requireAcgState().frozenWatchYears ?? 0) + 1;
        }
        if (rule.physicalAgeDelta !== undefined) {
          ch.requireAcgState().physicalAgeOffset = (ch.requireAcgState().physicalAgeOffset ?? 0) + rule.physicalAgeDelta;
        }
        ch.requireAcgState().assignmentHistory.push(assignment);
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
  // decorationDmStrategy: negative = take -|N| on survival in exchange
  // for +|N| on decoration; positive reverses. Symmetric handling
  // matches mercenary (previously navy ignored the positive half and
  // silently dropped the player's "+1/-1" or "+2/-2" choice).
  const decStrategy = ch.requireAcgState().decorationDmStrategy;
  const survivalDmFromStrategy =
    -Math.abs(decStrategy) * Math.sign(decStrategy === 0 ? 0 : -decStrategy);
  const dms = {
    survival: applyDmRules(resTable.dms, ch, "survival") + survivalDmFromStrategy,
    decoration: applyDmRules(resTable.dms, ch, "decoration")
      + Math.abs(decStrategy) * (decStrategy < 0 ? 1 : -1),
    promotion: applyDmRules(resTable.dms, ch, "promotion"),
    skills: applyDmRules(resTable.dms, ch, "skills"),
  };
  runPhases(getNavySpec(ch), { ch, assignment, resTable, res, dms });
}

function promoteNavy(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireNavyAcg();
  const caps = data.rankCaps ?? { imperialNavy: 10, reserveFleet: 8, systemSquadron: 7 };
  const cap = caps[acg.fleet] ?? 10;

  if (acg.isOfficer) {
    const codes = data.ranks.officer.map((r) => r[0]);
    const idx = codes.indexOf(acg.rankCode);
    const targetIdx = Math.min(idx + 1, cap - 1);
    if (idx >= 0 && idx < targetIdx && targetIdx < codes.length) {
      acg.rankCode = codes[targetIdx]!;
      acg.promotedThisTerm = true;
      ch.log(ev.promoted(data.ranks.officer[targetIdx]![1]));
    }
  } else {
    const codes = data.ranks.enlisted.map((r) => r[0]);
    const idx = codes.indexOf(acg.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      acg.rankCode = codes[idx + 1]!;
      ch.log(ev.promoted(data.ranks.enlisted[idx + 1]![1]));
    }
  }
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
  const r = roll(1);
  if (r === 6 && !specials[assignment]?.noRetention) {
    ch.requireAcgState().retainedAssignment = assignment;
    ch.requireAcgState().justRetained = true;
  } else {
    ch.requireAcgState().retainedAssignment = null;
  }
}

export function navySpecialAssignment(ch: Character): void {
  // Roll on the Navy Special Assignments table (officer vs enlisted column),
  // then apply that school's effects from JSON-driven specialAssignmentDetails.
  // OCS over age 38 rerolls; if OCS comes up again, a waiver allows
  // attendance (PM p. 54).
  const data = dataFor(ch);
  if (!data.specialAssignments) return;
  const dm = applyStructuredDms(data.specialAssignments.dms, ch);
  const col = ch.requireAcgState().isOfficer ? "officer" : "enlisted";
  const rollOnce = (): string | null => {
    const r = Math.max(1, Math.min(7, roll(1) + dm));
    const row = data.specialAssignments!.rows.find((row) => row.die === r);
    return row ? String(row[col]) : null;
  };
  let assignment = rollOnce();
  if (!assignment) return;
  // OCS age limit per JSON (navy.ocsAdvancement.ageLimit, PM p. 51/54).
  const ocsAgeLimit = data.ocsAdvancement?.ageLimit;
  if (assignment === "OCS" && ocsAgeLimit !== undefined && ch.age > ocsAgeLimit) {
    const reroll = rollOnce();
    if (reroll === "OCS") {
      ch.log(ev.statusChange(
        "ocsWaiver", `over age ${ocsAgeLimit}, waiver granted on reroll`,
      ));
    } else if (reroll) {
      assignment = reroll;
    } else {
      return;
    }
  }
  ch.requireAcgState().assignmentHistory.push(assignment);
  applySpecialAssignment(ch, "navy", assignment);
}

export function navyReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const fleet = ch.requireAcgState().fleet ?? "imperialNavy";
  const spec = data.reenlistment.perFleet?.[fleet];
  if (!spec) {
    // Legacy single-target form (kept for back-compat).
    const r = roll(2);
    if (r === 12) { ch.enterMandatoryReenlist(); return true; }
    return r >= (data.reenlistment.target ?? 6);
  }
  let dm = 0;
  const rankNum = parseInt(ch.requireAcgState().rankCode.replace(/[^\d]/g, ""), 10) || 0;
  const isOfficer = ch.requireAcgState().isOfficer;
  for (const d of spec.dms) {
    // Structured form preferred.
    if (d.when) {
      const w = d.when;
      if (w.enlistedRankAtLeast !== undefined &&
          !isOfficer && rankNum >= w.enlistedRankAtLeast) {
        dm += d.dm;
      } else if (w.officer === true && isOfficer) {
        dm += d.dm;
      }
      continue;
    }
    // Legacy string form.
    if (d.condition === "rankE4orAbove" && !isOfficer && rankNum >= 4) dm += d.dm;
    else if (d.condition === "officer" && isOfficer) dm += d.dm;
  }
  const r = roll(2);
  ch.log(ev.roll("Reenlistment", r, dm, spec.target, r + dm >= spec.target, `navy ${fleet}`));
  if (r === 12) {
    ch.enterMandatoryReenlist();
    offerNavyBranchChange(ch);
    return true;
  }
  const keep = r + dm >= spec.target;
  if (keep) offerNavyBranchChange(ch);
  return keep;
}

/** PM p. 53: at reenlistment a character may transfer to a branch they
 *  have been cross-trained into (recorded via crossTrainedBranches). The
 *  choice is surfaced in interactive mode; auto mode keeps the current
 *  branch. A character with no cross-training has only their current
 *  branch as an option and no prompt is shown. */
function offerNavyBranchChange(ch: Character): void {
  if (!ch.acgState || ch.choiceMode === "auto") return;
  if (!ch.acgState.isOfficer) return;
  const current = ch.acgState.branch ?? "";
  const crossTrained = ch.acgState.crossTrainedBranches ?? [];
  // F7: filter cross-trained branches by fleet eligibility too.
  const filteredCrossTrained = crossTrained.filter(
    (b) => b !== current && isBranchAllowedForFleet(ch, b),
  );
  const eligible = [current, ...filteredCrossTrained];
  if (eligible.length <= 1) return;
  ch.pickOrDefer({
    kind: "cascade",
    label:
      `Change navy branch for next term (current: ${current}; eligible via cross-training: ${crossTrained.join(", ")})`,
    options: eligible,
    preferred: [current],
    context: { source: "reenlist", reenlistChangeBranch: true },
    onResolve: (c, chosen) => {
      if (chosen !== current && c.acgState) {
        c.acgState.branch = chosen;
        c.log(ev.transferred(
          chosen, "branch", current, "reenlist (via cross-training)",
        ));
      }
    },
  });
}

/** Reset per-term navy state. The decoration-DM tradeoff is a per-
 *  assignment player choice; without an explicit reset, a value set in
 *  one term's preRun prompt persists into the next term and silently
 *  biases later rolls. injuredThisYear is cleared as a safety net. */
export function navyStartOfTerm(ch: Character): void {
  if (!ch.acgState) return;
  ch.acgState.injuredThisYear = false;
  ch.acgState.decorationDmStrategy = 0;
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
    startOfTerm: navyStartOfTerm,
  };
}
