// Edition registry. Each Traveller edition is one entry here, pairing
// canonical JSON data with its named-hook implementations.
//
// To add a new edition:
//   1. Drop a JSON file under data/editions/<id>.json conforming to types.ts
//   2. Create lib/traveller/editions/<id>/hooks.ts exporting EditionHooks
//   3. Add a registry entry below
//   4. The Character constructor / UI picker pick up the new id automatically

import ctClassicData from "@/data/editions/ct-classic.json" with {
  type: "json",
};
import mtMegatravellerData from "@/data/editions/mt-megatraveller.json" with {
  type: "json",
};
import { ctClassicHooks } from "./ct-classic/hooks";
import { mtMegatravellerHooks } from "./mt-megatraveller/hooks";
import type { CanonData, Edition, EditionMeta } from "./types";
import { parseRules, parseCanonData } from "./schema";
import { validateEditionAcgConfigs } from "@/lib/traveller/engine/acg";
import { validateLifecycleSteps } from "@/lib/traveller/engine/runners/basic";

function buildEdition(
  raw: unknown, hooks: Edition["hooks"], id: string,
): Edition {
  // Validate + brand the canon data at load. The Zod schema (looseObject)
  // preserves every key while checking the shapes it models, so getEdition
  // returns the *parsed* instance, not the raw import. CanonDataValidated is
  // structurally the raw canon shape; the engine's richer CanonData view is a
  // superset the schema doesn't fully enumerate, so brand once here.
  const data = parseCanonData(raw, id) as unknown as CanonData;
  const rules = parseRules(data.rules, id);
  // Derive UI-facing capability flags once, from the validated rules, so
  // the presentation layer reads a typed flag instead of probing raw
  // `data.rules` shape (e.g. the old skillCap-presence MT proxy).
  const meta: EditionMeta = {
    ...data.edition,
    hasSkillCap: rules.skillCap != null,
    hasAnagathics: rules.anagathics != null,
  };
  return { meta, data, hooks, rules };
}

const REGISTRY: Record<string, Edition> = {
  "ct-classic": buildEdition(ctClassicData, ctClassicHooks, "ct-classic"),
  "mt-megatraveller": buildEdition(
    mtMegatravellerData, mtMegatravellerHooks, "mt-megatraveller",
  ),
};

export const DEFAULT_EDITION_ID = "ct-classic";

const RUNTIME_VALIDATED = new Set<string>();

export function getEdition(id: string = DEFAULT_EDITION_ID): Edition {
  const ed = REGISTRY[id];
  if (!ed) throw new Error(`Unknown edition: ${id}`);
  if (!RUNTIME_VALIDATED.has(id)) {
    // Lazy first-call validation. Pathway validators + lifecycle
    // validator call getEdition; the `has(id)` short-circuit makes
    // that re-entry a no-op. Runs only at runtime (first getEdition
    // call post module init), so the editions ↔ engine import cycle
    // resolves cleanly under ES module semantics.
    RUNTIME_VALIDATED.add(id);
    validateEditionAcgConfigs(id);
    validateLifecycleSteps(id);
  }
  return ed;
}

export function listEditions(): EditionMeta[] {
  return Object.values(REGISTRY).map((e) => e.meta);
}

/** Typed dynamic-key access to a pathway's ACG data. The four
 *  string-literal overloads narrow the return type to the pathway's
 *  typed data shape; the generic overload preserves back-compat for
 *  callers that pass a runtime string. */
export function getAcgPathway(
  editionId: string, key: "mercenary",
): import("../engine/acg/pathways/mercenary").MercenaryData &
  import("./types").AcgPathwayData | undefined;
export function getAcgPathway(
  editionId: string, key: "navy",
): import("../engine/acg/pathways/navy").NavyData &
  import("./types").AcgPathwayData | undefined;
export function getAcgPathway(
  editionId: string, key: "scout",
): import("../engine/acg/pathways/scout").ScoutData &
  import("./types").AcgPathwayData | undefined;
export function getAcgPathway(
  editionId: string, key: "merchantPrince",
): import("../engine/acg/pathways/merchantPrince").MerchantData &
  import("./types").AcgPathwayData | undefined;
export function getAcgPathway(
  editionId: string, key: string | undefined | null,
): import("./types").AcgPathwayData | undefined;
export function getAcgPathway(
  editionId: string, key: string | undefined | null,
): import("./types").AcgPathwayData | undefined {
  if (!key) return undefined;
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
  return acg?.[key] as import("./types").AcgPathwayData | undefined;
}

export type { Edition, EditionMeta } from "./types";
