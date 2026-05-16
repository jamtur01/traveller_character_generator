// Edition-aware cascade lookup. The cellResolver and Character methods that
// resolve cascade labels ("Blade Cbt", "Vehicle", "Physical", etc.) consult
// the *active edition's* cascadeSkills declaration via this helper. That
// keeps CT's blade list (Dagger, Sword, Cutlass, ...) from leaking into MT
// (Axe, Cudgel, Foil, Large Blade, Polearm, Small Blade) and vice versa.
//
// A small alias table normalizes the printed cell labels to the JSON
// cascadeSkills keys. Editions that lack a particular cascade key won't
// match any label — the caller treats the cell as a literal skill in that
// case (which fails fast if the cell is actually a cascade-only label).

import { getEdition } from "../editions";

/** Printed cell label → cascade key in JSON cascadeSkills. */
const LABEL_TO_KEY: Record<string, string> = {
  // Combat cascades — CT and MT share these aliases, but the pools differ.
  "blade cbt": "bladeCombat",
  "blade combat": "bladeCombat",
  "blade": "bladeCombat",
  "gun cbt": "gunCombat",
  "gun combat": "gunCombat",
  "gun": "gunCombat",
  "bow cbt": "bowCombat",
  "bow combat": "bowCombat",
  "bow": "bowCombat",
  // Vehicle family.
  "vehicle": "vehicle",
  "air craft": "aircraft",
  "aircraft": "aircraft",
  "water craft": "watercraft",
  "watercraft": "watercraft",
  // MT-specific cascades.
  "physical": "physical",
  "mental": "mental",
  "vice": "vice",
  "hand cbt": "handCombat",
  "hand combat": "handCombat",
  "inborn": "inborn",
  "space": "space",
  "space cbt": "spaceCombat",
  "space combat": "spaceCombat",
  "space tech": "spaceTech",
  "special cbt": "specialCombat",
  "special combat": "specialCombat",
  "technical": "technical",
  "interpersonal": "interpersonal",
  "science": "science",
  "academic": "academic",
  "exploratory": "exploratory",
  "environ": "environ",
  "economic": "economic",
  "archaic weapons": "archaicWeapons",
  "animal handling": "animalHandling",
  "gunnery": "gunnery",
  "field artillery gunnery": "fieldArtilleryGunnery",
  "fa gunnery": "fieldArtilleryGunnery",
};

/** Resolve a cell label to the cascade pool defined by the edition.
 *  Returns undefined if the label isn't a recognized cascade alias OR the
 *  edition doesn't declare that cascade (both cases mean "treat as literal"). */
export function cascadePoolForLabel(
  label: string,
  editionId: string,
): readonly string[] | undefined {
  const key = LABEL_TO_KEY[label.toLowerCase().trim()];
  if (!key) return undefined;
  const edition = getEdition(editionId);
  const cascades = (edition.data as { cascadeSkills?: Record<string, readonly string[]> })
    .cascadeSkills;
  return cascades?.[key];
}

/** Is this label a cascade alias at all (independent of edition)? Used by
 *  the resolver to distinguish "unknown cascade for this edition — error"
 *  from "literal skill name". */
export function isCascadeLabel(label: string): boolean {
  return LABEL_TO_KEY[label.toLowerCase().trim()] !== undefined;
}

/** Get the named cascade pool for the given edition. Used by Character
 *  methods like doBladeBenefit that need a specific cascade pool. */
export function cascadePoolByKey(
  cascadeKey: string,
  editionId: string,
): readonly string[] {
  const edition = getEdition(editionId);
  const cascades = (edition.data as { cascadeSkills?: Record<string, readonly string[]> })
    .cascadeSkills;
  const pool = cascades?.[cascadeKey];
  if (!pool) {
    throw new Error(
      `Edition "${editionId}" has no cascade pool "${cascadeKey}"`,
    );
  }
  return pool;
}
