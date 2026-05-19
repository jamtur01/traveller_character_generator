// Mercenary pathway implementation. Covers Army and Marines under the
// MT Mercenary career, per MT Players' Manual pp. 48-51.
//
// Lifecycle per term (4 one-year assignments):
//   Year 1 of Term 1: Initial training (Gun Combat-1 + MOS roll)
//   Each subsequent year:
//     1. (Officers) Command Duty roll → command or staff position
//     2. Roll 2D on Mercenary Assignment table (column = combat arm)
//     3. If "Special Duty", roll on Special Assignments table instead
//     4. Resolve assignment: survival → decoration → promotion → skills
//     5. Retention roll (1D=6 → next year same assignment, unless already retained)
//   At end of 4 years (a complete term):
//     - Award 1 brownie point
//     - Aging
//     - Reenlist or muster out
//
// Decoration mechanics:
//   - Pass target → MCUF (1 BP)
//   - Pass by 3-5 → MCG (2 BP)
//   - Pass by 6+ → SEH (3 BP, +1 automatic promotion at muster out)
//   - Fail by 6+ → Court martial (consult common.courtMartial table)
//   - Negative survival DM can be converted to positive decoration DM
//     (acgState.decorationDmStrategy, player choice, default 0)

import type { Character } from "../../../character";
import { getEdition } from "../../../editions";
import { roll } from "../../../random";
import {
  applyDmRules, applyStructuredDms, labelToColumnKey, lookupResolution,
  parseResolutionTarget,
  type StructuredDm,
} from "../tables";
import { applyMercenarySchool } from "../schools";
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
import type { AcgState, ResolutionTarget } from "../types";

const PATHWAY = "mercenary";

interface MercenaryData {
  ocsAdvancement?: { ageLimit?: number; [k: string]: unknown };
  skillColumnPolicy?: {
    officerInCommand: string;
    officerStaff: string;
    enlistedNcoMinRank: string;
    enlistedNcoColumn: string;
    enlistedLowRankColumns: Record<string, string>;
  };
  combatArms: string[];
  combatArmEligibility?: {
    army?: string[];
    marines?: string[];
    commandoEntryRequires?: string;
  };
  combatArmResolution?: Record<string, string>;
  initialTraining: string[];
  enlistment: {
    army: { target: number; dms: Array<{ attribute: string; min: number; dm: number }>; startingRank: string };
    marines: { target: number; dms: Array<{ attribute: string; min: number; dm: number }>; startingRank: string };
    draft: { die: string; results: Record<string, string> };
  };
  commandDuty: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] };
  assignment: { columns: string[]; rows: Array<Record<string, number | string>> };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: string[];
    notes?: string[];
  }>;
  specialAssignments: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  specialAssignmentDetails?: Record<string, unknown>;
  combatAssignments?: string[];
  assignmentReroutes?: {
    marines?: { fromAssignments: string[]; toAssignment: string };
  };
  specialistSchool?: Record<string, unknown>;
  serviceSkills: { columns: string[]; rows: Array<Record<string, unknown>> };
  mos: { columns: string[]; rows: Array<Record<string, unknown>> };
  ranks: { enlisted: Array<[string, string]>; officer: Array<[string, string, number]> };
  reenlistment: {
    army: { target: number; dms: StructuredDm[] };
    marines: { target: number; dms: StructuredDm[] };
  };
}

function dataFor(ch: Character): MercenaryData {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) throw new Error("Mercenary pathway requires ACG data");
  return acg.mercenary as MercenaryData;
}

/** Enlistment: pick army or marines, roll vs target with attribute DMs.
 *  Failure → draft (1D, 2=Marines, 3=Army, anything else aborts mercenary).
 *  Successful enlistment commits to a 4-year term and combat arm selection. */
export function mercenaryEnlist(
  ch: Character,
  service: "army" | "marines",
  combatArm: string,
): void {
  const data = dataFor(ch);
  // Combat-arm entry restrictions per manual p. 50:
  //   - Army characters may select any combat arm except Commando.
  //   - Marine characters may select only Infantry or Support.
  //   - Commando entry is gated to Military Academy honors graduates,
  //     regardless of service.
  const elig = data.combatArmEligibility as undefined | {
    army?: string[];
    marines?: string[];
    armGates?: Record<string, { honorsGraduateOf?: string; errorMessage?: string }>;
  };
  if (elig) {
    const armGate = elig.armGates?.[combatArm];
    if (armGate?.honorsGraduateOf) {
      const honors = ch.requireAcgState().honorsGraduations ?? [];
      if (!honors.includes(armGate.honorsGraduateOf)) {
        throw new Error(
          armGate.errorMessage ?? `Combat arm "${combatArm}" gated by ${armGate.honorsGraduateOf} honors.`,
        );
      }
    } else {
      const allowedByService = elig[service as "army" | "marines"] ?? null;
      if (allowedByService && !allowedByService.includes(combatArm)) {
        throw new Error(
          `${service === "army" ? "Army" : "Marines"} cannot enter combat arm "${combatArm}" ` +
          `(allowed: ${allowedByService.join(", ")}); see PM p. 50.`,
        );
      }
    }
  }
  ch.requireAcgState().combatArm = combatArm;
  ch.requireAcgState().branch = service === "army" ? "Army" : "Marines";

  const svcLabel = `${service === "army" ? "Army" : "Marines"} (${combatArm})`;
  // Academy/OTC graduates skip the enlistment roll — they are automatically
  // enlisted at the rank set by pre-career (O1 for Military Academy or OTC).
  if (ch.requireAcgState().preCareerCommission) {
    ch.log(ev.enlistmentAttempt(`${svcLabel} (academy/OTC)`, 0, 0, 0, true));
    return;
  }

  const enlistSpec = data.enlistment[service];
  let dm = 0;
  for (const d of enlistSpec.dms) {
    const attr = d.attribute as keyof typeof ch.attributes;
    if (ch.attributes[attr] >= d.min) dm += d.dm;
  }
  const r = roll(2);
  const succeeded = r + dm >= enlistSpec.target;
  ch.log(ev.enlistmentAttempt(svcLabel, r, dm, enlistSpec.target, succeeded));
  if (succeeded) {
    ch.requireAcgState().rankCode = enlistSpec.startingRank;
    ch.requireAcgState().isOfficer = enlistSpec.startingRank.startsWith("O");
    return;
  }

  // Failed enlistment → attempt draft.
  const draftRoll = roll(1);
  const drafted = data.enlistment.draft.results[String(draftRoll)];
  if (!drafted) {
    ch.log(ev.enlistmentAttempt(
      "mercenary", 0, 0, 0, false,
      "draft did not assign mercenary service",
    ));
    throw new Error("Mercenary draft rejection — choose another path");
  }
  ch.drafted = true;
  const draftedService = drafted.toLowerCase() as "army" | "marines";
  const draftSpec = data.enlistment[draftedService];
  ch.log(ev.drafted(drafted));
  ch.requireAcgState().branch = drafted;
  ch.requireAcgState().rankCode = draftSpec.startingRank;
  ch.requireAcgState().isOfficer = false; // drafted = enlisted; no OCS first term
}

/** Initial training: first year of term 1. The first entry in
 *  data.initialTraining names a fixed skill awarded at level 1; the
 *  remaining entries trigger one roll on the MOS table for the chosen
 *  combat arm. Per manual p. 51: homeworld Avg Stellar+ grants DM +1
 *  on the MOS roll (better tech base → better-trained troopers). */
export function mercenaryInitialTraining(ch: Character): void {
  const data = dataFor(ch);
  const fixed = data.initialTraining[0];
  if (fixed) {
    ch.addSkill(fixed, 1, "Initial Training");
  }

  const acg = ch.requireMercenaryAcg();
  const armKey = labelToColumnKey(acg.combatArm);
  let dm = 0;
  const hwTech = ch.homeworld?.tech;
  if (hwTech === "Avg Stellar" || hwTech === "High Stellar") dm += 1;
  const r = Math.max(1, Math.min(7, roll(1) + dm));
  const row = data.mos.rows.find((row) => row.die === r);
  if (!row) throw new Error(`MOS table missing row for die=${r}`);
  const mosSkill = row[armKey] as string | undefined;
  if (!mosSkill) {
    throw new Error(`MOS table missing column "${armKey}" for combat arm "${acg.combatArm}"`);
  }
  acg.mos = mosSkill;
  ch.addSkill(mosSkill, 1, "MOS");
}

/** Officer command-duty roll. Success places officer in command position,
 *  failure (or opting out) → staff position. Combat arm + service
 *  determine the target. */
export function mercenaryCommandDuty(ch: Character): void {
  if (!ch.requireAcgState().isOfficer) {
    ch.requireAcgState().inCommand = false;
    return;
  }
  const data = dataFor(ch);
  const acg = ch.requireMercenaryAcg();
  const arm = acg.combatArm;
  const svc = (acg.branch === "Marines" ? "marines" : "army");
  const row = data.commandDuty.rows.find((r) => r.branch === arm);
  if (!row) {
    ch.requireAcgState().inCommand = false;
    return;
  }
  const parsed = parseResolutionTarget(row[svc]);
  if (parsed.target === "auto") {
    ch.requireAcgState().inCommand = true;
    return;
  }
  if (parsed.target === "none" || typeof parsed.target !== "number") {
    ch.requireAcgState().inCommand = false;
    return;
  }
  const dm = applyDmRules(data.commandDuty.dms, ch, "promotion"); // DMs apply by rule strings
  const r = roll(2);
  const success = r + dm >= parsed.target;
  ch.log(ev.commandDuty(success, r, dm, parsed.target));
  ch.requireAcgState().inCommand = success;
}

/** Roll the year's assignment. Returns the assignment label (e.g., "Raid"). */
export function mercenaryRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  if (acg.justRetained && acg.retainedAssignment) {
    const retained = acg.retainedAssignment;
    acg.justRetained = false;
    acg.retainedAssignment = null;
    // Runner emits ev.assignmentRolled with retained=true (captured before
    // this pathway clears the flag).
    return retained;
  }
  const armKey = labelToColumnKey(acg.combatArm!);
  const r = roll(2);
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Mercenary assignment table missing row for die=${r}`);
  let assignment = row[armKey] as string | undefined;
  if (!assignment) {
    throw new Error(`Mercenary assignment column "${armKey}" missing for combat arm`);
  }
  // Apply per-service reroutes from JSON (Marines: counterinsurgency/internal
  // security become Ship's Troops, per manual p. 48).
  const branchKey = ch.requireAcgState().branch === "Marines" ? "marines" : null;
  const reroute = branchKey ? data.assignmentReroutes?.[branchKey] : undefined;
  if (reroute && reroute.fromAssignments.includes(assignment)) {
    assignment = reroute.toAssignment;
  }
  return assignment;
}

// Pathway phase ordering and per-phase parameters come from JSON
// (data.advancedCharacterGeneration.mercenary.resolveAssignment). The TS
// registry below provides the named callbacks the JSON references.
const MERCENARY_CALLBACKS: PathwayCallbacks = {
  promoteMercenary: (ctx) => promoteMercenary(ctx.ch),
  rollMercenarySkill: (ctx) => rollMercenarySkill(ctx.ch),
  mercenaryFinalize: (ctx) => {
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

/** Lazy-built PathwaySpec, cached per edition. The build pulls the
 *  JSON config + callback registry. */
const SPEC_CACHE = new Map<string, PathwaySpec>();
/** Drop cached PathwaySpecs. Required when edition JSON is reloaded
 *  (tests, hot-reload) so the next resolveAssignment rebuilds from the
 *  updated config and callback registry. */
export function clearMercenarySpecCache(): void {
  SPEC_CACHE.clear();
}
/** Build (and discard) the PathwaySpec for an edition. Surfaces missing
 *  callback names or malformed phase configs at edition load instead of
 *  at first ACG run. No-op if the edition doesn't declare a mercenary
 *  block or resolveAssignment config. */
export function validateMercenaryConfig(editionId: string): void {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) return;
  const data = acg.mercenary as (MercenaryData & {
    resolveAssignment?: ResolveAssignmentConfig;
  }) | undefined;
  if (!data?.resolveAssignment) return;
  buildPathwaySpecFromConfig(data.resolveAssignment, MERCENARY_CALLBACKS, {
    combatAssignments: () => data.combatAssignments ?? [],
  });
}
function getSpec(ch: Character): PathwaySpec {
  let spec = SPEC_CACHE.get(ch.editionId);
  if (spec) return spec;
  const data = dataFor(ch);
  const config = (data as MercenaryData & {
    resolveAssignment?: ResolveAssignmentConfig;
  }).resolveAssignment;
  if (!config) {
    throw new Error(
      `Edition "${ch.editionId}" mercenary block is missing resolveAssignment ` +
      `config — add it to data/editions/${ch.editionId}.json`,
    );
  }
  spec = buildPathwaySpecFromConfig(config, MERCENARY_CALLBACKS, {
    combatAssignments: (c) => dataFor(c).combatAssignments ?? [],
  });
  SPEC_CACHE.set(ch.editionId, spec);
  return spec;
}

/** Resolve one assignment via the JSON-driven phase runner. */
export function mercenaryResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  const acg = ch.requireMercenaryAcg();
  const arm = acg.combatArm;
  const resKey = data.combatArmResolution?.[arm] ?? "commando";
  const resTable = data.assignmentResolution[resKey];
  if (!resTable) throw new Error(`Resolution sub-table "${resKey}" missing for mercenary`);

  // Garrison-style escape: assignments not in resTable.columns survive
  // with no decoration or skills.
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    resetIfComplete(ch);
    applyOnce(ch, "garrisonRecorded", () => {
      ch.log(ev.raw(
        `${assignment}: garrison-style — automatic survival, no rewards`,
        "verbose",
      ));
      ch.requireAcgState().assignmentHistory.push(assignment);
    });
    markComplete(ch);
    return;
  }
  const res = lookupResolution(resTable, assignment);

  // decorationDmStrategy maps to survival/decoration DM offsets. Negative
  // strategy = take -N on survival, +N on decoration.
  const decStrategy = ch.requireAcgState().decorationDmStrategy;
  const survivalDmFromStrategy = -Math.abs(decStrategy) * Math.sign(decStrategy === 0 ? 0 : -decStrategy);
  const dms = {
    survival: applyDmRules(resTable.dms, ch, "survival") + survivalDmFromStrategy,
    decoration: applyDmRules(resTable.dms, ch, "decoration")
      + Math.abs(decStrategy) * (decStrategy < 0 ? 1 : -1),
    promotion: applyDmRules(resTable.dms, ch, "promotion"),
    skills: applyDmRules(resTable.dms, ch, "skills"),
  };
  runPhases(getSpec(ch), { ch, assignment, resTable, res, dms });
}

/** Roll one skill from a column appropriate for current rank/duty.
 *  Column selection per manual p. 51:
 *    E1-E2: armyLife/marineLife
 *    E3-E9 enlisted: ncoSkills
 *    O1+ with command duty: commandSkills
 *    O1+ without command duty: staffSkills
 *    Marines currently on Ship's Troops: shipboard
 *  In interactive mode the player may pick across all rank-eligible
 *  columns (e.g. an NCO may always elect armyLife instead of ncoSkills). */
function rollMercenarySkill(ch: Character): void {
  // Ship's Troops takes precedence for Marines (manual: ship-troops column
  // is available to Marines on Ship's Troops assignment regardless of rank).
  // The "Ship's Troops" label comes from JSON's assignmentReroutes.marines
  // toAssignment so the string lives in one place.
  const data = dataFor(ch);
  const shipsTroopsLabel = data.assignmentReroutes?.marines?.toAssignment ?? "Ship's Troops";
  if (ch.requireAcgState().branch === "Marines" &&
      ch.requireAcgState().currentAssignment === shipsTroopsLabel) {
    rollMercenarySkillFromColumn(ch, "shipboard");
    return;
  }
  if (ch.choiceMode === "interactive") {
    const options = mercenaryAvailableSkillColumns(ch);
    if (options.length > 1) {
      ch.pickOrDefer({
        kind: "skillTable",
        label: "Choose a service-skills column to roll on",
        options,
        onResolve: (c, col) => rollMercenarySkillFromColumn(c, col),
      });
      return;
    }
  }
  const col = mercenaryDefaultSkillColumn(ch);
  rollMercenarySkillFromColumn(ch, col);
}

function mercenaryDefaultSkillColumn(ch: Character): string {
  // Per JSON skillColumnPolicy (PM p. 51 line 3194-3196).
  const data = dataFor(ch);
  const pol = data.skillColumnPolicy;
  if (!pol) return "ncoSkills";
  if (ch.requireAcgState().isOfficer) {
    return ch.requireAcgState().inCommand ? pol.officerInCommand : pol.officerStaff;
  }
  // Enlisted: rank below the NCO threshold uses Army/Marine Life column.
  const rank = ch.requireAcgState().rankCode;
  const enlistedNum = parseInt(rank.replace(/[^\d]/g, ""), 10) || 0;
  const ncoMin = parseInt(pol.enlistedNcoMinRank.replace(/[^\d]/g, ""), 10) || 3;
  if (enlistedNum < ncoMin) {
    const branch = ch.requireAcgState().branch ?? "";
    return pol.enlistedLowRankColumns[branch] ?? pol.enlistedLowRankColumns["army"] ?? "armyLife";
  }
  return pol.enlistedNcoColumn;
}

function mercenaryAvailableSkillColumns(ch: Character): string[] {
  const cols: string[] = [];
  const lifeCol = ch.requireAcgState().branch === "Marines" ? "marineLife" : "armyLife";
  cols.push(lifeCol);
  const rankNum = parseInt(ch.requireAcgState().rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if (!ch.requireAcgState().isOfficer && rankNum >= 3) cols.push("ncoSkills");
  if (ch.requireAcgState().isOfficer) {
    if (ch.requireAcgState().inCommand) cols.push("commandSkills");
    else cols.push("staffSkills");
  }
  if (ch.requireAcgState().branch === "Marines") cols.push("shipboard");
  return cols;
}

function rollMercenarySkillFromColumn(ch: Character, col: string): void {
  const data = dataFor(ch);
  const r = roll(1);
  const row = data.serviceSkills.rows.find((row) => row.die === r);
  if (!row) return;
  const skill = row[col] as string | undefined;
  if (!skill) return;
  applyAcgSkillCell(ch, skill, `mercenary ${col}`);
}


/** Advance the rank by one step per the pathway's rank ladder. */
function promoteMercenary(ch: Character): void {
  const data = dataFor(ch);
  if (ch.requireAcgState().isOfficer) {
    const codes = data.ranks.officer.map((r) => r[0]);
    const idx = codes.indexOf(ch.requireAcgState().rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.requireAcgState().rankCode = codes[idx + 1]!;
      ch.requireAcgState().promotedThisTerm = true;
      ch.log(ev.promoted(data.ranks.officer[idx + 1]![1]));
    }
  } else {
    const codes = data.ranks.enlisted.map((r) => r[0]);
    const idx = codes.indexOf(ch.requireAcgState().rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.requireAcgState().rankCode = codes[idx + 1]!;
      ch.log(ev.promoted(data.ranks.enlisted[idx + 1]![1]));
    }
  }
}

/** Special Assignment table — replaces the normal assignment when the
 *  assignment roll yields "Special Duty". Routes through the schools
 *  module which applies the school's specific skill awards. */
export function mercenarySpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  const col = ch.requireAcgState().isOfficer ? "officer" : "enlisted";
  const dm = applyStructuredDms(data.specialAssignments.dms, ch);
  const rollOnce = (): string | null => {
    const r = Math.max(1, Math.min(7, roll(1) + dm));
    const row = data.specialAssignments.rows.find((row) => row.die === r);
    return (row?.[col] as string | undefined) ?? null;
  };
  let sa = rollOnce();
  if (!sa) return;
  // OCS age limit (PM p. 51 line 3188): age cap and waiver-on-reroll
  // come from mercenary.ocsAdvancement.ageLimit in JSON.
  const ocsAgeLimit = data.ocsAdvancement?.ageLimit;
  if (sa === "OCS" && ocsAgeLimit !== undefined && ch.age > ocsAgeLimit) {
    const reroll = rollOnce();
    if (reroll === "OCS") {
      ch.log(ev.statusChange(
        "ocsWaiver", `over age ${ocsAgeLimit}, waiver granted on reroll`,
      ));
    } else if (reroll) {
      sa = reroll;
    } else {
      return;
    }
  }
  applyMercenarySchool(ch, sa);
}

/** Retention is Navy-only in MT. Kept as a no-op for back-compat with the
 *  pathway impl interface. */
export function mercenaryRetention(ch: Character, _assignment: string): void {
  if (ch.acgState) {
    ch.acgState.justRetained = false;
    ch.acgState.retainedAssignment = null;
  }
}

/** Reenlistment per service. Returns true if continuing.
 *  Manual p. 51 DMs are sourced from JSON (mercenary.reenlistment.*.dms)
 *  and evaluated via the shared structured-DM evaluator. */
export function mercenaryReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const svc = ch.requireAcgState().branch === "Marines" ? "marines" : "army";
  const spec = data.reenlistment[svc];
  const dm = applyStructuredDms(spec.dms, ch);
  const r = roll(2);
  const keep = r + dm >= spec.target;
  ch.log(ev.roll("Reenlistment", r, dm, spec.target, keep, `mercenary ${svc}`));
  if (r === 12) {
    ch.enterMandatoryReenlist();
    offerArmChange(ch, data);
    return true;
  }
  if (keep) offerArmChange(ch, data);
  return keep;
}

/** PM p. 49: combat arm change at reenlist.
 *  - Officers may change arms freely at the start of any 4-year term
 *    (except Commando — requires Commando School first).
 *  - Enlisted personnel must be cross-trained to change arm; reenlistment
 *    may specify an arm they have been cross-trained into.
 *  Auto mode: keep the current arm. Interactive mode: queue a choice. */
function offerArmChange(ch: Character, data: MercenaryData): void {
  if (!ch.acgState) return;
  const current = ch.acgState.combatArm ?? "Infantry";
  const arms = data.combatArms;
  const isOfficer = ch.acgState.isOfficer === true;
  const crossTrained = ch.acgState.crossTrainedArms ?? [];
  const commandoEligible =
    (ch.acgState.honorsGraduations ?? []).includes("militaryAcademy") ||
    crossTrained.includes("Commando");
  const eligibleArms = arms.filter((arm) => {
    if (arm === current) return true;
    if (arm === "Commando") return commandoEligible;
    if (isOfficer) return true;
    return crossTrained.includes(arm);
  });
  if (eligibleArms.length <= 1 || ch.choiceMode === "auto") return;
  ch.pickOrDefer({
    kind: "cascade",
    label: `Change combat arm for next term (current: ${current})`,
    options: eligibleArms,
    preferred: [current],
    context: { source: "reenlist", reenlistChangeArm: true },
    onResolve: (c, chosen) => {
      if (chosen !== current && c.acgState) {
        c.acgState.combatArm = chosen;
        c.log(ev.transferred(
          chosen, "combatArm", current, "reenlist (via cross-training)",
        ));
      }
    },
  });
}

/** Hook called by the runner before per-term processing.
 *  Resets per-term Mercenary-specific flags:
 *    - injuredThisYear (per-year, but cleared here as a safety net)
 *    - decorationDmStrategy (player's tradeoff applies for one assignment;
 *      reset between terms so a stale value doesn't leak forward).
 *    - examDm and effectiveRankCode are merchant-only but harmless to clear.
 *  The shared runner clears year/promotedThisTerm before each term; this
 *  hook adds the Mercenary-specific bookkeeping. */
export function mercenaryStartOfTerm(ch: Character): void {
  if (!ch.acgState) return;
  ch.acgState.injuredThisYear = false;
  ch.acgState.decorationDmStrategy = 0;
}

export function getMercenaryPathway() {
  return {
    pathway: PATHWAY,
    enlist: mercenaryEnlist,
    initialTraining: mercenaryInitialTraining,
    commandDuty: mercenaryCommandDuty,
    rollAssignment: mercenaryRollAssignment,
    resolveAssignment: mercenaryResolveAssignment,
    specialAssignment: mercenarySpecialAssignment,
    retention: mercenaryRetention,
    reenlist: mercenaryReenlist,
    startOfTerm: mercenaryStartOfTerm,
  };
}

// re-export for compatibility
export type { AcgState, ResolutionTarget };
