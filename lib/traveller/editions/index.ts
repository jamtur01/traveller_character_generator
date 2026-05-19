// Edition registry. Each Traveller edition is one entry here, pairing
// canonical JSON data with its named-hook implementations.
//
// To add a new edition:
//   1. Drop a JSON file under data/editions/<id>.json conforming to types.ts
//   2. Create lib/traveller/editions/<id>/hooks.ts exporting EditionHooks
//   3. Add a registry entry below
//   4. The Character constructor / UI picker pick up the new id automatically

import ctClassicData from "../../../data/editions/ct-classic.json" with {
  type: "json",
};
import mtMegatravellerData from "../../../data/editions/mt-megatraveller.json" with {
  type: "json",
};
import { ctClassicHooks } from "./ct-classic/hooks";
import { mtMegatravellerHooks } from "./mt-megatraveller/hooks";
import type { CanonData, Edition, EditionMeta } from "./types";
import { parseRules, parseCanonData } from "./schema";
import { validateEditionAcgConfigs } from "../engine/acg";

function buildEdition(
  raw: unknown, hooks: Edition["hooks"], id: string,
): Edition {
  const data = raw as CanonData;
  // Validate the heavily-cast `rules` sub-object at edition load —
  // catches structural drift / typos that previously survived into
  // runtime via `as { ... }` casts at each call site.
  const rules = parseRules((data as { rules?: unknown }).rules, id);
  // Validate services / cascade / aging / includes etc. shapes too —
  // same motivation, broader coverage.
  parseCanonData(data, id);
  return { meta: data.edition, data, hooks, rules };
}

const REGISTRY: Record<string, Edition> = {
  "ct-classic": buildEdition(ctClassicData, ctClassicHooks, "ct-classic"),
  "mt-megatraveller": buildEdition(
    mtMegatravellerData, mtMegatravellerHooks, "mt-megatraveller",
  ),
};

export const DEFAULT_EDITION_ID = "ct-classic";

const ACG_VALIDATED = new Set<string>();

export function getEdition(id: string = DEFAULT_EDITION_ID): Edition {
  const ed = REGISTRY[id];
  if (!ed) throw new Error(`Unknown edition: ${id}`);
  if (!ACG_VALIDATED.has(id)) {
    // Lazy first-call ACG config validation. Pathway validators call
    // getEdition; the `has(id)` short-circuit makes that re-entry a
    // no-op. The validators run only at runtime (first getEdition call
    // post module init), so the editions ↔ engine/acg import cycle
    // resolves cleanly under ES module semantics.
    ACG_VALIDATED.add(id);
    validateEditionAcgConfigs(id);
  }
  return ed;
}

export function listEditions(): EditionMeta[] {
  return Object.values(REGISTRY).map((e) => e.meta);
}

/** Typed dynamic-key access to a pathway's ACG data. Centralizes the
 *  one needed cast (AcgData's index signature is `unknown` because
 *  `common` is structurally different from pathways) so consumers can
 *  read `getAcgPathway(ch, "mercenary")?.combatAssignments` without
 *  declaring an inline shape every time. */
export function getAcgPathway(
  editionId: string, key: string | undefined | null,
): import("./types").AcgPathwayData | undefined {
  if (!key) return undefined;
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
  return acg?.[key] as import("./types").AcgPathwayData | undefined;
}

export type { Edition, EditionMeta } from "./types";
