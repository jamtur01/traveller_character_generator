// Service registry — per-edition. Each registered edition has its own
// services map built at import time from its JSON. Code that operates on a
// specific Character uses ch.editionId to look up the right map; legacy
// callers that don't carry edition context fall back to the default edition
// via `s`.

import type { ServiceDef, ServiceKey } from "./types";
import {
  DEFAULT_EDITION_ID, getEdition, listEditions,
} from "./editions";
import { buildServiceDef } from "./engine/serviceLoader";

export type ServiceMap = Partial<Record<ServiceKey, ServiceDef>>;

const REGISTRY: Record<string, ServiceMap> = {};

function buildEdition(editionId: string): ServiceMap {
  const ed = getEdition(editionId);
  const out: ServiceMap = {};
  for (const k of Object.keys(ed.data.services) as ServiceKey[]) {
    const data = ed.data.services[k];
    if (!data) continue;
    out[k] = buildServiceDef(data, ed);
  }
  return out;
}

// Build the service map for every registered edition exactly once at module
// import. Adding an edition to the registry automatically makes it available
// through getEditionServices without further setup.
for (const meta of listEditions()) {
  REGISTRY[meta.id] = buildEdition(meta.id);
}

/** Returns the service map for the given edition (built once at import). */
export function getEditionServices(editionId: string): ServiceMap {
  const map = REGISTRY[editionId];
  if (!map) throw new Error(`Unknown edition: ${editionId}`);
  return map;
}

/** Default-edition service map. Existing callers that don't carry edition
 *  context (most tests, legacy character.ts paths) continue to use this.
 *
 *  Typed as a full Record for back-compat with the original ServiceKey-keyed
 *  layout. Keys not present in the default edition (e.g., `lawenforcers`
 *  when CT is default) return undefined at runtime — accessing methods on
 *  them throws TypeError, which is the desired "edition leak" behavior.
 *  Edition-aware code should call getEditionServices(ch.editionId) instead.
 */
export const s = REGISTRY[DEFAULT_EDITION_ID]! as Record<ServiceKey, ServiceDef>;

/** All services available for random enlistment selection in the default
 *  edition. Use `getEnlistableServices(editionId)` for other editions. */
export const SERVICES: ServiceKey[] = computeEnlistable(DEFAULT_EDITION_ID);

function computeEnlistable(editionId: string): ServiceKey[] {
  const map = REGISTRY[editionId];
  if (!map) return [];
  // CT's classic order put "other" mid-list; preserve that visual order
  // when iterating, but drop services that don't exist in the active map.
  const CLASSIC_ORDER: ServiceKey[] = [
    "navy", "marines", "army", "scouts", "merchants", "pirates", "other",
    "belters", "sailors", "diplomats", "doctors", "flyers", "barbarians",
    "bureaucrats", "rogues", "scientists", "hunters", "lawenforcers",
  ];
  return CLASSIC_ORDER.filter((k) => map[k] !== undefined);
}

export function getEnlistableServices(editionId: string): ServiceKey[] {
  return computeEnlistable(editionId);
}

/** Draft pool keyed by 1d6 result. Derived from each service's `draft`
 *  field in JSON (CT: navy/marines/army/scouts/merchants/other; MT same six). */
export const DRAFT_SERVICES: ServiceKey[] = computeDraft(DEFAULT_EDITION_ID);

function computeDraft(editionId: string): ServiceKey[] {
  const ed = getEdition(editionId);
  const out: ServiceKey[] = [];
  for (let i = 1; i <= 6; i++) {
    for (const [k, svc] of Object.entries(ed.data.services)) {
      if (svc.draft === i) {
        out.push(k as ServiceKey);
        break;
      }
    }
  }
  return out;
}

export function getDraftServices(editionId: string): ServiceKey[] {
  return computeDraft(editionId);
}

/** UI-facing enlistment list — union of every registered edition's
 *  enlistable services. Pickers that show the full cross-edition catalog
 *  should use this list and resolve labels per the chosen edition via
 *  serviceLabel(key, editionId). Single-edition pickers should call
 *  getEnlistableServices(editionId) directly. */
export const ENLISTABLE_SERVICES: ServiceKey[] = (() => {
  const seen = new Set<ServiceKey>();
  const out: ServiceKey[] = [];
  for (const meta of listEditions()) {
    for (const k of computeEnlistable(meta.id)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
})();

export function serviceLabel(key: ServiceKey, editionId?: string): string {
  const map = editionId ? getEditionServices(editionId) : s;
  return map[key]?.serviceName ?? key;
}
