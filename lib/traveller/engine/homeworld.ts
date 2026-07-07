// MT homeworld generation and tech-based career gating. Applies to MT
// basic chargen AND ACG (per the manual the homeworld step is shared).
// Per MT Players' Manual pp. 12-13.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import {
  buildPredicateContext, evaluatePredicate,
  type Predicate, type PredicateContext,
} from "@/lib/traveller/engine/predicate";
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
  columnDms: Array<Predicate & { column?: string; dm: number }>;
  defaultSkills: Array<Predicate & { skill: string; level: number; source?: string }>;
  careerAvailability: Array<{
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

// The gate keys availableServicesForHomeworld knows how to enforce, plus
// the `services` target. A careerAvailability rule carrying any other key
// would be silently ignored, so we reject it loudly instead.
const KNOWN_GATE_KEYS: Record<string, true> = {
  requiresTechAtLeast: true, requiresTechExactly: true,
  requiresPopulationAtLeast: true, requiresLawAtLeast: true,
  requiresAtmosphereAtLeast: true, requiresHydrosphereAtLeast: true,
  requiresSocialAtLeast: true, services: true,
};

const gateKeysChecked = new Set<string>();

/** Fail loud if any careerAvailability rule declares a gate key the engine
 *  does not handle — a future JSON gate dimension must not be silently
 *  ignored. Checked once per edition (first use), not per character. */
function assertKnownGateKeys(editionId: string, data: HomeworldData): void {
  if (gateKeysChecked.has(editionId)) return;
  for (const rule of data.careerAvailability) {
    for (const key of Object.keys(rule)) {
      if (!(key in KNOWN_GATE_KEYS)) {
        throw new Error(
          `Edition "${editionId}": homeworld.careerAvailability rule has ` +
          `unknown gate key "${key}" (handled keys: ` +
          `${Object.keys(KNOWN_GATE_KEYS).join(", ")}).`,
        );
      }
    }
  }
  gateKeysChecked.add(editionId);
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
 *  and columnDms. Mutates character history but not other state. */
export function rollHomeworld(ch: Character): Homeworld | null {
  const data = dataFor(ch.editionId);
  if (!data) return null;

  // Column order comes from the roll table itself (minus the "die" header),
  // so the DM-application order can't silently diverge from the table.
  const cols = data.rollTable.columns.filter((c) => c !== "die");
  const result: Partial<Homeworld> = {};

  const genCtx: PredicateContext = {
    attributes: ch.attributes,
    terms: ch.terms,
    homeworldColumns: result as Record<string, string | undefined>,
    techCodeOrder: data.techCodeOrder,
  };
  for (const col of cols) {
    let r = ch.rng.roll(2);
    // Cross-column DMs: columnDms filtered by the rolled column, then
    // matched via the shared predicate against the partial homeworld.
    for (const rule of data.columnDms ?? []) {
      if (rule.column && rule.column !== col) continue;
      if (evaluatePredicate(rule, genCtx)) r += rule.dm;
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
      const dr = ch.rng.roll(1);
      value = requireRule(
        data.starportXRoll.results[String(dr)],
        `homeworld.starportXRoll.results["${dr}"]`, "MT homeworld starport table",
      );
    }
    (result as Record<string, string>)[col] = value;
  }

  const hw = result as Homeworld;
  // The caller (generateAndApplyHomeworld) logs the homeworld; don't
  // double-log in verbose mode.
  return hw;
}

/** Apply the homeworld's default skills to the character. */
export function applyHomeworldSkills(ch: Character): void {
  const data = dataFor(ch.editionId);
  if (!data) return;
  const ctx = buildPredicateContext(ch);
  for (const entry of data.defaultSkills) {
    if (!evaluatePredicate(entry, ctx)) continue;
    if (ch.checkSkill(entry.skill) >= 0) continue; // already known
    ch.addSkill(entry.skill, entry.level, "Homeworld");
  }
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
  assertKnownGateKeys(ch.editionId, data);
  const denied = new Set<string>();
  for (const rule of data.careerAvailability) {
    let triggers = false;
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
  const ctx = buildPredicateContext(ch);
  for (const entry of data.defaultSkills) {
    // Tech-conditional entries only (no service condition); the service-based
    // skills apply at enlistment once the service is chosen.
    if (entry.serviceIn !== undefined || entry.serviceNotIn !== undefined) continue;
    const isTech = entry.homeworldTechAtLeast !== undefined
      || entry.homeworldField?.field === "tech";
    if (!isTech) continue;
    if (evaluatePredicate(entry, ctx) && ch.checkSkill(entry.skill) < 0) {
      ch.addSkill(entry.skill, entry.level, "Homeworld");
    }
  }
  return hw;
}
