// Specialist school / special-assignment resolution. Each special
// assignment that lands a character at a school or specialty programme
// runs through this module to apply the school's specific effects per
// MT Players' Manual pp. 50-51 (Mercenary), 54-55 (Navy), 56-59 (Scout).
//
// All per-school skill batches, target numbers, and effects live in the
// edition JSON under `advancedCharacterGeneration.<pathway>.specialAssignmentDetails`.
// This module dispatches the effect objects against the character.

import type { Character } from "@/lib/traveller/character";
import { getEdition, getAcgPathway } from "@/lib/traveller/editions";
import { awardBrownie, bpAwardFor } from "./awards";
import { applyAcgSkillCell } from "./skills";
import { event as ev } from "@/lib/traveller/history";
import {
  serviceSkillColumnFor, rollSkillFromColumn, rollDieRow, branchSkillCandidates,
  type SkillColumnPolicy,
} from "@/lib/traveller/engine/acg/pathways/shared";
import {
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import {
  buildPredicateContext, evaluatePredicate, type Predicate,
} from "@/lib/traveller/engine/predicate";
import { requireRule } from "@/lib/traveller/editions/strict";

type Effect = Record<string, unknown> & { type: string };

interface SchoolSpec {
  summary?: string;
  effects: Effect[];
  ageLimit?: number;
}

interface PathwayData {
  specialAssignmentDetails?: Record<string, SchoolSpec>;
  combatArms?: string[];
  branches?: string[];
  mos?: { rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  specialistSchool?: {
    rows: Array<Record<string, unknown>>;
    notes?: string[];
    schoolingThreshold?: number;
  };
  serviceSkills?: { rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  skillColumnPolicy?: SkillColumnPolicy;
  branchSkills?: { rows: Array<Record<string, unknown>>; dms?: StructuredDm[] };
  ranks?: { officer: Array<unknown[]> };
}

function pathwayData(ch: Character, pathway: string): PathwayData | null {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
  if (!acg) return null;
  return (acg[pathway] as PathwayData | undefined) ?? null;
}

/** Run a special-assignment / school by name for the given pathway. */
export function applySpecialAssignment(
  ch: Character,
  pathway: "mercenary" | "navy",
  assignment: string,
): void {
  if (!ch.acgState) return;
  ch.acgState.schoolsAttended.push(assignment);
  ch.log(ev.schoolAssigned(assignment, pathway));
  awardBrownie(ch, bpAwardFor(ch, "Special assignment") ?? 0, `Special Assignment: ${assignment}`);

  const data = pathwayData(ch, pathway);
  const spec = data?.specialAssignmentDetails?.[assignment];
  if (!spec) {
    throw new Error(
      `${pathway} Special Assignment "${assignment}" has no JSON spec ` +
      `under specialAssignmentDetails (edition: ${ch.editionId}).`,
    );
  }
  // Age limits (e.g., OCS over 38) are evaluated by the caller before
  // dispatching here — by the time we run, the caller has either rerolled
  // or invoked the waiver and we apply the school normally.

  for (const effect of spec.effects) {
    runEffect(ch, pathway, assignment, effect, data!);
  }
}

/** Back-compat shim — many call sites still use the mercenary-specific entry. */
export function applyMercenarySchool(ch: Character, assignment: string): void {
  applySpecialAssignment(ch, "mercenary", assignment);
}

/** Numeric field of a school effect (rolls / levels). The JSON declares
 *  these on every effect that consumes them (PM pp. 50-59); a missing
 *  field is broken edition data, never a code default. */
function requireEffectField(
  effect: Effect, schoolName: string, field: "rolls" | "levels",
): number {
  const v = effect[field];
  if (typeof v !== "number") {
    throw new Error(
      `${schoolName}: effect "${effect.type}" is missing numeric "${field}" ` +
      `(PM pp. 50-59) — declare it in specialAssignmentDetails.`,
    );
  }
  return v;
}

function runEffect(
  ch: Character,
  pathway: "mercenary" | "navy",
  schoolName: string,
  effect: Effect,
  data: PathwayData,
): void {
  if (!ch.acgState) return;
  switch (effect.type) {
    case "setCombatArm":
      if (ch.acgState.pathway === "mercenary") ch.acgState.combatArm = String(effect.value);
      return;
    case "crossTrainCombatArm": {
      const acg = ch.acgState;
      if (acg.pathway !== "mercenary") return;
      const excl = Array.isArray(effect.exclude) ? (effect.exclude as string[]) : [];
      const alreadyTrained = acg.crossTrainedArms ?? [];
      const currentArm = acg.combatArm;
      // Exclude both the JSON exclude list AND the character's current
      // arm + any previously-cross-trained arms, so the pick can't be a
      // same-arm no-op cross-train (log spam, wasted skill roll).
      const arms = (data.combatArms ?? []).filter((a) =>
        !excl.includes(a) && a !== currentArm && !alreadyTrained.includes(a),
      );
      if (arms.length === 0) return;
      const newArm = ch.rng.pick(arms);
      acg.combatArm = newArm;
      acg.crossTrainedArms = alreadyTrained;
      if (!acg.crossTrainedArms.includes(newArm)) {
        acg.crossTrainedArms.push(newArm);
      }
      ch.log(ev.crossTrained(newArm, "combatArm"));
      return;
    }
    case "crossTrainBranch": {
      // Rrev7: cross-training records ELIGIBILITY for branch change at the
      // next reenlistment (PM p. 53). It does not immediately transfer the
      // character to the new branch — that's the player's reenlist choice.
      const acg = ch.acgState;
      if (acg.pathway !== "mercenary" && acg.pathway !== "navy") return;
      const branches = data.branches ?? [];
      if (branches.length === 0) return;
      const current = acg.branch || branches[0]!;
      const opts = branches.filter((b) => b !== current);
      if (opts.length === 0) return;
      const newBranch = ch.rng.pick(opts);
      acg.crossTrainedBranches = acg.crossTrainedBranches ?? [];
      if (!acg.crossTrainedBranches.includes(newBranch)) {
        acg.crossTrainedBranches.push(newBranch);
      }
      ch.log(ev.crossTrained(newBranch, "branch"));
      return;
    }
    case "rollOnMosTable": {
      if (!effectWhenMatches(ch, effect)) return;
      const rolls = requireEffectField(effect, schoolName, "rolls");
      for (let i = 0; i < rolls; i++) rollOnMos(ch, data, schoolName);
      return;
    }
    case "rollOnBranchSkillsTable": {
      if (!effectWhenMatches(ch, effect)) return;
      const rolls = requireEffectField(effect, schoolName, "rolls");
      for (let i = 0; i < rolls; i++) rollOnBranchSkills(ch, data, schoolName);
      return;
    }
    case "rollOnSpecialistSchoolTable":
      if (!effectWhenMatches(ch, effect)) return;
      rollOnSpecialistSchool(ch, data, schoolName);
      return;
    case "rollOnServiceSkillsTable": {
      if (!effectWhenMatches(ch, effect)) return;
      const rolls = requireEffectField(effect, schoolName, "rolls");
      for (let i = 0; i < rolls; i++) rollOnServiceSkills(ch, data, schoolName);
      return;
    }
    case "rollSkillBatch": {
      const target = effect.throwTarget as number;
      const skills = effect.skills as string[];
      runSkillBatch(ch, schoolName, target, skills);
      return;
    }
    case "fixedSkill": {
      const skill = String(effect.skill);
      const levels = requireEffectField(effect, schoolName, "levels");
      ch.addSkill(skill, levels, schoolName);
      return;
    }
    case "ocsCommission":
      ocsCommission(ch);
      return;
    case "attacheOrAide":
      attacheOrAide(ch, pathway, data, effect);
      return;
    default:
      throw new Error(
        `${schoolName}: unhandled effect type "${effect.type}" ` +
        `(edition: ${ch.editionId}, pathway: ${pathway}).`,
      );
  }
}

interface EffectWhen {
  rankBelow?: { letter: string; n: number };
  rankAtLeast?: { letter: string; min: number };
}

function effectWhenMatches(ch: Character, effect: Effect): boolean {
  // Effects may carry a structured `when`; missing means "always applies".
  const when = (effect.when as EffectWhen | undefined) ?? null;
  if (!when) return true;
  if (when.rankBelow) {
    // rankBelow keeps legacy "not in that band -> applies" semantics: after
    // ocsCommission a character carries an O-band code, so an E-band rankBelow
    // gate still passes and the OCS skill rolls run. A rankAtMost Predicate
    // fails closed off-band, so this has no clean Predicate equivalent and
    // stays inline (PM p. 51 line 3182-3196).
    const { letter, n } = when.rankBelow;
    const m = (ch.acgState?.rankCode ?? "").match(new RegExp(`^${letter}(\\d+)$`));
    if (!m) return true;
    return parseInt(m[1]!, 10) < n;
  }
  if (when.rankAtLeast) {
    const pred: Predicate = {
      rankAtLeast: `${when.rankAtLeast.letter}${when.rankAtLeast.min}`,
    };
    return evaluatePredicate(pred, buildPredicateContext(ch));
  }
  return true;
}

function runSkillBatch(
  ch: Character,
  schoolName: string,
  target: number,
  skills: string[],
): void {
  for (const skill of skills) {
    if (ch.rng.roll(1) >= target) {
      ch.addSkill(skill, 1, schoolName);
    }
  }
  // Each granted skill emits ev.skillLearned with source=schoolName;
  // a fully-failed batch is implicit from the absence of those events.
}

function rollOnMos(ch: Character, data: PathwayData, schoolName: string): void {
  if (!ch.acgState || !data.mos) return;
  const acg = ch.acgState;
  const combatArm = acg.pathway === "mercenary" ? acg.combatArm : null;
  if (!combatArm) {
    throw new Error(
      `${schoolName}: the MOS roll requires a mercenary combat arm — ` +
      "enlistment must assign it first (PM p. 50)",
    );
  }
  rollSkillFromColumn(ch, data.mos, combatArm.toLowerCase(), `${schoolName} (MOS)`);
}

function rollOnBranchSkills(ch: Character, data: PathwayData, schoolName: string): void {
  if (!ch.acgState || !data.branchSkills) return;
  const acg = ch.acgState;
  const branch = (acg.pathway === "mercenary" || acg.pathway === "navy") ? acg.branch : "";
  if (!branch) {
    throw new Error(
      `${schoolName}: the branch-skill roll requires a service branch — ` +
      "enlistment must assign it first (PM p. 50/52)",
    );
  }
  const candidates = branchSkillCandidates(branch.toLowerCase());
  rollSkillFromColumn(ch, data.branchSkills, { candidates },
    `${schoolName} (branch skills)`);
}

function rollOnSpecialistSchool(
  ch: Character, data: PathwayData, schoolName: string,
): void {
  if (!ch.acgState || !data.specialistSchool) return;
  const row = rollDieRow(ch, data.specialistSchool, { dice: 1, dm: 0 });
  if (!row) return;
  const threshold = requireRule(
    data.specialistSchool.schoolingThreshold,
    "specialistSchool.schoolingThreshold", "PM p. 57",
  );
  const useSchooling =
    (ch.attributes.intelligence + ch.attributes.education) > threshold;
  const col = useSchooling ? "schooling" : "training";
  const skill = row[col];
  if (typeof skill === "string") {
    applyAcgSkillCell(ch, skill, `${schoolName} (${col})`);
  }
}

function rollOnServiceSkills(ch: Character, data: PathwayData, schoolName: string): void {
  if (!ch.acgState || !data.serviceSkills) return;
  const col = serviceSkillColumnFor(ch, data.skillColumnPolicy);
  rollSkillFromColumn(ch, data.serviceSkills, col, `${schoolName} (${col})`);
}

function ocsCommission(ch: Character): void {
  if (!ch.acgState) return;
  // F4/F17: PM lines 778, 3081, 3343, 3849 — drafted characters cannot
  // attend OCS / receive a commission during their first four-year term.
  // The rule is data-driven via rules.draft.noCommissionFirstTerm.
  const draftRules = getEdition(ch.editionId).rules.draft;
  if (draftRules?.noCommissionFirstTerm && ch.drafted && ch.terms === 0) {
    ch.log(ev.statusChange(
      "ocsDenied",
      "drafted characters cannot commission during their first term (PM p. 21)",
    ));
    return;
  }
  // OCS rank-advancement tiers come from the pathway data
  // (mercenary.ocsAdvancement / navy.ocsAdvancement, etc.), keyed by
  // the character's current enlisted rank — PM p. 51 line 3182-3187.
  const policy = readOcsAdvancement(ch);
  let resolved: string | undefined;
  let skipsSkills = false;
  for (const tier of policy?.tiers ?? []) {
    if (tier.fromRanks?.includes(ch.acgState.rankCode)) {
      resolved = tier.toRank;
      skipsSkills = tier.skipsSkills === true;
      break;
    }
  }
  if (!resolved) {
    resolved = requireRule(
      policy?.defaultToRank, "ocsAdvancement.defaultToRank",
      "PM p. 51 line 3182-3187",
    );
  }
  ch.acgState.isOfficer = true;
  ch.acgState.rankCode = resolved;
  ch.log(ev.promoted(resolved, skipsSkills ? "OCS (no skills, senior rank)" : "OCS"));
}

interface OcsAdvancement {
  tiers?: Array<{ fromRanks?: string[]; toRank: string; skipsSkills?: boolean }>;
  defaultToRank?: string;
  ageLimit?: number;
}

/** Read the pathway's `ocsAdvancement` block (PM p. 51 line 3182-3187 for
 *  mercenary; analogous data for navy if/when added). Falls back to
 *  default-to-O1 if the data is missing. */
function readOcsAdvancement(ch: Character): OcsAdvancement | null {
  const pw = getAcgPathway(ch.editionId, ch.acgState?.pathway);
  return (pw?.ocsAdvancement as OcsAdvancement | undefined) ?? null;
}

function attacheOrAide(
  ch: Character,
  pathway: "mercenary" | "navy",
  data: PathwayData,
  effect: Effect,
): void {
  if (!ch.acgState) return;
  const r = ch.rng.roll(1);
  const label = pathway === "navy" ? "Naval Attache" : "Military Attache";
  // Promotion target and the social bonus both come from the assignment
  // effect (PM p. 55/59: attache/aide promotes on 1D <= 4; +1 Social
  // Standing is gained either way).
  const promoteAtMost = requireRule(
    effect.promoteOnRollAtMost as number | undefined,
    "specialAssignmentDetails.<attache>.effects[].promoteOnRollAtMost",
    "PM p. 55/59",
  );
  const socialBonus = requireRule(
    effect.socialBonus as { attribute: string; delta: number } | undefined,
    "specialAssignmentDetails.<attache>.effects[].socialBonus", "PM p. 55/59",
  );
  if (r <= promoteAtMost) promoteOfficer(ch, data, label);
  ch.improveAttribute(
    socialBonus.attribute as Parameters<Character["improveAttribute"]>[0],
    socialBonus.delta,
  );
}

function promoteOfficer(ch: Character, data: PathwayData, reason?: string): void {
  if (!ch.acgState || !data.ranks?.officer) return;
  const codes = data.ranks.officer.map((r) => r[0] as string);
  const idx = codes.indexOf(ch.acgState.rankCode);
  if (idx >= 0 && idx < codes.length - 1) {
    ch.acgState.rankCode = codes[idx + 1]!;
    const newTitle = data.ranks.officer[idx + 1]![1] as string;
    ch.log(ev.promoted(newTitle, reason));
  }
}

/** Apply Scout school awards. The Scout school assignment table picks
 *  one of six schools; each school then uses 1D on the schools table to
 *  determine the awarded skill. */
/** Scout school metadata is data-driven via mt JSON
 *  `advancedCharacterGeneration.scout.schoolMeta`. */
interface ScoutSchoolMeta {
  rollsPerAttendance?: number;
  onceOnly?: boolean;
  requiresDivision?: string;
  promotesToRank?: string;
  promotesToOfficer?: boolean;
  adminRankPattern?: string;
  columnKey?: string;
}

function scoutSchoolMeta(ch: Character, school: string): ScoutSchoolMeta | null {
  const scout = getAcgPathway(ch.editionId, "scout");
  const meta = scout?.schoolMeta as Record<string, ScoutSchoolMeta> | undefined;
  return meta?.[school] ?? null;
}

function scoutCanAttendSchool(ch: Character, school: string): boolean {
  if (!ch.acgState) return false;
  const meta = scoutSchoolMeta(ch, school);
  if (!meta) return true;
  if (meta.onceOnly && ch.acgState.schoolsAttended.includes(school)) return false;
  if (meta.requiresDivision &&
      (ch.acgState.pathway !== "scout" || ch.acgState.division !== meta.requiresDivision)) {
    return false;
  }
  if (meta.onceOnly) {
    // The first-term-no-commission rule mirrors PM line 3588 for any
    // school that promotes to officer status.
    const draftRules = getEdition(ch.editionId).rules.draft;
    if (meta.promotesToOfficer && draftRules?.noCommissionFirstTerm &&
        ch.drafted && ch.terms === 0) {
      return false;
    }
  }
  return true;
}

export function applyScoutSchool(ch: Character, school: string): void {
  if (!ch.acgState) return;

  const meta = scoutSchoolMeta(ch, school);
  // Eligibility check (replaces hardcoded "Administrator School" gate).
  if (meta?.onceOnly && !scoutCanAttendSchool(ch, school)) {
    ch.log(ev.statusChange(
      "schoolDenied", `Scout ${school} — eligibility check failed`,
    ));
    return;
  }
  // School that grants rank/officer status (Admin School): record
  // attendance, award BP, promote.
  if (meta?.promotesToRank) {
    ch.acgState.schoolsAttended.push(school);
    ch.log(ev.schoolAssigned(school, "scout"));
    awardBrownie(ch, bpAwardFor(ch, "Special assignment") ?? 0, `Scout school: ${school}`);
    if (meta.promotesToOfficer) ch.acgState.isOfficer = true;
    const pattern = meta.adminRankPattern ? new RegExp(meta.adminRankPattern) : null;
    if (!pattern || !ch.acgState.rankCode.match(pattern)) {
      ch.acgState.rankCode = meta.promotesToRank;
      ch.log(ev.promoted(meta.promotesToRank, school));
    }
    return;
  }

  ch.acgState.schoolsAttended.push(school);
  ch.log(ev.schoolAssigned(school, "scout"));
  awardBrownie(ch, bpAwardFor(ch, "Special assignment") ?? 0, `Scout school: ${school}`);

  const scout = getEdition(ch.editionId).data.advancedCharacterGeneration?.scout;
  const schools = scout?.schools;
  if (!schools) return;
  const col = meta?.columnKey;
  if (!col) return;
  const rolls = meta?.rollsPerAttendance ?? 1;
  for (let i = 0; i < rolls; i++) {
    const row = rollDieRow(ch, schools, { dice: 1, dm: 0 });
    if (!row) continue;
    const skill = row[col];
    if (typeof skill === "string") applyAcgSkillCell(ch, skill, `Scout ${school}`);
  }
}
