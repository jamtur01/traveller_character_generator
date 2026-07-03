// MT homeworld generation and tech-based career gating. Applies to MT
// basic chargen AND ACG (per the manual the homeworld step is shared).
// Per MT Players' Manual pp. 12-13.

import { roll } from "@/lib/traveller/random";
import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { event as ev } from "@/lib/traveller/history";
import type { ServiceKey } from "@/lib/traveller/types";

/** A rolled homeworld profile (UPP-style coding). The valid values for
 *  each field are sourced from the active edition JSON's `homeworld`
 *  block (populationOrder, lawOrder, atmosphereOrder, hydrosphereOrder,
 *  starportOrder, techCodeOrder, sizeOrder) — kept as `string` here so
 *  the JSON remains the single source of truth. */
export interface Homeworld {
  starport: string;
  size: string;
  atmosphere: string;
  hydrosphere: string;
  population: string;
  law: string;
  tech: string;
}

export interface HomeworldData {
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
    when: DmConditionWhen;
    dm: number;
  }>>;
  defaultSkills: Array<{
    when: {
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
  return getEdition(editionId).data.homeworld ?? null;
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

  // Column order comes from the roll table itself (minus the "die" header),
  // so the DM-application order can't silently diverge from the table.
  const cols = data.rollTable.columns.filter((c) => c !== "die");
  const result: Partial<Homeworld> = {};

  for (const col of cols) {
    let r = roll(2);
    // Apply DMs based on previously-rolled values.
    const dms = data.dmsByColumn[col] ?? [];
    for (const rule of dms) {
      if (matchesCondition(rule.when, result, data.techCodeOrder)) r += rule.dm;
    }
    r = Math.max(2, Math.min(12, r));
    const row = data.rollTable.rows.find((row) => row.die === r);
    if (!row) {
      // Missing row in the JSON rolltable is a data bug — fail loudly
      // rather than silently leaving the homeworld column empty (which
      // downstream code would interpret as undefined behavior).
      throw new Error(
        `Homeworld rollTable for "${col}" is missing row die=${r} ` +
        `(edition: ${ch.editionId}).`,
      );
    }
    const cellRaw = row[col];
    if (cellRaw === undefined || cellRaw === null || cellRaw === "") {
      throw new Error(
        `Homeworld rollTable row die=${r} has no "${col}" value ` +
        `(edition: ${ch.editionId}).`,
      );
    }
    let value = String(cellRaw);
    // Starport 12 (D-X) requires a follow-up 1D.
    if (col === "starport" && value === "D-X") {
      const dr = roll(1);
      value = data.starportXRoll.results[String(dr)] ?? "X";
    }
    (result as Record<string, string>)[col] = value;
  }

  const hw = result as Homeworld;
  // The caller (generateAndApplyHomeworld) logs the homeworld; don't
  // double-log in verbose mode.
  return hw;
}

interface DmConditionWhen {
  column?: string;
  equals?: string;
  in?: string[];
  atLeast?: string;
}

function matchesCondition(
  w: DmConditionWhen | undefined,
  partial: Partial<Homeworld>,
  techCodeOrder?: string[],
): boolean {
  if (!w?.column) return false;
  const actual = (partial as Record<string, string | undefined>)[w.column];
  if (actual === undefined) return false;
  if (w.equals !== undefined) return actual === w.equals;
  if (w.in) return w.in.includes(actual);
  if (w.atLeast && techCodeOrder && w.column === "tech") {
    return techCodeOrder.indexOf(actual) >= techCodeOrder.indexOf(w.atLeast);
  }
  return false;
}

/** Apply the homeworld's default skills to the character. */
export function applyHomeworldSkills(ch: Character, hw: Homeworld): void {
  const data = dataFor(ch.editionId);
  if (!data) return;
  for (const entry of data.defaultSkills) {
    if (!evalDefaultSkillCondition(entry, hw, ch, data.techCodeOrder)) continue;
    if (ch.checkSkill(entry.skill) >= 0) continue; // already known
    ch.addSkill(entry.skill, entry.level, "Homeworld");
  }
}

function evalDefaultSkillCondition(
  entry: HomeworldData["defaultSkills"][number],
  hw: Homeworld,
  ch: Character,
  techCodeOrder: string[],
): boolean {
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
  ch.log(ev.homeworld(
    hw.starport, hw.size, hw.atmosphere, hw.hydrosphere,
    hw.population, hw.law, hw.tech,
  ));
  // Default skills depend on the service; here we apply only the
  // tech-based ones since service isn't yet selected. The service-based
  // skills are applied at enlistment time.
  const data = dataFor(ch.editionId)!;
  for (const entry of data.defaultSkills) {
    // Filter to tech-conditional entries only (when.techAtLeast/techIn with
    // no service condition); service-based skills apply at enlistment.
    const isTechOnly =
      (entry.when.techAtLeast !== undefined || entry.when.techIn !== undefined) &&
      entry.when.serviceIn === undefined && entry.when.serviceNotIn === undefined;
    if (!isTechOnly) continue;
    if (evalDefaultSkillCondition(entry, hw, ch, data.techCodeOrder)) {
      if (ch.checkSkill(entry.skill) < 0) {
        ch.addSkill(entry.skill, entry.level, "Homeworld");
      }
    }
  }
  return hw;
}
