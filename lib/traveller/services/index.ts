// Service registry. Imports each per-service definition file and assembles
// the `s` lookup keyed by ServiceKey.

import type { ServiceDef, ServiceKey } from "../types";

import { navy } from "./navy";
import { marines } from "./marines";
import { army } from "./army";
import { scouts } from "./scouts";
import { merchants } from "./merchants";
import { other } from "./other";
import { pirates } from "./pirates";
import { belters } from "./belters";
import { sailors } from "./sailors";
import { diplomats } from "./diplomats";
import { doctors } from "./doctors";
import { flyers } from "./flyers";
import { barbarians } from "./barbarians";
import { bureaucrats } from "./bureaucrats";
import { rogues } from "./rogues";
import { scientists } from "./scientists";
import { hunters } from "./hunters";
import { nobles } from "./nobles";

export const s: Record<ServiceKey, ServiceDef> = {
  navy, marines, army, scouts, merchants, other,
  pirates, belters, sailors, diplomats, doctors, flyers,
  barbarians, bureaucrats, rogues, scientists, hunters, nobles,
};

/** All services available for random enlistment selection. */
export const SERVICES: ServiceKey[] = [
  "navy", "marines", "army", "scouts", "merchants", "pirates", "other",
  "belters", "sailors", "diplomats", "doctors", "flyers", "barbarians",
  "bureaucrats", "rogues", "scientists", "hunters",
];

/**
 * Draft pool. TTB p. 24 column order: 1 Navy, 2 Marines, 3 Army, 4 Scouts,
 * 5 Merchants, 6 Other. (The original JS substituted CotI "sailors" and
 * "flyers" into slots 5/6 — corrected here to match TTB.)
 */
export const DRAFT_SERVICES: ServiceKey[] = [
  "navy", "marines", "army", "scouts", "merchants", "other",
];

/** Services the user can pick from in the UI dropdown. */
export const ENLISTABLE_SERVICES: ServiceKey[] = SERVICES;

export function serviceLabel(key: ServiceKey): string {
  return s[key].serviceName;
}
