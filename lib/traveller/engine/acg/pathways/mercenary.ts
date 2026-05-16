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
  applyDmRules, labelToColumnKey, lookupResolution, parseResolutionTarget,
  rollVsTarget,
} from "../tables";
import { awardBrownie, awardDecoration, runCourtMartial } from "../awards";
import type { AcgState, ResolutionTarget } from "../types";

const PATHWAY = "mercenary";

interface MercenaryData {
  combatArms: string[];
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
  specialAssignments: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] };
  specialistSchool?: Record<string, unknown>;
  serviceSkills: { columns: string[]; rows: Array<Record<string, unknown>> };
  mos: { columns: string[]; rows: Array<Record<string, unknown>> };
  ranks: { enlisted: Array<[string, string]>; officer: Array<[string, string, number]> };
  reenlistment: { army: { target: number; dms: string[] }; marines: { target: number; dms: string[] } };
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
  ch.acgState!.combatArm = combatArm;
  ch.acgState!.branch = service === "army" ? "Army" : "Marines";

  const enlistSpec = data.enlistment[service];
  let dm = 0;
  for (const d of enlistSpec.dms) {
    const attr = d.attribute as keyof typeof ch.attributes;
    if (ch.attributes[attr] >= d.min) dm += d.dm;
  }
  const r = roll(2);
  ch.verboseHistory(
    `Mercenary enlist (${service}, ${combatArm}): roll ${r} + ${dm} vs ${enlistSpec.target}`,
  );

  if (r + dm >= enlistSpec.target) {
    ch.history.push(`Enlisted in the ${service === "army" ? "Army" : "Marines"} (${combatArm}).`);
    ch.acgState!.rankCode = enlistSpec.startingRank;
    ch.acgState!.isOfficer = enlistSpec.startingRank.startsWith("O");
    return;
  }

  // Failed enlistment → attempt draft.
  const draftRoll = roll(1);
  const drafted = data.enlistment.draft.results[String(draftRoll)];
  if (!drafted) {
    ch.history.push("Enlistment failed; draft did not assign mercenary service.");
    throw new Error("Mercenary draft rejection — choose another path");
  }
  ch.drafted = true;
  const draftedService = drafted.toLowerCase() as "army" | "marines";
  const draftSpec = data.enlistment[draftedService];
  ch.history.push(`Drafted into the ${drafted}.`);
  ch.acgState!.branch = drafted;
  ch.acgState!.rankCode = draftSpec.startingRank;
  ch.acgState!.isOfficer = false; // drafted = enlisted; no OCS first term
}

/** Initial training: first year of term 1. Gun Combat-1, plus one skill
 *  from the MOS table for the combat arm. */
export function mercenaryInitialTraining(ch: Character): void {
  const data = dataFor(ch);
  ch.history.push("Initial Training: Gun Combat-1");
  ch.addSkill("Gun Combat", 1);

  // Roll on MOS table for the combat arm.
  const armKey = labelToColumnKey(ch.acgState!.combatArm!);
  const r = roll(1);
  const row = data.mos.rows.find((row) => row.die === r);
  if (!row) throw new Error(`MOS table missing row for die=${r}`);
  const mosSkill = row[armKey] as string | undefined;
  if (!mosSkill) {
    throw new Error(`MOS table missing column "${armKey}" for combat arm "${ch.acgState!.combatArm}"`);
  }
  ch.acgState!.mos = mosSkill;
  ch.addSkill(mosSkill, 1);
  ch.history.push(`MOS assigned: ${mosSkill}-1`);
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
  ch.verboseHistory(
    `Mercenary Command Duty (${arm}/${svc}): roll ${r} + ${dm} vs ${parsed.target} → ${success ? "command" : "staff"}`,
  );
  ch.acgState!.inCommand = success;
}

/** Roll the year's assignment. Returns the assignment label (e.g., "Raid"). */
export function mercenaryRollAssignment(ch: Character): string {
  const data = dataFor(ch);
  if (ch.acgState!.justRetained && ch.acgState!.retainedAssignment) {
    const retained = ch.acgState!.retainedAssignment;
    ch.acgState!.justRetained = false;
    ch.acgState!.retainedAssignment = null;
    ch.verboseHistory(`Assignment retained from previous year: ${retained}`);
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
  // Manual: Marines never serve on Counterinsurgency or Internal Security;
  // if rolled, they're assigned to Ship's Troops instead.
  if (ch.acgState!.branch === "Marines" &&
      (assignment === "Ctrlns" || assignment === "Counterinsurgency" || assignment === "Internal Security")) {
    assignment = "Ship's Troops";
  }
  return assignment;
}

/** Resolve one assignment (survival → decoration → promotion → skills).
 *  Updates Character state in place. */
export function mercenaryResolveAssignment(ch: Character, assignment: string): void {
  const data = dataFor(ch);
  // Pick which resolution sub-table applies.
  let resKey: string;
  if (["Infantry", "Cavalry", "Artillery"].includes(ch.acgState!.combatArm!)) {
    resKey = "infantryCavalryArtillery";
  } else if (ch.acgState!.combatArm === "Support") {
    resKey = "support";
  } else {
    resKey = "commando";
  }
  const resTable = data.assignmentResolution[resKey];
  if (!resTable) throw new Error(`Resolution sub-table "${resKey}" missing for mercenary`);

  // Some assignments don't appear in resTable.columns (e.g., "Garrison",
  // "Ship's Troops" exist; "Special Duty" doesn't — that's handled in the
  // caller). Map the assignment label to a column key.
  const assignmentCol = labelToColumnKey(assignment);
  if (!resTable.columns.includes(assignmentCol)) {
    // Garrison Duty: per manual, characters survive with no decoration or
    // skills. Treat unrecognised assignments as garrison.
    ch.verboseHistory(`Garrison-style assignment "${assignment}": automatic survival, no rewards`);
    ch.acgState!.assignmentHistory.push(assignment);
    return;
  }
  const res = lookupResolution(resTable, assignment);

  // Decoration DM strategy: player may take negative survival DM in
  // exchange for positive decoration DM. The reverse is also legal.
  const decStrategy = ch.acgState!.decorationDmStrategy;
  const survivalDmFromStrategy = -Math.abs(decStrategy) * Math.sign(decStrategy === 0 ? 0 : -decStrategy);
  // ^ negative strategy (e.g., -2) means apply -2 to survival and +2 to deco.

  const survDm = applyDmRules(resTable.dms, ch, "survival") + survivalDmFromStrategy;
  const decDm = applyDmRules(resTable.dms, ch, "decoration") + Math.abs(decStrategy) * (decStrategy < 0 ? 1 : -1);
  const promoDm = applyDmRules(resTable.dms, ch, "promotion");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");

  // --- Survival ---
  const sv = rollVsTarget(res.survival, survDm);
  ch.verboseHistory(
    `Mercenary ${assignment} survival: ${sv.roll}${survDm ? ` + ${survDm}` : ""} vs ${res.survival} → ${sv.success ? "survived" : "INJURED/INVALIDED"}`,
  );
  if (!sv.success) {
    ch.history.push("Failed survival; invalided out of mercenary service.");
    ch.activeDuty = false;
    return;
  }
  if (sv.margin === 0 && typeof res.survival === "number") {
    // Survival rolled exactly: combat wound → Purple Heart (no BP).
    if (["Police Action", "Counterinsurgency", "Raid", "Ctrlns"].includes(assignment)) {
      ch.acgState!.decorations.push("Purple Heart");
      ch.history.push(`Wounded in ${assignment}; awarded Purple Heart.`);
      ch.acgState!.injuredThisYear = true;
    }
  }

  // --- Decoration ---
  if (res.decoration !== "none") {
    const dec = rollVsTarget(res.decoration, decDm);
    ch.verboseHistory(
      `Mercenary ${assignment} decoration: ${dec.roll}${decDm ? ` + ${decDm}` : ""} vs ${res.decoration} → margin ${dec.margin}`,
    );
    if (dec.margin >= 6) awardDecoration(ch, "SEH");
    else if (dec.margin >= 3) awardDecoration(ch, "MCG");
    else if (dec.margin >= 0) awardDecoration(ch, "MCUF");
    else if (dec.margin <= -6) runCourtMartial(ch);
  }

  // --- Promotion ---
  if (res.promotion !== "none" &&
      !(ch.acgState!.isOfficer && res.promotionOfficersBarred) &&
      !(ch.acgState!.isOfficer && ch.acgState!.promotedThisTerm)) {
    const pr = rollVsTarget(res.promotion, promoDm);
    ch.verboseHistory(
      `Mercenary ${assignment} promotion: ${pr.roll}${promoDm ? ` + ${promoDm}` : ""} vs ${res.promotion}`,
    );
    if (pr.success) promoteMercenary(ch);
  }

  // --- Skills ---
  if (res.skills !== "none") {
    const sk = rollVsTarget(res.skills, skillDm);
    ch.verboseHistory(
      `Mercenary ${assignment} skills: ${sk.roll}${skillDm ? ` + ${skillDm}` : ""} vs ${res.skills}`,
    );
    if (sk.success) rollMercenarySkill(ch);
  }

  // Combat ribbon
  if (["Police Action", "Counterinsurgency", "Raid", "Ctrlns"].includes(assignment)) {
    ch.acgState!.combatRibbons += 1;
    if (ch.acgState!.inCommand && ch.acgState!.isOfficer) {
      ch.acgState!.commandClusters += 1;
    }
  }

  ch.acgState!.assignmentHistory.push(assignment);
}

/** Roll one skill from a column appropriate for current rank/duty. */
function rollMercenarySkill(ch: Character): void {
  const data = dataFor(ch);
  // Column selection per manual:
  //   E1-E2: armyLife/marineLife
  //   E3-E9 enlisted: ncoSkills
  //   O1+ with command duty: commandSkills
  //   O1+ without command duty: staffSkills
  //   Marines on Ship's Troops: shipboard
  let col: string;
  if (ch.acgState!.isOfficer) {
    col = ch.acgState!.inCommand ? "commandSkills" : "staffSkills";
  } else if (ch.acgState!.rankCode === "E1" || ch.acgState!.rankCode === "E2") {
    col = ch.acgState!.branch === "Marines" ? "marineLife" : "armyLife";
  } else {
    col = "ncoSkills";
  }
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
      ch.history.push(`Promoted to ${data.ranks.officer[idx + 1]![1]}.`);
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

/** Special Assignment table — replaces the normal assignment when the
 *  assignment roll yields "Special Duty". */
export function mercenarySpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  const col = ch.acgState!.isOfficer ? "officer" : "enlisted";
  const r = roll(1);
  const row = data.specialAssignments.rows.find((row) => row.die === r);
  if (!row) return;
  const sa = row[col] as string | undefined;
  if (!sa) return;
  ch.acgState!.schoolsAttended.push(sa);
  ch.history.push(`Special Assignment: ${sa}`);
  awardBrownie(ch, 1, `Special Assignment: ${sa}`);
  // Schools that grant skills are handled in a future pass; for now the
  // assignment is recorded and the BP awarded.
}

/** End-of-year retention roll (1D=6 → same assignment next year). */
export function mercenaryRetention(ch: Character, assignment: string): void {
  if (ch.acgState!.justRetained) {
    // Already retained once — can't retain back-to-back.
    ch.acgState!.justRetained = false;
    return;
  }
  const r = roll(1);
  if (r === 6) {
    ch.acgState!.retainedAssignment = assignment;
    ch.acgState!.justRetained = true;
    ch.verboseHistory(`Retained in ${assignment} next year (rolled 6)`);
  } else {
    ch.acgState!.retainedAssignment = null;
  }
}

/** Reenlistment per service. Returns true if continuing. */
export function mercenaryReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const svc = ch.acgState!.branch === "Marines" ? "marines" : "army";
  const spec = data.reenlistment[svc];
  // Parse "+2 if rank E9 or less" etc. — simplified: apply +2 for army
  // E-rank, +1 for marines if cross-trained (we don't track cross-train).
  let dm = 0;
  for (const ruleStr of spec.dms) {
    const m = ruleStr.match(/^\s*\+\s*(\d+)/);
    if (!m) continue;
    if (ruleStr.toLowerCase().includes("rank e9 or less") &&
        ch.acgState!.rankCode.startsWith("E")) {
      dm += parseInt(m[1]!, 10);
    }
  }
  const r = roll(2);
  ch.verboseHistory(`Mercenary reenlist (${svc}): ${r} + ${dm} vs ${spec.target}`);
  if (r === 12) {
    ch.mandatoryReenlistment = true;
    return true;
  }
  return r + dm >= spec.target;
}

/** Hook called by the runner before per-year processing. Resets per-term
 *  flags (officer promotion cap, etc.) at start of each term. */
export function mercenaryStartOfTerm(_ch: Character): void {
  // No-op for now — handled by the shared runner.
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
