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
  rollTable: {
    columns: string[];
    rows: Array<Record<string, string | number>>;
  };
  starportXRoll: { results: Record<string, string> };
  dmsByColumn: Record<string, Array<{ condition: string; dm: number }>>;
  defaultSkills: Array<{ condition: string; skill: string; level: number }>;
  careerAvailability: Array<{
    denyIfTechIn?: string[];
    denyIfTechNotIn?: string[];
    denyIfSocialBelow?: number;
    services: string[];
  }>;
  techCodeOrder: string[];
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
      if (matchesCondition(rule.condition, result)) r += rule.dm;
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

function matchesCondition(condition: string, partial: Partial<Homeworld>): boolean {
  // Conditions are of the form "size = Asteroid" or "starport = A".
  const m = condition.match(/^([\w]+)\s*=\s*(.+)$/);
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
    if (!evalDefaultSkillCondition(entry.condition, hw, ch)) continue;
    if (ch.checkSkill(entry.skill) >= 0) continue; // already known
    ch.addSkill(entry.skill, entry.level);
    ch.verboseHistory(`Homeworld grants ${entry.skill}-${entry.level}`);
  }
}

function evalDefaultSkillCondition(condition: string, hw: Homeworld, ch: Character): boolean {
  // "service in [navy, marines, flyers, scouts, merchants, pirates]"
  const serviceIn = condition.match(/^service\s+in\s+\[([^\]]+)\]/);
  if (serviceIn) {
    const list = serviceIn[1]!.split(",").map((s) => s.trim());
    return list.includes(String(ch.service));
  }
  // "service not in [barbarians]"
  const serviceNotIn = condition.match(/^service\s+not\s+in\s+\[([^\]]+)\]/);
  if (serviceNotIn) {
    const list = serviceNotIn[1]!.split(",").map((s) => s.trim());
    return !list.includes(String(ch.service));
  }
  // "tech >= Early Stellar"
  const techGte = condition.match(/^tech\s+>=\s+(.+)$/);
  if (techGte) {
    const data = dataFor(ch.editionId)!;
    const order = data.techCodeOrder;
    return order.indexOf(hw.tech) >= order.indexOf(techGte[1]!.trim());
  }
  // "tech in [Industrial, Pre-Stellar, Early Stellar]"
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
    if (rule.denyIfTechIn?.includes(hw.tech)) triggers = true;
    if (rule.denyIfTechNotIn && !rule.denyIfTechNotIn.includes(hw.tech)) triggers = true;
    if (rule.denyIfSocialBelow !== undefined && ch.attributes.social < rule.denyIfSocialBelow) {
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
  for (const entry of dataFor(ch.editionId)!.defaultSkills) {
    if (!/^tech\b/.test(entry.condition)) continue;
    if (evalDefaultSkillCondition(entry.condition, hw, ch)) {
      if (ch.checkSkill(entry.skill) < 0) {
        ch.addSkill(entry.skill, entry.level);
        ch.verboseHistory(`Homeworld grants ${entry.skill}-${entry.level}`);
      }
    }
  }
  return hw;
}
