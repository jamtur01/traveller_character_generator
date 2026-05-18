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
/** Aliases come from the active edition's `cascadeAliases` JSON block. */
function aliasesFor(editionId: string): Record<string, string> {
  return (getEdition(editionId).data as {
    cascadeAliases?: Record<string, string>;
  }).cascadeAliases ?? {};
}

/** Resolve a cell label to the cascade pool defined by the edition.
 *  Returns undefined if the label isn't a recognized cascade alias OR the
 *  edition doesn't declare that cascade (both cases mean "treat as literal"). */
export function cascadePoolForLabel(
  label: string,
  editionId: string,
): readonly string[] | undefined {
  const key = aliasesFor(editionId)[label.toLowerCase().trim()];
  if (!key) return undefined;
  const edition = getEdition(editionId);
  return edition.data.cascadeSkills?.[key];
}

/** Is this label a cascade alias in the given edition? Used by the
 *  resolver to distinguish "unknown cascade for this edition — error"
 *  from "literal skill name". */
export function isCascadeLabel(label: string, editionId: string): boolean {
  return aliasesFor(editionId)[label.toLowerCase().trim()] !== undefined;
}

/** Resolve a cell label to its cascade JSON key (or null) for the
 *  given edition. */
export function cascadeKeyForLabel(label: string, editionId: string): string | null {
  return aliasesFor(editionId)[label.toLowerCase().trim()] ?? null;
}

/** Get the named cascade pool for the given edition. Used by Character
 *  methods like doBladeBenefit that need a specific cascade pool. */
export function cascadePoolByKey(
  cascadeKey: string,
  editionId: string,
): readonly string[] {
  const edition = getEdition(editionId);
  const pool = edition.data.cascadeSkills?.[cascadeKey];
  if (!pool) {
    throw new Error(
      `Edition "${editionId}" has no cascade pool "${cascadeKey}"`,
    );
  }
  return pool;
}
