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
import { ctClassicHooks } from "./ct-classic/hooks";
import type { CanonData, Edition, EditionMeta } from "./types";

const REGISTRY: Record<string, Edition> = {
  "ct-classic": {
    meta: (ctClassicData as unknown as CanonData).edition,
    data: ctClassicData as unknown as CanonData,
    hooks: ctClassicHooks,
  },
};

export const DEFAULT_EDITION_ID = "ct-classic";

export function getEdition(id: string = DEFAULT_EDITION_ID): Edition {
  const ed = REGISTRY[id];
  if (!ed) throw new Error(`Unknown edition: ${id}`);
  return ed;
}

export function listEditions(): EditionMeta[] {
  return Object.values(REGISTRY).map((e) => e.meta);
}

export type { Edition, EditionMeta } from "./types";
