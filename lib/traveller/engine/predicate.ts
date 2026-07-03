// The single condition / eligibility interpreter for the whole engine.
//
// Previously the same idea — "does this rule apply to this character?" —
// was expressed three incompatible ways, each with its own matcher:
//   - basic chargen  : DMRule {modifier, attribute, min, max}   (dmEvaluator)
//   - ACG            : StructuredDm {~20 atoms}                  (tables)
//   - homeworld/muster: bespoke `when` clauses                  (homeworld/musterDm)
//
// This module defines ONE `Predicate` schema (a flat bag of optional,
// implicitly-ANDed condition atoms) and ONE `evaluatePredicate` interpreter
// that every DM / eligibility rule references. A rule that also carries a DM
// value or caller-side filters wraps a Predicate (StructuredDm, tables.ts); the
// value (`dm`/`dmPerTerm`) and filters (`column`/`rollType`) are NOT
// conditions and live on the wrapper, never inside the Predicate — which is
// what keeps the homeworld column *condition* (`homeworldField`) from
// colliding with the ACG table-column *filter* (`column`).

import type { Character } from "@/lib/traveller/character";
import type { Attributes, Skill } from "@/lib/traveller/types";
import { getEdition } from "@/lib/traveller/editions";
import { getAcgPathway } from "@/lib/traveller/editions";

/** A homeworld field test (starport / size / atmosphere / … / tech). Exactly
 *  one of equals/in/atLeast is set in practice; `atLeast` compares via the
 *  edition's techCodeOrder (only meaningful for the `tech` field). */
export interface HomeworldFieldTest {
  field: string;
  equals?: string;
  in?: string[];
  atLeast?: string;
}

/** The unified condition schema. Every field is optional; a Predicate holds
 *  the subset of atoms a rule needs and matches when ALL present atoms hold
 *  (implicit AND). An empty Predicate always matches. */
export interface Predicate {
  // Attribute band: character attribute within [min, max].
  attribute?: string;
  min?: number;
  max?: number;
  // Term count.
  termsAtLeast?: number;
  // ACG letter-band rank code (e.g. "O3"/"E5"): same letter AND number >= / <= N.
  rankAtLeast?: string;
  rankAtMost?: string;
  // Plain numeric rank (ch.rank) >= N (muster benefit table, navy/scout gates).
  rankNumAtLeast?: number;
  // Status flags.
  officer?: boolean;
  enlisted?: boolean;
  inCommand?: boolean;
  retired?: boolean;
  // Service / fleet.
  service?: string | string[];
  serviceIn?: string[];
  serviceNotIn?: string[];
  fleet?: string;
  // Skills.
  skillAtLeast?: { skill: string; level: number };
  anyMosSkillAtLeast?: number;
  anyDepartmentSkillAtLeast?: number;
  // ACG roles.
  crossTrainedInAny?: string[];
  currentCombatArmIn?: string[];
  currentDepartmentNotIn?: string[];
  attendedAnyOf?: string[];
  // Homeworld gates.
  homeworldTechAtLeast?: string;
  homeworldField?: HomeworldFieldTest;
}

/** Everything `evaluatePredicate` may read. `attributes`/`terms` are always
 *  present; every other field is optional so a caller with only a partial
 *  context (basic chargen: {attributes, terms}; homeworld generation:
 *  {homeworldColumns}) can still evaluate the atoms it actually uses. */
export interface PredicateContext {
  attributes: Attributes;
  terms: number;
  service?: string;
  rank?: number;
  rankCode?: string;
  isOfficer?: boolean;
  inCommand?: boolean;
  retired?: boolean;
  fleet?: string | undefined;
  skills?: readonly Skill[];
  combatArm?: string;
  department?: string;
  crossTrainedArms?: readonly string[];
  schoolsAttended?: readonly string[];
  /** MOS skill (from initial training) plus the per-arm MOS skill names. */
  mos?: string | undefined;
  mosArmSkillNames?: readonly string[];
  departmentSkillNames?: readonly string[];
  homeworldTech?: string | undefined;
  techCodeOrder?: readonly string[] | undefined;
  /** Homeworld field values, keyed by column name (starport/size/…/tech).
   *  Populated during homeworld generation and for a generated character. */
  homeworldColumns?: Readonly<Record<string, string | undefined>> | undefined;
}

/** Map an attribute label / abbreviation ("Str", "Edu", "social") to its key. */
export function normalizeAttr(s: string): keyof Attributes {
  const lc = s.toLowerCase();
  if (lc.startsWith("str")) return "strength";
  if (lc.startsWith("dex")) return "dexterity";
  if (lc.startsWith("end")) return "endurance";
  if (lc.startsWith("int")) return "intelligence";
  if (lc.startsWith("edu")) return "education";
  return "social";
}

/** Parse a rank code like "O3" / "E-5" into its letter band and number. */
export function parseRankLetter(code: string): { letter: string; n: number } | null {
  const m = code.match(/^([A-Za-z]+-?)(\d+)$/);
  if (!m) return null;
  return { letter: m[1]!, n: parseInt(m[2]!, 10) };
}

function rankBandOk(want: string, code: string, cmp: (have: number, want: number) => boolean): boolean {
  const w = parseRankLetter(want);
  const h = parseRankLetter(code);
  if (!w || !h || w.letter !== h.letter) return false;
  return cmp(h.n, w.n);
}

/** The single interpreter. Returns true when every atom present in `p` holds
 *  against `ctx`. Atoms whose context is absent fail closed (no match), which
 *  matches the pre-consolidation matchers' behavior. */
export function evaluatePredicate(p: Predicate, ctx: PredicateContext): boolean {
  if (p.attribute) {
    const v = ctx.attributes[normalizeAttr(p.attribute)];
    if (p.min !== undefined && v < p.min) return false;
    if (p.max !== undefined && v > p.max) return false;
    if (p.min === undefined && p.max === undefined) return false;
  }
  const code = ctx.rankCode ?? "";
  if (p.rankAtLeast && !rankBandOk(p.rankAtLeast, code, (h, w) => h >= w)) return false;
  if (p.rankAtMost && !rankBandOk(p.rankAtMost, code, (h, w) => h <= w)) return false;
  if (p.rankNumAtLeast !== undefined && (ctx.rank ?? Number.NEGATIVE_INFINITY) < p.rankNumAtLeast) {
    return false;
  }
  if (p.officer === true && !ctx.isOfficer) return false;
  if (p.enlisted === true && ctx.isOfficer) return false;
  if (p.inCommand === true && !ctx.inCommand) return false;
  if (p.retired === true && !ctx.retired) return false;
  if (p.service !== undefined) {
    const services = Array.isArray(p.service) ? p.service : [p.service];
    if (!services.includes(ctx.service ?? "")) return false;
  }
  if (p.serviceIn && !p.serviceIn.includes(ctx.service ?? "")) return false;
  if (p.serviceNotIn && p.serviceNotIn.includes(ctx.service ?? "")) return false;
  if (p.fleet !== undefined && ctx.fleet !== p.fleet) return false;
  if (p.skillAtLeast && skillLevel(ctx, p.skillAtLeast.skill) < p.skillAtLeast.level) return false;
  if (p.anyMosSkillAtLeast !== undefined && !anyMosSkill(ctx, p.anyMosSkillAtLeast)) return false;
  if (p.anyDepartmentSkillAtLeast !== undefined) {
    const names = ctx.departmentSkillNames ?? [];
    if (!(ctx.skills ?? []).some(([n, l]) => names.includes(n) && l >= p.anyDepartmentSkillAtLeast!)) {
      return false;
    }
  }
  if (p.crossTrainedInAny) {
    const xt = ctx.crossTrainedArms ?? [];
    if (!p.crossTrainedInAny.some((a) => xt.includes(a))) return false;
  }
  if (p.currentCombatArmIn && !p.currentCombatArmIn.includes(ctx.combatArm ?? "")) return false;
  if (p.currentDepartmentNotIn && p.currentDepartmentNotIn.includes(ctx.department ?? "")) return false;
  if (p.termsAtLeast !== undefined && ctx.terms < p.termsAtLeast) return false;
  if (p.attendedAnyOf) {
    const schools = ctx.schoolsAttended ?? [];
    if (!p.attendedAnyOf.some((s) => schools.includes(s))) return false;
  }
  if (p.homeworldTechAtLeast && !techAtLeast(ctx, ctx.homeworldTech, p.homeworldTechAtLeast)) {
    return false;
  }
  if (p.homeworldField && !homeworldFieldOk(p.homeworldField, ctx)) return false;
  return true;
}

function skillLevel(ctx: PredicateContext, skill: string): number {
  let lvl = 0;
  for (const [n, l] of ctx.skills ?? []) if (n === skill) lvl = l;
  return lvl;
}

function anyMosSkill(ctx: PredicateContext, level: number): boolean {
  const names = new Set(ctx.mosArmSkillNames ?? []);
  if (ctx.mos) names.add(ctx.mos);
  return (ctx.skills ?? []).some(([n, l]) => names.has(n) && l >= level);
}

function techAtLeast(
  ctx: PredicateContext, actual: string | undefined, floor: string,
): boolean {
  const order = ctx.techCodeOrder;
  if (!order || !actual) return false;
  const want = order.indexOf(floor);
  const have = order.indexOf(actual);
  return want >= 0 && have >= 0 && have >= want;
}

function homeworldFieldOk(f: HomeworldFieldTest, ctx: PredicateContext): boolean {
  const actual = ctx.homeworldColumns?.[f.field];
  if (actual === undefined) return false;
  if (f.equals !== undefined) return actual === f.equals;
  if (f.in) return f.in.includes(actual);
  if (f.atLeast !== undefined) return f.field === "tech" && techAtLeast(ctx, actual, f.atLeast);
  return false;
}

/** Build a full context from a Character. Resolves the edition-specific MOS /
 *  department skill-name sets so the evaluator stays free of edition data. */
export function buildPredicateContext(ch: Character): PredicateContext {
  const acg = ch.acgState;
  const hwData = getEdition(ch.editionId).data;
  return {
    attributes: ch.attributes,
    terms: ch.terms,
    service: ch.service,
    rank: ch.rank,
    rankCode: acg?.rankCode ?? "",
    isOfficer: acg?.isOfficer ?? false,
    inCommand: acg?.inCommand ?? false,
    retired: ch.retired,
    fleet: acg?.fleet,
    skills: ch.skills,
    combatArm: acg?.combatArm ?? "",
    department: acg?.department ?? "",
    crossTrainedArms: acg?.crossTrainedArms ?? [],
    schoolsAttended: acg?.schoolsAttended ?? [],
    mos: acg?.mos,
    mosArmSkillNames: mercenaryArmSkillNames(ch),
    departmentSkillNames: merchantDepartmentSkillNames(ch),
    homeworldTech: ch.homeworld?.tech,
    techCodeOrder: hwData.homeworld?.techCodeOrder,
    homeworldColumns: ch.homeworld
      ? (ch.homeworld as unknown as Readonly<Record<string, string>>)
      : undefined,
  };
}

function mercenaryArmSkillNames(ch: Character): string[] {
  const acg = ch.acgState;
  if (!acg?.combatArm) return [];
  const mos = getAcgPathway(ch.editionId, "mercenary")?.mos as
    { rows: Array<Record<string, unknown>> } | undefined;
  if (!mos) return [];
  const col = acg.combatArm.charAt(0).toLowerCase() + acg.combatArm.slice(1);
  const out: string[] = [];
  for (const row of mos.rows) {
    const v = row[col];
    if (typeof v === "string") out.push(v);
  }
  return out;
}

function merchantDepartmentSkillNames(ch: Character): string[] {
  const acg = ch.acgState;
  if (!acg?.department) return [];
  const dept = (getAcgPathway(ch.editionId, "merchantPrince")?.skillTables as
    { department?: { rows: Array<Record<string, unknown>> } } | undefined)?.department;
  if (!dept) return [];
  const col = acg.department.charAt(0).toLowerCase() + acg.department.slice(1);
  const out: string[] = [];
  for (const row of dept.rows) {
    const v = row[col];
    if (typeof v === "string") out.push(v);
  }
  return out;
}

