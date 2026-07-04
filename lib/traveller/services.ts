// Service registry — per-edition. Each registered edition has its own
// services map built at import time from its JSON. Code that operates
// on a specific Character uses ch.editionId to look up the right map
// via getEditionServices.

import type { ServiceDef, ServiceKey } from "./types";
import { getEdition, listEditions } from "./editions";
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

// Build the service map for every registered edition exactly once at
// module import. Adding an edition to the registry automatically makes
// it available through getEditionServices without further setup.
for (const meta of listEditions()) {
  REGISTRY[meta.id] = buildEdition(meta.id);
}

/** Returns the service map for the given edition (built once at import). */
export function getEditionServices(editionId: string): ServiceMap {
  const map = REGISTRY[editionId];
  if (!map) throw new Error(`Unknown edition: ${editionId}`);
  return map;
}

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
  const known = CLASSIC_ORDER.filter((k) => map[k] !== undefined);
  // A JSON service key missing from the presentation order must not vanish
  // from the enlistment pool — append unknowns after the classic ordering.
  // Services whose enlistment declares automaticIf (nobles: auto-enroll on
  // Soc 10+, CotI) are not voluntarily enlistable and stay out of the pool.
  const jsonServices = getEdition(editionId).data.services;
  const rest = (Object.keys(map) as ServiceKey[]).filter(
    (k) => !CLASSIC_ORDER.includes(k)
      && !jsonServices[k]?.checks.enlistment.automaticIf,
  );
  return [...known, ...rest];
}

/** Services available for random enlistment selection in the given
 *  edition, in the CT-classic visual order (with non-CT services
 *  appended in declaration order). */
export function getEnlistableServices(editionId: string): ServiceKey[] {
  return computeEnlistable(editionId);
}

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

/** Draft pool for the edition, keyed by 1d6 result. Derived from each
 *  service's `draft` field in JSON. */
export function getDraftServices(editionId: string): ServiceKey[] {
  return computeDraft(editionId);
}

export function serviceLabel(key: ServiceKey, editionId: string): string {
  const map = getEditionServices(editionId);
  return map[key]?.serviceName ?? key;
}
