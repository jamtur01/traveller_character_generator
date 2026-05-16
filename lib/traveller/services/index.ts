// Service registry. The 18 services for the active edition are built at
// import time from the canonical JSON data by the engine's service loader.
// To inspect a service's behavior, read the JSON entry under
// data/editions/<id>.json — the runtime ServiceDef is a faithful projection.

import type { ServiceDef, ServiceKey } from "../types";
import { DEFAULT_EDITION_ID, getEdition } from "../editions";
import { buildServiceDef } from "../engine/serviceLoader";

const ACTIVE_EDITION = getEdition(DEFAULT_EDITION_ID);

const SERVICE_KEYS: ServiceKey[] = [
  "navy", "marines", "army", "scouts", "merchants", "other",
  "pirates", "belters", "sailors", "diplomats", "doctors", "flyers",
  "barbarians", "bureaucrats", "rogues", "scientists", "hunters", "nobles",
];

function buildAll(): Record<ServiceKey, ServiceDef> {
  const out = {} as Record<ServiceKey, ServiceDef>;
  for (const k of SERVICE_KEYS) {
    const data = ACTIVE_EDITION.data.services[k];
    if (!data) throw new Error(`Edition ${ACTIVE_EDITION.meta.id} missing service "${k}"`);
    out[k] = buildServiceDef(data, ACTIVE_EDITION);
  }
  return out;
}

export const s: Record<ServiceKey, ServiceDef> = buildAll();

/** All services available for random enlistment selection. */
export const SERVICES: ServiceKey[] = [
  "navy", "marines", "army", "scouts", "merchants", "pirates", "other",
  "belters", "sailors", "diplomats", "doctors", "flyers", "barbarians",
  "bureaucrats", "rogues", "scientists", "hunters",
];

/**
 * Draft pool. TTB p. 24 column order: 1 Navy, 2 Marines, 3 Army, 4 Scouts,
 * 5 Merchants, 6 Other.
 */
export const DRAFT_SERVICES: ServiceKey[] = [
  "navy", "marines", "army", "scouts", "merchants", "other",
];

/** Services the user can pick from in the UI dropdown. */
export const ENLISTABLE_SERVICES: ServiceKey[] = SERVICES;

export function serviceLabel(key: ServiceKey): string {
  return s[key].serviceName;
}
