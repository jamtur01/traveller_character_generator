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
  parseResolutionTarget, rollVsTarget,
  type StructuredDm,
} from "../tables";
import { awardDecoration, resolveDecorationTier, runCourtMartial } from "../awards";
import { tryMitigate } from "../browniePoints";
import { applyMercenarySchool } from "../schools";
import { event as ev } from "../../../history";
import type { AcgState, ResolutionTarget } from "../types";

const PATHWAY = "mercenary";

interface MercenaryData {
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
      const honors = ch.acgState!.honorsGraduations ?? [];
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
  ch.acgState!.combatArm = combatArm;
  ch.acgState!.branch = service === "army" ? "Army" : "Marines";

  // Academy/OTC graduates skip the enlistment roll — they are automatically
  // enlisted at the rank set by pre-career (O1 for Military Academy or OTC).
  if (ch.acgState!.preCareerCommission) {
    ch.logRaw(
      `Auto-enlisted in the ${service === "army" ? "Army" : "Marines"} (${combatArm}) as ${ch.acgState!.rankCode} (academy/OTC).`,
    );
    return;
  }

  const enlistSpec = data.enlistment[service];
  let dm = 0;
  for (const d of enlistSpec.dms) {
    const attr = d.attribute as keyof typeof ch.attributes;
    if (ch.attributes[attr] >= d.min) dm += d.dm;
  }
  const r = roll(2);
  ch.logRaw(
    `Mercenary enlist (${service}, ${combatArm}): roll ${r} + ${dm} vs ${enlistSpec.target}`,
  "verbose");

  if (r + dm >= enlistSpec.target) {
    ch.logRaw(`Enlisted in the ${service === "army" ? "Army" : "Marines"} (${combatArm}).`);
    ch.acgState!.rankCode = enlistSpec.startingRank;
    ch.acgState!.isOfficer = enlistSpec.startingRank.startsWith("O");
    return;
  }

  // Failed enlistment → attempt draft.
  const draftRoll = roll(1);
  const drafted = data.enlistment.draft.results[String(draftRoll)];
  if (!drafted) {
    ch.logRaw("Enlistment failed; draft did not assign mercenary service.");
    throw new Error("Mercenary draft rejection — choose another path");
  }
  ch.drafted = true;
  const draftedService = drafted.toLowerCase() as "army" | "marines";
  const draftSpec = data.enlistment[draftedService];
  ch.logRaw(`Drafted into the ${drafted}.`);
  ch.acgState!.branch = drafted;
  ch.acgState!.rankCode = draftSpec.startingRank;
  ch.acgState!.isOfficer = false; // drafted = enlisted; no OCS first term
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
    ch.logRaw(`Initial Training: ${fixed}-1`);
    ch.addSkill(fixed, 1);
  }

  const armKey = labelToColumnKey(ch.acgState!.combatArm!);
  let dm = 0;
  const hwTech = ch.homeworld?.tech;
  if (hwTech === "Avg Stellar" || hwTech === "High Stellar") dm += 1;
  const r = Math.max(1, Math.min(7, roll(1) + dm));
  const row = data.mos.rows.find((row) => row.die === r);
  if (!row) throw new Error(`MOS table missing row for die=${r}`);
  const mosSkill = row[armKey] as string | undefined;
  if (!mosSkill) {
    throw new Error(`MOS table missing column "${armKey}" for combat arm "${ch.acgState!.combatArm}"`);
  }
  ch.acgState!.mos = mosSkill;
  ch.addSkill(mosSkill, 1);
  ch.logRaw(`MOS assigned: ${mosSkill}-1`);
}

/** Officer command-duty roll. Success places officer in command position,
 *  failure (or opting out) → staff position. Combat arm + service
 *  determine the target. */
export function mercenaryCommandDuty(ch: Character): void {
  if (!ch.acgState!.isOfficer) {
    ch.acgState!.inCommand = false;
    return;
  }
  const data = dataFor(ch);
  const arm = ch.acgState!.combatArm!;
  const svc = (ch.acgState!.branch === "Marines" ? "marines" : "army");
  const row = data.commandDuty.rows.find((r) => r.branch === arm);
  if (!row) {
    ch.acgState!.inCommand = false;
    return;
  }
  const parsed = parseResolutionTarget(row[svc]);
  if (parsed.target === "auto") {
    ch.acgState!.inCommand = true;
    return;
  }
  if (parsed.target === "none" || typeof parsed.target !== "number") {
    ch.acgState!.inCommand = false;
    return;
  }
  const dm = applyDmRules(data.commandDuty.dms, ch, "promotion"); // DMs apply by rule strings
  const r = roll(2);
  const success = r + dm >= parsed.target;
  ch.log(ev.commandDuty(success, r, dm, parsed.target));
  ch.acgState!.inCommand = success;
}

/** Roll the year's assignment. Returns the assignment label (e.g., "Raid"). */
export function mercenaryRollAssignment(ch: Character): string {
  const data = dataFor(ch);
  if (ch.acgState!.justRetained && ch.acgState!.retainedAssignment) {
    const retained = ch.acgState!.retainedAssignment;
    ch.acgState!.justRetained = false;
    ch.acgState!.retainedAssignment = null;
    ch.logRaw(`Assignment retained from previous year: ${retained}`, "verbose");
    return retained;
  }
  const armKey = labelToColumnKey(ch.acgState!.combatArm!);
  const r = roll(2);
  const row = data.assignment.rows.find((row) => row.die === r);
  if (!row) throw new Error(`Mercenary assignment table missing row for die=${r}`);
  let assignment = row[armKey] as string | undefined;
  if (!assignment) {
    throw new Error(`Mercenary assignment column "${armKey}" missing for combat arm`);
  }
  // Apply per-service reroutes from JSON (Marines: counterinsurgency/internal
  // security become Ship's Troops, per manual p. 48).
  const branchKey = ch.acgState!.branch === "Marines" ? "marines" : null;
  const reroute = branchKey ? data.assignmentReroutes?.[branchKey] : undefined;
  if (reroute && reroute.fromAssignments.includes(assignment)) {
    assignment = reroute.toAssignment;
  }
  return assignment;
}

/** Resolve one assignment (survival → decoration → promotion → skills).
 *  Updates Character state in place. */
export function mercenaryResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  const arm = ch.acgState!.combatArm ?? "Infantry";
  const resKey = data.combatArmResolution?.[arm] ?? "commando";
  const resTable = data.assignmentResolution[resKey];
  if (!resTable) throw new Error(`Resolution sub-table "${resKey}" missing for mercenary`);

  // Some assignments don't appear in resTable.columns (e.g., "Garrison",
  // "Ship's Troops" exist; "Special Duty" doesn't — that's handled in the
  // caller). Map the assignment label to a column key.
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    // Garrison Duty: per manual, characters survive with no decoration or
    // skills. Treat unrecognised assignments as garrison.
    ch.logRaw(`Garrison-style assignment "${assignment}": automatic survival, no rewards`, "verbose");
    ch.acgState!.assignmentHistory.push(assignment);
    return;
  }
  const res = lookupResolution(resTable, assignment);

  // Decoration DM strategy: player may take negative survival DM in
  // exchange for positive decoration DM. Interactive mode exposes the
  // choice before the assignment is resolved.
  if (ch.choiceMode === "interactive" &&
      res.decoration !== "none" &&
      typeof res.survival === "number" &&
      typeof res.decoration === "number") {
    promptDecorationDmTradeoff(ch);
  }
  const decStrategy = ch.acgState!.decorationDmStrategy;
  const survivalDmFromStrategy = -Math.abs(decStrategy) * Math.sign(decStrategy === 0 ? 0 : -decStrategy);
  // ^ negative strategy (e.g., -2) means apply -2 to survival and +2 to deco.

  const survDm = applyDmRules(resTable.dms, ch, "survival") + survivalDmFromStrategy;
  const decDm = applyDmRules(resTable.dms, ch, "decoration") + Math.abs(decStrategy) * (decStrategy < 0 ? 1 : -1);
  const promoDm = applyDmRules(resTable.dms, ch, "promotion");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");

  // --- Survival ---
  const sv = rollVsTarget(res.survival, survDm);
  ch.logRaw(
    `Mercenary ${assignment} survival: ${sv.roll}${survDm ? ` + ${survDm}` : ""} vs ${res.survival} → ${sv.success ? "survived" : "INJURED/INVALIDED"}`,
  "verbose");
  if (!sv.success) {
    // Try brownie-point mitigation before invaliding out. The onMitigated
    // callback (F16) reverses the muster-out if the player later spends
    // enough BPs via the interactive review prompt to push the margin to
    // ≥ 0. activeDuty toggles back to true on revival.
    const mit = tryMitigate(ch, {
      rollName: "survival",
      rollValue: sv.roll,
      dm: survDm,
      target: typeof res.survival === "number" ? res.survival : 0,
      margin: sv.margin,
      consequence: "Invalided out of mercenary service",
      onMitigated: (c) => {
        c.activeDuty = true;
        c.logRaw("Brownie-point spend revived character (survival saved).");
      },
    });
    if (mit.newMargin < 0) {
      ch.logRaw("Failed survival; invalided out of mercenary service.");
      ch.activeDuty = false;
      return;
    }
    // Survived via brownie point spending.
  }
  const combatAssignments = data.combatAssignments ?? [];
  if (sv.margin === 0 && typeof res.survival === "number") {
    // Survival rolled exactly: combat wound → Purple Heart (no BP).
    if (combatAssignments.includes(assignment)) {
      ch.acgState!.decorations.push("Purple Heart");
      ch.logRaw(`Wounded in ${assignment}; awarded Purple Heart.`);
      ch.acgState!.injuredThisYear = true;
    }
  }

  // PM p. 64 Mercenary checklist order: Survival → Promotion → Decoration
  // → Skills. (The prose at p. 49 lists "survival, decoration, promotion,
  // and skills" but the checklist on p. 64 is authoritative for resolution
  // order.) The order matters because promotion-conferred command status
  // can affect court-martial dm and a promotion may consume the term's
  // promote slot before a decoration triggers a court-martial roll.

  // --- Promotion ---
  if (res.promotion !== "none" &&
      !(ch.acgState!.isOfficer && res.promotionOfficersBarred) &&
      !(ch.acgState!.isOfficer && ch.acgState!.promotedThisTerm)) {
    const penalty = ch.acgState!.nextPromotionPenalty ?? 0;
    const effectiveDm = promoDm + penalty;
    if (penalty < 0) ch.acgState!.nextPromotionPenalty = 0; // consumed
    const pr = rollVsTarget(res.promotion, effectiveDm);
    ch.logRaw(
      `Mercenary ${assignment} promotion: ${pr.roll}${effectiveDm ? ` + ${effectiveDm}` : ""} vs ${res.promotion}` +
      (penalty ? ` (reprimand penalty ${penalty})` : ""),
    "verbose");
    let promoMargin = pr.margin;
    if (!pr.success) {
      const target = typeof res.promotion === "number" ? res.promotion : 0;
      const mit = tryMitigate(ch, {
        rollName: "promotion",
        rollValue: pr.roll,
        dm: effectiveDm,
        target,
        margin: pr.margin,
        consequence: "Earn promotion",
      });
      promoMargin = mit.newMargin;
    }
    if (promoMargin >= 0) promoteMercenary(ch);
  }

  // --- Decoration ---
  if (res.decoration !== "none") {
    const dec = rollVsTarget(res.decoration, decDm);
    ch.logRaw(
      `Mercenary ${assignment} decoration: ${dec.roll}${decDm ? ` + ${decDm}` : ""} vs ${res.decoration} → margin ${dec.margin}`,
    "verbose");
    let effMargin = dec.margin;
    if (dec.margin < 0) {
      const target = typeof res.decoration === "number" ? res.decoration : 0;
      const mit = tryMitigate(ch, {
        rollName: "decoration",
        rollValue: dec.roll,
        dm: decDm,
        target,
        margin: dec.margin,
        consequence: dec.margin <= -6
          ? "Avoid court-martial referral"
          : "Earn MCUF",
      });
      effMargin = mit.newMargin;
    }
    const tierAward = resolveDecorationTier(ch, effMargin);
    if (tierAward) awardDecoration(ch, tierAward);
    else if (effMargin <= -6) runCourtMartial(ch, assignment);
  }

  // --- Skills ---
  if (res.skills !== "none") {
    const sk = rollVsTarget(res.skills, skillDm);
    ch.logRaw(
      `Mercenary ${assignment} skills: ${sk.roll}${skillDm ? ` + ${skillDm}` : ""} vs ${res.skills}`,
    "verbose");
    let skMargin = sk.margin;
    if (!sk.success) {
      const target = typeof res.skills === "number" ? res.skills : 0;
      const mit = tryMitigate(ch, {
        rollName: "skills",
        rollValue: sk.roll,
        dm: skillDm,
        target,
        margin: sk.margin,
        consequence: "Earn a skill this assignment",
      });
      skMargin = mit.newMargin;
    }
    if (skMargin >= 0) rollMercenarySkill(ch);
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
      "(Negative survival ↔ positive decoration; pick 0 to keep things straight.)",
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
  if (ch.acgState!.branch === "Marines" &&
      ch.acgState!.currentAssignment === shipsTroopsLabel) {
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
  const pol = (data as { skillColumnPolicy?: {
    officerInCommand: string;
    officerStaff: string;
    enlistedNcoMinRank: string;
    enlistedNcoColumn: string;
    enlistedLowRankColumns: Record<string, string>;
  } }).skillColumnPolicy;
  if (!pol) return "ncoSkills";
  if (ch.acgState!.isOfficer) {
    return ch.acgState!.inCommand ? pol.officerInCommand : pol.officerStaff;
  }
  // Enlisted: rank below the NCO threshold uses Army/Marine Life column.
  const rank = ch.acgState!.rankCode;
  const enlistedNum = parseInt(rank.replace(/[^\d]/g, ""), 10) || 0;
  const ncoMin = parseInt(pol.enlistedNcoMinRank.replace(/[^\d]/g, ""), 10) || 3;
  if (enlistedNum < ncoMin) {
    const branch = ch.acgState!.branch ?? "";
    return pol.enlistedLowRankColumns[branch] ?? pol.enlistedLowRankColumns["army"] ?? "armyLife";
  }
  return pol.enlistedNcoColumn;
}

function mercenaryAvailableSkillColumns(ch: Character): string[] {
  const cols: string[] = [];
  const lifeCol = ch.acgState!.branch === "Marines" ? "marineLife" : "armyLife";
  cols.push(lifeCol);
  const rankNum = parseInt(ch.acgState!.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if (!ch.acgState!.isOfficer && rankNum >= 3) cols.push("ncoSkills");
  if (ch.acgState!.isOfficer) {
    if (ch.acgState!.inCommand) cols.push("commandSkills");
    else cols.push("staffSkills");
  }
  if (ch.acgState!.branch === "Marines") cols.push("shipboard");
  return cols;
}

function rollMercenarySkillFromColumn(ch: Character, col: string): void {
  const data = dataFor(ch);
  const r = roll(1);
  const row = data.serviceSkills.rows.find((row) => row.die === r);
  if (!row) return;
  const skill = row[col] as string | undefined;
  if (!skill) return;
  applyAcgSkillCell(ch, skill);
}

/** Apply an ACG skill table cell to the character. Cells may be plain
 *  skill names ("Gun Combat", "Heavy Weapons") or "+1 Attribute" forms. */
export function applyAcgSkillCell(ch: Character, cell: string): void {
  const attrMatch = cell.match(/^\+(\d+)\s+(\w+)$/);
  if (attrMatch) {
    const delta = parseInt(attrMatch[1]!, 10);
    const a = attrMatch[2]!.toLowerCase();
    const attr =
      a.startsWith("str") ? "strength" :
      a.startsWith("dex") ? "dexterity" :
      a.startsWith("end") ? "endurance" :
      a.startsWith("int") ? "intelligence" :
      a.startsWith("edu") ? "education" :
      a.startsWith("soc") ? "social" : null;
    if (attr) ch.improveAttribute(attr, delta);
    return;
  }
  ch.addSkill(cell, 1);
}

/** Advance the rank by one step per the pathway's rank ladder. */
function promoteMercenary(ch: Character): void {
  const data = dataFor(ch);
  if (ch.acgState!.isOfficer) {
    const codes = data.ranks.officer.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.acgState!.promotedThisTerm = true;
      ch.log(ev.promoted(data.ranks.officer[idx + 1]![1]));
    }
  } else {
    const codes = data.ranks.enlisted.map((r) => r[0]);
    const idx = codes.indexOf(ch.acgState!.rankCode);
    if (idx >= 0 && idx < codes.length - 1) {
      ch.acgState!.rankCode = codes[idx + 1]!;
      ch.log(ev.promoted(data.ranks.enlisted[idx + 1]![1]));
    }
  }
}

/** Special Assignment table — replaces the normal assignment when the
 *  assignment roll yields "Special Duty". Routes through the schools
 *  module which applies the school's specific skill awards. */
export function mercenarySpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  const col = ch.acgState!.isOfficer ? "officer" : "enlisted";
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
  const ocsAgeLimit = (data as { ocsAdvancement?: { ageLimit?: number } })
    .ocsAdvancement?.ageLimit;
  if (sa === "OCS" && ocsAgeLimit !== undefined && ch.age > ocsAgeLimit) {
    const reroll = rollOnce();
    if (reroll === "OCS") {
      ch.logRaw(`OCS over age ${ocsAgeLimit}: waiver granted on reroll.`);
    } else if (reroll) {
      ch.logRaw(`OCS over age ${ocsAgeLimit}: rerolled to ${reroll}.`, "verbose");
      sa = reroll;
    } else {
      return;
    }
  }
  ch.logRaw(`Special Assignment: ${sa}`);
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
  const svc = ch.acgState!.branch === "Marines" ? "marines" : "army";
  const spec = data.reenlistment[svc];
  const dm = applyStructuredDms(spec.dms, ch);
  const r = roll(2);
  ch.logRaw(`Mercenary reenlist (${svc}): ${r} + ${dm} vs ${spec.target}`, "verbose");
  if (r === 12) {
    ch.mandatoryReenlistment = true;
    offerArmChange(ch, data);
    return true;
  }
  const keep = r + dm >= spec.target;
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
        c.logRaw(`Reenlisted into ${chosen} combat arm.`);
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
