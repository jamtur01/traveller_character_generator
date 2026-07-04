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

import type { Character } from "@/lib/traveller/character";
import { getAcgPathway } from "@/lib/traveller/editions";
import {
  applyDmRules, labelToColumnKey, lookupResolution, parseResolutionTarget,
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import { applyMercenarySchool } from "@/lib/traveller/engine/acg/schools";
import { alreadyApplied, markApplied } from "@/lib/traveller/engine/acg/subStepCache";
import { requireRule } from "@/lib/traveller/editions/strict";
import type { AssignmentResolution } from "@/lib/traveller/engine/acg/state";
import { runPhases, type PathwaySpec } from "@/lib/traveller/engine/acg/phaseRunner";
import { type PathwayCallbacks } from "@/lib/traveller/engine/acg/jsonPhases";
import {
  createPathwaySpecRegistry, resetCombatTermFlags, combatFinalize,
  combatResolutionDms, rollSpecialAssignment, runReenlist, offerRoleChange,
  applyPromotion, serviceSkillColumnFor, clearRetention,
  consumeRetainedAssignment, rollDieRowOrThrow, rollSkillFromColumn,
  resolveCommandDuty, type SkillColumnPolicy,
} from "./shared";
import { event as ev } from "@/lib/traveller/history";
import { rankNum } from "@/lib/traveller/engine/predicate";
import { evaluateDM } from "@/lib/traveller/engine/dmEvaluator";

const PATHWAY = "mercenary";

export interface MercenaryData {
  ocsAdvancement?: { ageLimit?: number; [k: string]: unknown };
  skillColumnPolicy?: SkillColumnPolicy;
  combatArms: string[];
  combatArmEligibility?: {
    army?: string[];
    marines?: string[];
    /** Per-arm gates. PM p. 50: Commando requires Military Academy
     *  honors graduate. Key = arm name; value = predicate.
     *  honorsGraduateOf names the required pre-career school option. */
    armGates?: Record<string, {
      honorsGraduateOf?: string;
      errorMessage?: string;
    }>;
  };
  combatArmResolution?: Record<string, string>;
  initialTraining: string[];
  enlistment: {
    army: { target: number; dms: Array<{ attribute: string; min: number; dm: number }>; startingRank: string };
    marines: { target: number; dms: Array<{ attribute: string; min: number; dm: number }>; startingRank: string };
    draft: { die: string; results: Record<string, string> };
  };
  commandDuty: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  assignment: { columns: string[]; rows: Array<Record<string, number | string>> };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
    notes?: string[];
  } | GarrisonResolution>;
  specialAssignments: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  specialAssignmentDetails?: Record<string, unknown>;
  combatAssignments?: string[];
  assignmentReroutes?: {
    marines?: { fromAssignments: string[]; toAssignment: string };
  };
  specialistSchool?: Record<string, unknown>;
  serviceSkills: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  mos: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  ranks: { enlisted: Array<[string, string]>; officer: Array<[string, string, number]> };
  reenlistment: {
    army: { target: number; dms: StructuredDm[] };
    marines: { target: number; dms: StructuredDm[] };
  };
}

function dataFor(ch: Character): MercenaryData {
  const data = getAcgPathway(ch.editionId, "mercenary");
  if (!data) throw new Error("Mercenary pathway requires ACG data");
  return data;
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
  ch.requireMercenaryAcg().combatArm = combatArm;
  ch.requireMercenaryAcg().branch = service === "army" ? "Army" : "Marines";

  const svcLabel = `${service === "army" ? "Army" : "Marines"} (${combatArm})`;
  // Academy/OTC graduates skip the enlistment roll — they are automatically
  // enlisted at the rank set by pre-career (O1 for Military Academy or OTC).
  const acg = ch.requireAcgState();
  if (acg.preCareerCommission) {
    ch.log(ev.enlistmentAttempt(`${svcLabel} (academy/OTC)`, 0, 0, 0, true));
    return;
  }

  const enlistSpec = data.enlistment[service];
  const dm = evaluateDM(enlistSpec.dms, { attributes: ch.attributes, terms: ch.terms });
  const r = ch.rng.roll(2);
  const succeeded = r + dm >= enlistSpec.target;
  ch.log(ev.enlistmentAttempt(svcLabel, r, dm, enlistSpec.target, succeeded));
  if (succeeded) {
    acg.rankCode = enlistSpec.startingRank;
    acg.isOfficer = enlistSpec.startingRank.startsWith("O");
    return;
  }

  // Failed enlistment → attempt draft.
  const draftRoll = ch.rng.roll(1);
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
  ch.requireMercenaryAcg().branch = drafted;
  acg.rankCode = draftSpec.startingRank;
  acg.isOfficer = false; // drafted = enlisted; no OCS first term
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
  const armKey = labelToColumnKey(acg.combatArm!);
  // PM p. 51: homeworld tech DM (+1 at Avg Stellar+) lives in data.mos.dms
  // as a StructuredDm (homeworldTechAtLeast); evaluate it here.
  const dm = applyDmRules(data.mos.dms, ch, "skills");
  const row = rollDieRowOrThrow(ch, data.mos, { dice: 1, dm }, "MOS");
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
  const acg = ch.requireMercenaryAcg();
  if (!acg.isOfficer) {
    acg.inCommand = false;
    return;
  }
  const data = dataFor(ch);
  resolveCommandDuty(ch, {
    rows: data.commandDuty.rows,
    role: acg.combatArm!,
    cellKey: acg.branch === "Marines" ? "marines" : "army",
    dm: applyDmRules(data.commandDuty.dms, ch, "promotion"),
  });
}

/** Roll the year's assignment. Returns the assignment label (e.g., "Raid"). */
export function mercenaryRollAssignment(ch: Character): string {
  const acg = ch.requireMercenaryAcg();
  const data = dataFor(ch);
  const retained = consumeRetainedAssignment(acg);
  if (retained) return retained;
  const armKey = labelToColumnKey(acg.combatArm!);
  const r = ch.rng.roll(2);
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Mercenary assignment table missing row for die=${r}`);
  let assignment = row[armKey] as string | undefined;
  if (!assignment) {
    throw new Error(`Mercenary assignment column "${armKey}" missing for combat arm`);
  }
  // Apply per-service reroutes from JSON (Marines: counterinsurgency/internal
  // security become Ship's Troops, per manual p. 48).
  const branchKey = acg.branch === "Marines" ? "marines" : null;
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
  mercenaryFinalize: (ctx) =>
    combatFinalize(ctx, dataFor(ctx.ch).combatAssignments ?? []),
};

const REGISTRY = createPathwaySpecRegistry<MercenaryData>({
  pathwayKey: "mercenary",
  callbacks: MERCENARY_CALLBACKS,
  combatAssignments: (data) => data.combatAssignments ?? [],
});
export const validateMercenaryConfig = REGISTRY.validate;
function getMercenarySpec(ch: Character): PathwaySpec { return REGISTRY.get(ch); }

/** PM p. 49 Garrison Duty resolution (assignmentResolution.garrisonDuty):
 *  applies to assignments with no column on the combat-arm sub-table. */
interface GarrisonResolution {
  survival: string;
  decoration: string;
  skills: string;
  enlistedPromotion: string;
}

/** Resolve one assignment via the JSON-driven phase runner. */
export function mercenaryResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  const acg = ch.requireMercenaryAcg();
  const arm = acg.combatArm!;
  const resKey = requireRule(
    data.combatArmResolution?.[arm],
    `acg.mercenary.combatArmResolution["${arm}"]`, "PM p. 49",
  );
  const resTable = data.assignmentResolution[resKey];
  if (!resTable || !("columns" in resTable)) {
    throw new Error(`Resolution sub-table "${resKey}" missing for mercenary`);
  }

  // PM p. 49: assignments without a column on the combat-arm sub-table
  // (e.g. Garrison, Training) resolve on the Garrison Duty row instead:
  // automatic survival, no decoration or skills, enlisted promotion 7+.
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    const rawGarrison = data.assignmentResolution["garrisonDuty"];
    const garrison = requireRule(
      rawGarrison && !("columns" in rawGarrison) ? rawGarrison : undefined,
      "acg.mercenary.assignmentResolution.garrisonDuty", "PM p. 49",
    );
    const res: AssignmentResolution = {
      survival: parseResolutionTarget(garrison.survival).target,
      decoration: parseResolutionTarget(garrison.decoration).target,
      promotion: parseResolutionTarget(garrison.enlistedPromotion).target,
      skills: parseResolutionTarget(garrison.skills).target,
      // The garrison promotion throw is enlisted-only ("enlistedPromotion");
      // the phase runner's officer gate enforces it.
      promotionOfficersBarred: true,
    };
    // The garrisonDuty row declares no DM rules; decorationDmStrategy is
    // moot (survival auto, decoration none) and promotion takes no DM.
    runPhases(getMercenarySpec(ch), {
      ch, assignment, resTable, res,
      dms: { survival: 0, decoration: 0, promotion: 0, skills: 0 },
    });
    return;
  }
  const res = lookupResolution(resTable, assignment);

  const dms = combatResolutionDms(ch, resTable);
  runPhases(getMercenarySpec(ch), { ch, assignment, resTable, res, dms });
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
  // Both the assignment label and the column it maps to are strict-read
  // from JSON (assignmentReroutes.marines.toAssignment /
  // skillColumnPolicy.shipsTroopsColumn) so each lives in one place.
  const data = dataFor(ch);
  const shipsTroopsLabel = requireRule(
    data.assignmentReroutes?.marines?.toAssignment,
    "acg.mercenary.assignmentReroutes.marines.toAssignment", "PM p. 48",
  );
  if (ch.requireMercenaryAcg().branch === "Marines" &&
      ch.requireAcgState().currentAssignment === shipsTroopsLabel) {
    rollMercenarySkillFromColumn(ch, requireRule(
      data.skillColumnPolicy?.shipsTroopsColumn,
      "acg.mercenary.skillColumnPolicy.shipsTroopsColumn", "PM p. 51",
    ));
    return;
  }
  if (ch.choiceMode === "interactive") {
    const options = mercenaryAvailableSkillColumns(ch);
    if (options.length > 1) {
      // Re-entry guard: pickOrDefer throws ChoicePendingError, so the
      // enclosing applyOnce("skills-applied") only marks after this fn
      // returns cleanly. Without the gate, the resumed pass re-enters here
      // and re-queues the identical prompt forever (one skill per resolve).
      if (alreadyApplied(ch, "mercSkillColumn-prompted")) return;
      markApplied(ch, "mercSkillColumn-prompted");
      ch.pickOrDefer({
        kind: "skillTable",
        label: "Choose a service-skills column to roll on",
        options,
        onResolve: (ch, col) => rollMercenarySkillFromColumn(ch, col),
      });
      return;
    }
  }
  const col = serviceSkillColumnFor(ch, dataFor(ch).skillColumnPolicy);
  rollMercenarySkillFromColumn(ch, col);
}

function mercenaryAvailableSkillColumns(ch: Character): string[] {
  const pol = requireRule(
    dataFor(ch).skillColumnPolicy,
    "acg.mercenary.skillColumnPolicy", "PM p. 51",
  );
  const branch = ch.requireMercenaryAcg().branch;
  const cols: string[] = [requireRule(
    pol.enlistedLowRankColumns[branch],
    `acg.mercenary.skillColumnPolicy.enlistedLowRankColumns["${branch}"]`,
    "PM p. 51",
  )];
  const acg = ch.requireAcgState();
  if (!acg.isOfficer && rankNum(acg.rankCode) >= rankNum(pol.enlistedNcoMinRank)) {
    cols.push(pol.enlistedNcoColumn);
  }
  if (acg.isOfficer) {
    cols.push(acg.inCommand ? pol.officerInCommand : pol.officerStaff);
  }
  if (branch === "Marines") {
    cols.push(requireRule(
      pol.shipsTroopsColumn,
      "acg.mercenary.skillColumnPolicy.shipsTroopsColumn", "PM p. 51",
    ));
  }
  return cols;
}

function rollMercenarySkillFromColumn(ch: Character, col: string): void {
  rollSkillFromColumn(ch, dataFor(ch).serviceSkills, col, `mercenary ${col}`);
}


/** Advance the rank by one step per the pathway's rank ladder. */
function promoteMercenary(ch: Character): void {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  const ladder = acg.isOfficer ? data.ranks.officer : data.ranks.enlisted;
  applyPromotion(ch, ladder);
}

/** Special Assignment table — replaces the normal assignment when the
 *  assignment roll yields "Special Duty". Routes through the schools
 *  module which applies the school's specific skill awards. */
export function mercenarySpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  const sa = rollSpecialAssignment(ch, data.specialAssignments, data.ocsAdvancement?.ageLimit);
  if (sa) applyMercenarySchool(ch, sa);
}

/** Reenlistment per service. Returns true if continuing.
 *  Manual p. 51 DMs are sourced from JSON (mercenary.reenlistment.*.dms)
 *  and evaluated via the shared structured-DM evaluator. */
export function mercenaryReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const svc = ch.requireMercenaryAcg().branch === "Marines" ? "marines" : "army";
  const spec = data.reenlistment[svc];
  return runReenlist(ch, {
    target: spec.target,
    dms: spec.dms,
    label: `mercenary ${svc}`,
    onContinue: () => offerArmChange(ch, data),
  });
}

/** PM p. 49: combat arm change at reenlist.
 *  - Officers may change arms freely at the start of any 4-year term
 *    (except Commando — requires Commando School first).
 *  - Enlisted personnel must be cross-trained to change arm; reenlistment
 *    may specify an arm they have been cross-trained into.
 *  Auto mode: keep the current arm. Interactive mode: queue a choice. */
function offerArmChange(ch: Character, data: MercenaryData): void {
  const acg = ch.acgState;
  if (acg?.pathway !== "mercenary") return;
  const current = acg.combatArm;
  if (!current) {
    throw new Error(
      "Mercenary combat arm is unset — enlistment must assign it before " +
      "a reenlistment arm change (PM p. 49)",
    );
  }
  const isOfficer = acg.isOfficer === true;
  const crossTrained = acg.crossTrainedArms ?? [];
  const honors = acg.honorsGraduations ?? [];
  // PM p. 50: some arms (Commando) are gated behind an honors graduation;
  // the gate lives in JSON (combatArmEligibility.armGates.<arm>.honorsGraduateOf).
  const armGates = data.combatArmEligibility?.armGates ?? {};
  const eligibleArms = data.combatArms.filter((arm) => {
    if (arm === current) return true;
    const gate = armGates[arm]?.honorsGraduateOf;
    if (gate) return honors.includes(gate) || crossTrained.includes(arm);
    if (isOfficer) return true;
    return crossTrained.includes(arm);
  });
  offerRoleChange(ch, {
    current,
    options: eligibleArms,
    label: `Change combat arm for next term (current: ${current})`,
    context: { source: "reenlist", reenlistChangeArm: true },
    apply: (ch, chosen) => {
      const acg = ch.acgState;
      if (acg?.pathway !== "mercenary") return;
      acg.combatArm = chosen;
      ch.log(ev.transferred(chosen, "combatArm", current, "reenlist (via cross-training)"));
    },
  });
}

/** Per-term reset shared with navy — see resetCombatTermFlags. */
export const mercenaryStartOfTerm = resetCombatTermFlags;

export function getMercenaryPathway() {
  return {
    pathway: PATHWAY,
    enlist: mercenaryEnlist,
    initialTraining: mercenaryInitialTraining,
    commandDuty: mercenaryCommandDuty,
    rollAssignment: mercenaryRollAssignment,
    resolveAssignment: mercenaryResolveAssignment,
    specialAssignment: mercenarySpecialAssignment,
    retention: clearRetention,
    reenlist: mercenaryReenlist,
    startOfTerm: mercenaryStartOfTerm,
  };
}
