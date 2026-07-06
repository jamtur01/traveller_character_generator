// Service registry — per-edition. Each registered edition has its own
// services map built at import time from its JSON. Code that operates
// on a specific Character uses ch.editionId to look up the right map
// via getEditionServices.

import type { ServiceDef, ServiceKey } from "./types";
import { getEdition, listEditions } from "./editions";
import { buildServiceDef } from "./engine/serviceLoader";
import { requireRule } from "./editions/strict";

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
  // A careers-model edition (e.g. Mongoose) declares no services and has no
  // basic-enlistment pool; there is nothing to order and no serviceOrder to
  // require. Every service-model edition proceeds to the fail-loud read.
  if (!map || Object.keys(map).length === 0) return [];
  // The declared, $rule-cited serviceOrder lists every service in
  // enlistment/draft presentation order (CT: TTB p. 18; MT: PM service
  // order). The enlistable pool is that order restricted to services present
  // in the active map and NOT auto-enrolled: nobles carry an enlistment
  // automaticIf (Soc 10+, CotI) and are auto-enrolled rather than voluntarily
  // enlisted, so they never appear in the pool.
  const ed = getEdition(editionId);
  const order = requireRule(
    ed.data.serviceOrder,
    `${editionId}: serviceOrder`,
    "TTB p. 18 / PM service order",
  ) as readonly ServiceKey[];
  const jsonServices = ed.data.services;
  return order.filter(
    (k) => map[k] !== undefined
      && !jsonServices[k]?.checks.enlistment.automaticIf,
  );
}

/** Services available for random enlistment selection in the given edition,
 *  in declared serviceOrder (CT: TTB p. 18; MT: PM service order), minus
 *  auto-enrolled services (enlistment automaticIf). */
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
