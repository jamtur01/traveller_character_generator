// MT homeworld generation and tech-based career gating. Applies to MT
// basic chargen AND ACG (per the manual the homeworld step is shared).
// Per MT Players' Manual pp. 12-13.

import { roll } from "../random";
import type { Character } from "../character";
import { getEdition } from "../editions";
import type { ServiceKey } from "../types";

export interface Homeworld {
  starport: "A" | "B" | "C" | "D" | "E" | "X";
  size: "Asteroid" | "Small" | "Medium" | "Large";
  atmosphere: "Vacuum" | "Thin" | "Standard" | "Dense" | "Exotic";
  hydrosphere: "Desert" | "Dry" | "Wet World" | "Water World";
  population: "Low Pop" | "Mod Pop" | "High Pop";
  law: "No Law" | "Low Law" | "Mod Law" | "High Law" | "Ext Law";
  tech: "Pre-Industrial" | "Industrial" | "Pre-Stellar" | "Early Stellar" | "Avg Stellar" | "High Stellar";
}

interface HomeworldData {
  populationOrder?: string[];
  lawOrder?: string[];
  atmosphereOrder?: string[];
  hydrosphereOrder?: string[];
  starportOrder?: string[];
  rollTable: {
    columns: string[];
    rows: Array<Record<string, string | number>>;
  };
  starportXRoll: { results: Record<string, string> };
  dmsByColumn: Record<string, Array<{
    condition?: string;
    when?: DmConditionWhen;
    dm: number;
  }>>;
  defaultSkills: Array<{
    condition?: string;
    when?: {
      serviceIn?: string[];
      serviceNotIn?: string[];
      techAtLeast?: string;
      techIn?: string[];
    };
    skill: string;
    level: number;
    source?: string;
  }>;
  careerAvailability: Array<{
    /** Legacy form: deny services if homeworld tech is in this list. */
    denyIfTechIn?: string[];
    /** Legacy form: deny services if homeworld tech is NOT in this list. */
    denyIfTechNotIn?: string[];
    /** Legacy form. */
    denyIfSocialBelow?: number;
    /** PM p. 12 form: require homeworld tech ≥ this code. */
    requiresTechAtLeast?: string;
    /** PM p. 12 form: require homeworld tech equals exactly this code
     *  (Barbarians require Pre-Industrial). */
    requiresTechExactly?: string;
    /** Require population code ≥ this value (e.g. Mod Pop). */
    requiresPopulationAtLeast?: string;
    /** Require law code ≥ this value (e.g. Low Law). */
    requiresLawAtLeast?: string;
    /** Require atmosphere code ≥ this value (e.g. Thin). */
    requiresAtmosphereAtLeast?: string;
    /** Require hydrosphere ≥ this code (e.g. Wet World). */
    requiresHydrosphereAtLeast?: string;
    /** Require Social Standing ≥ this value (Nobles 10+). */
    requiresSocialAtLeast?: number;
    services: string[];
  }>;
  techCodeOrder: string[];
}

function meetsOrder(
  value: string | undefined, threshold: string,
  order: string[] | undefined,
): boolean {
  if (!value || !order) return false;
  const have = order.indexOf(value);
  const want = order.indexOf(threshold);
  if (have < 0 || want < 0) return false;
  return have >= want;
}

function dataFor(editionId: string): HomeworldData | null {
  const ed = getEdition(editionId);
  const hw = (ed.data as { homeworld?: HomeworldData }).homeworld;
  return hw ?? null;
}

/** Returns true if the active edition declares a homeworld block (MT does,
 *  CT does not). */
export function editionHasHomeworld(editionId: string): boolean {
  return dataFor(editionId) !== null;
}

/** Roll a homeworld for the character. Reads the active edition's rollTable
 *  and dmsByColumn. Mutates character history but not other state. */
export function rollHomeworld(ch: Character): Homeworld | null {
  const data = dataFor(ch.editionId);
  if (!data) return null;

  const cols = ["starport", "size", "atmosphere", "hydrosphere", "population", "law", "tech"] as const;
  const result: Partial<Homeworld> = {};

  for (const col of cols) {
    let r = roll(2);
    // Apply DMs based on previously-rolled values.
    const dms = data.dmsByColumn[col] ?? [];
    for (const rule of dms) {
      const cond = rule.when ?? rule.condition;
      if (matchesCondition(cond, result, data.techCodeOrder)) r += rule.dm;
    }
    r = Math.max(2, Math.min(12, r));
    const row = data.rollTable.rows.find((row) => row.die === r);
    if (!row) continue;
    let value = String(row[col] ?? "");
    // Starport 12 (D-X) requires a follow-up 1D.
    if (col === "starport" && value === "D-X") {
      const dr = roll(1);
      value = data.starportXRoll.results[String(dr)] ?? "X";
    }
    (result as Record<string, string>)[col] = value;
  }

  const hw = result as Homeworld;
  ch.verboseHistory(
    `Homeworld: Starport ${hw.starport}, ${hw.size}, ${hw.atmosphere} atmosphere, ${hw.hydrosphere}, ${hw.population}, ${hw.law}, ${hw.tech}`,
  );
  return hw;
}

interface DmConditionWhen {
  column?: string;
  equals?: string;
  in?: string[];
  atLeast?: string;
}

function matchesCondition(
  raw: string | { when?: DmConditionWhen } | DmConditionWhen | undefined,
  partial: Partial<Homeworld>,
  techCodeOrder?: string[],
): boolean {
  if (raw == null) return false;
  // Structured form: object with `when` or a flat shape.
  if (typeof raw === "object") {
    const w: DmConditionWhen = ("when" in raw && raw.when ? raw.when : raw) as DmConditionWhen;
    if (!w.column) return false;
    const actual = (partial as Record<string, string | undefined>)[w.column];
    if (actual === undefined) return false;
    if (w.equals !== undefined) return actual === w.equals;
    if (w.in) return w.in.includes(actual);
    if (w.atLeast && techCodeOrder && w.column === "tech") {
      return techCodeOrder.indexOf(actual) >= techCodeOrder.indexOf(w.atLeast);
    }
    return false;
  }
  // Legacy string form (kept for back-compat with any non-MT JSON).
  const m = raw.match(/^([\w]+)\s*=\s*(.+)$/);
  if (!m) return false;
  const col = m[1]!.trim();
  const expected = m[2]!.trim();
  const actual = (partial as Record<string, string>)[col];
  return actual === expected;
}

/** Apply the homeworld's default skills to the character. */
export function applyHomeworldSkills(ch: Character, hw: Homeworld): void {
  const data = dataFor(ch.editionId);
  if (!data) return;
  for (const entry of data.defaultSkills) {
    if (!evalDefaultSkillCondition(entry, hw, ch, data.techCodeOrder)) continue;
    if (ch.checkSkill(entry.skill) >= 0) continue; // already known
    ch.addSkill(entry.skill, entry.level);
    ch.verboseHistory(`Homeworld grants ${entry.skill}-${entry.level}`);
  }
}

function evalDefaultSkillCondition(
  entry: HomeworldData["defaultSkills"][number],
  hw: Homeworld,
  ch: Character,
  techCodeOrder: string[],
): boolean {
  // Structured form preferred.
  if (entry.when) {
    const w = entry.when;
    if (w.serviceIn && !w.serviceIn.includes(String(ch.service))) return false;
    if (w.serviceNotIn && w.serviceNotIn.includes(String(ch.service))) return false;
    if (w.techAtLeast &&
        techCodeOrder.indexOf(hw.tech) < techCodeOrder.indexOf(w.techAtLeast)) {
      return false;
    }
    if (w.techIn && !w.techIn.includes(hw.tech)) return false;
    return true;
  }
  // Legacy string form.
  const condition = entry.condition;
  if (!condition) return false;
  const serviceIn = condition.match(/^service\s+in\s+\[([^\]]+)\]/);
  if (serviceIn) {
    const list = serviceIn[1]!.split(",").map((s) => s.trim());
    return list.includes(String(ch.service));
  }
  const serviceNotIn = condition.match(/^service\s+not\s+in\s+\[([^\]]+)\]/);
  if (serviceNotIn) {
    const list = serviceNotIn[1]!.split(",").map((s) => s.trim());
    return !list.includes(String(ch.service));
  }
  const techGte = condition.match(/^tech\s+>=\s+(.+)$/);
  if (techGte) {
    return techCodeOrder.indexOf(hw.tech) >= techCodeOrder.indexOf(techGte[1]!.trim());
  }
  const techIn = condition.match(/^tech\s+in\s+\[([^\]]+)\]/);
  if (techIn) {
    const list = techIn[1]!.split(",").map((s) => s.trim());
    return list.includes(hw.tech);
  }
  return false;
}

/** Returns the list of services available for enlistment given the
 *  homeworld and character. Filters the edition's enlistable list by
 *  the careerAvailability rules. */
export function availableServicesForHomeworld(
  ch: Character,
  hw: Homeworld,
  allEnlistable: ServiceKey[],
): ServiceKey[] {
  const data = dataFor(ch.editionId);
  if (!data) return allEnlistable;
  const denied = new Set<string>();
  for (const rule of data.careerAvailability) {
    let triggers = false;
    // Legacy deny-list form.
    if (rule.denyIfTechIn?.includes(hw.tech)) triggers = true;
    if (rule.denyIfTechNotIn && !rule.denyIfTechNotIn.includes(hw.tech)) triggers = true;
    if (rule.denyIfSocialBelow !== undefined && ch.attributes.social < rule.denyIfSocialBelow) {
      triggers = true;
    }
    // PM p. 12 requirement form: deny when any "requires" condition fails.
    if (rule.requiresTechAtLeast &&
        !meetsOrder(hw.tech, rule.requiresTechAtLeast, data.techCodeOrder)) {
      triggers = true;
    }
    if (rule.requiresTechExactly && hw.tech !== rule.requiresTechExactly) {
      triggers = true;
    }
    if (rule.requiresPopulationAtLeast &&
        !meetsOrder(hw.population, rule.requiresPopulationAtLeast, data.populationOrder)) {
      triggers = true;
    }
    if (rule.requiresLawAtLeast &&
        !meetsOrder(hw.law, rule.requiresLawAtLeast, data.lawOrder)) {
      triggers = true;
    }
    if (rule.requiresAtmosphereAtLeast &&
        !meetsOrder(hw.atmosphere, rule.requiresAtmosphereAtLeast, data.atmosphereOrder)) {
      triggers = true;
    }
    if (rule.requiresHydrosphereAtLeast &&
        !meetsOrder(hw.hydrosphere, rule.requiresHydrosphereAtLeast, data.hydrosphereOrder)) {
      triggers = true;
    }
    if (rule.requiresSocialAtLeast !== undefined &&
        ch.attributes.social < rule.requiresSocialAtLeast) {
      triggers = true;
    }
    if (triggers) {
      for (const svc of rule.services) denied.add(svc);
    }
  }
  return allEnlistable.filter((s) => !denied.has(s));
}

/** Generate + apply: roll homeworld, store it, apply default skills.
 *  Called by Character.rollAttributes when the edition has a homeworld
 *  step. */
export function generateAndApplyHomeworld(ch: Character): Homeworld | null {
  const hw = rollHomeworld(ch);
  if (!hw) return null;
  ch.homeworld = hw;
  ch.history.push(
    `Homeworld: Starport ${hw.starport}, ${hw.size}, ${hw.atmosphere}, ${hw.hydrosphere}, ${hw.population}, ${hw.law}, ${hw.tech}.`,
  );
  // Default skills depend on the service; here we apply only the
  // tech-based ones since service isn't yet selected. The service-based
  // skills are applied at enlistment time.
  const data = dataFor(ch.editionId)!;
  for (const entry of data.defaultSkills) {
    // Filter to tech-conditional entries only (legacy: condition string
    // starts with "tech"; structured: when.techAtLeast or when.techIn).
    const isTechOnly = entry.when
      ? (entry.when.techAtLeast !== undefined || entry.when.techIn !== undefined) &&
        entry.when.serviceIn === undefined && entry.when.serviceNotIn === undefined
      : /^tech\b/.test(entry.condition ?? "");
    if (!isTechOnly) continue;
    if (evalDefaultSkillCondition(entry, hw, ch, data.techCodeOrder)) {
      if (ch.checkSkill(entry.skill) < 0) {
        ch.addSkill(entry.skill, entry.level);
        ch.verboseHistory(`Homeworld grants ${entry.skill}-${entry.level}`);
      }
    }
  }
  return hw;
}
