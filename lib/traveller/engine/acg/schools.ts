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
  mos?: { rows: Array<Record<string, unknown>> };
  specialistSchool?: {
    rows: Array<Record<string, unknown>>;
    notes?: string[];
    schoolingThreshold?: number;
  };
  serviceSkills?: { rows: Array<Record<string, unknown>> };
  skillColumnPolicy?: {
    officerInCommand: string;
    officerStaff: string;
    enlistedNcoMinRank: string;
    enlistedNcoColumn: string;
    enlistedLowRankColumns: Record<string, string>;
  };
  branchSkills?: { rows: Array<Record<string, unknown>> };
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
      ch.acgState.combatArm = String(effect.value);
      return;
    case "crossTrainCombatArm": {
      const excl = Array.isArray(effect.exclude) ? (effect.exclude as string[]) : [];
      const alreadyTrained = ch.acgState.crossTrainedArms ?? [];
      const currentArm = ch.acgState.combatArm;
      // Exclude both the JSON exclude list AND the character's current
      // arm + any previously-cross-trained arms, so the pick can't be a
      // same-arm no-op cross-train (log spam, wasted skill roll).
      const arms = (data.combatArms ?? []).filter((a) =>
        !excl.includes(a) && a !== currentArm && !alreadyTrained.includes(a),
      );
      if (arms.length === 0) return;
      const newArm = ch.rng.pick(arms);
      ch.acgState.combatArm = newArm;
      ch.acgState.crossTrainedArms = alreadyTrained;
      if (!ch.acgState.crossTrainedArms.includes(newArm)) {
        ch.acgState.crossTrainedArms.push(newArm);
      }
      ch.log(ev.crossTrained(newArm, "combatArm"));
      return;
    }
    case "crossTrainBranch": {
      // Rrev7: cross-training records ELIGIBILITY for branch change at the
      // next reenlistment (PM p. 53). It does not immediately transfer the
      // character to the new branch — that's the player's reenlist choice.
      const branches = data.branches ?? [];
      if (branches.length === 0) return;
      const current = ch.acgState.branch ?? branches[0]!;
      const opts = branches.filter((b) => b !== current);
      if (opts.length === 0) return;
      const newBranch = ch.rng.pick(opts);
      ch.acgState.crossTrainedBranches = ch.acgState.crossTrainedBranches ?? [];
      if (!ch.acgState.crossTrainedBranches.includes(newBranch)) {
        ch.acgState.crossTrainedBranches.push(newBranch);
      }
      ch.log(ev.crossTrained(newBranch, "branch"));
      return;
    }
    case "rollOnMosTable": {
      if (!effectWhenMatches(ch, effect)) return;
      const rolls = (effect.rolls as number) ?? 1;
      for (let i = 0; i < rolls; i++) rollOnMos(ch, data, schoolName);
      return;
    }
    case "rollOnBranchSkillsTable": {
      if (!effectWhenMatches(ch, effect)) return;
      const rolls = (effect.rolls as number) ?? 1;
      for (let i = 0; i < rolls; i++) rollOnBranchSkills(ch, data, schoolName);
      return;
    }
    case "rollOnSpecialistSchoolTable":
      if (!effectWhenMatches(ch, effect)) return;
      rollOnSpecialistSchool(ch, data, schoolName);
      return;
    case "rollOnServiceSkillsTable": {
      if (!effectWhenMatches(ch, effect)) return;
      const rolls = (effect.rolls as number) ?? 1;
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
      const levels = (effect.levels as number) ?? 1;
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
  const code = ch.acgState?.rankCode ?? "";
  if (when) {
    if (when.rankBelow) {
      const { letter, n } = when.rankBelow;
      const m = code.match(new RegExp(`^${letter}(\\d+)$`));
      if (!m) return true; // not in that band; legacy semantics
      return parseInt(m[1]!, 10) < n;
    }
    if (when.rankAtLeast) {
      const { letter, min } = when.rankAtLeast;
      const m = code.match(new RegExp(`^${letter}(\\d+)$`));
      if (!m) return false;
      return parseInt(m[1]!, 10) >= min;
    }
    return true;
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
  const armKey = (ch.acgState.combatArm ?? "Infantry").toLowerCase();
  const r = ch.rng.roll(1);
  const row = data.mos.rows.find((row) => row.die === r);
  const skill = row?.[armKey];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill, `${schoolName} (MOS)`);
}

function rollOnBranchSkills(ch: Character, data: PathwayData, schoolName: string): void {
  if (!ch.acgState || !data.branchSkills) return;
  const branchKey = (ch.acgState.branch ?? "Line").toLowerCase();
  const r = ch.rng.roll(1);
  const row = data.branchSkills.rows.find((row) => row.die === r);
  if (!row) return;
  const candidates = [branchKey, branchKey === "line" ? "lineCrew" : branchKey,
    branchKey === "crew" ? "lineCrew" : branchKey];
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === "string") {
      applyAcgSkillCell(ch, v, `${schoolName} (branch skills)`);
      return;
    }
  }
}

function rollOnSpecialistSchool(
  ch: Character, data: PathwayData, schoolName: string,
): void {
  if (!ch.acgState || !data.specialistSchool) return;
  const r = ch.rng.roll(1);
  const row = data.specialistSchool.rows.find((row) => row.die === r);
  if (!row) return;
  const threshold = data.specialistSchool.schoolingThreshold ?? 16;
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
  const r = ch.rng.roll(1);
  const row = data.serviceSkills.rows.find((row) => row.die === r);
  if (!row) return;
  let col: string;
  const rankNum = parseInt(ch.acgState.rankCode.replace(/[^\d]/g, ""), 10) || 0;
  if (ch.acgState.isOfficer) {
    col = ch.acgState.inCommand ? "commandSkills" : "staffSkills";
  } else {
    // NCO threshold + branch-life columns are driven by the pathway's
    // skillColumnPolicy (PM p. 51 line 3194-3196); mercenary defines it.
    const pol = data.skillColumnPolicy;
    const ncoMin = pol
      ? parseInt(pol.enlistedNcoMinRank.replace(/[^\d]/g, ""), 10) || 3
      : 3;
    if (rankNum >= ncoMin) {
      col = pol?.enlistedNcoColumn ?? "ncoSkills";
    } else {
      const branch = ch.acgState.branch ?? "";
      col = pol?.enlistedLowRankColumns[branch]
        ?? pol?.enlistedLowRankColumns["army"]
        ?? (branch === "Marines" ? "marineLife" : "armyLife");
    }
  }
  const skill = row[col];
  if (typeof skill === "string") applyAcgSkillCell(ch, skill, `${schoolName} (${col})`);
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
  if (!resolved) resolved = policy?.defaultToRank ?? "O1";
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
  // Promotion target comes from the assignment effect (PM p. 55/59:
  // attache/aide promotes on 1D <= 4).
  const promoteAtMost = (effect.promoteOnRollAtMost as number | undefined) ?? 4;
  if (r <= promoteAtMost) {
    promoteOfficer(ch, data, label);
    ch.improveAttribute("social", 1);
  } else {
    ch.improveAttribute("social", 1);
  }
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
  if (meta.requiresDivision && ch.acgState.division !== meta.requiresDivision) return false;
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
    const r = ch.rng.roll(1);
    const row = schools.rows.find((row) => row.die === r);
    if (!row) continue;
    const skill = row[col];
    if (typeof skill === "string") applyAcgSkillCell(ch, skill, `Scout ${school}`);
  }
}
