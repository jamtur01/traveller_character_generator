// Edition view-model / query layer. Typed helpers that read a *validated*
// edition (`edition.rules` for the schema-checked rules view, `edition.data`
// for the validated canon blocks) and centralize the rule interpretation the
// UI and PDF renderer would otherwise inline. Keeping this knowledge in one
// place stops the presentation layer from re-deriving engine-owned rules out
// of raw JSON shape, where a JSON value change would silently drift from a
// hardcoded UI literal.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { cascadePoolByKey } from "@/lib/traveller/engine/cascadeMap";
import { requireRule } from "@/lib/traveller/editions/strict";

// ---------- term lifecycle -------------------------------------------------

/** Years per full term of service for the edition
 *  (rules.survival.fullTermYears; both current editions declare 4).
 *  Mirrors Character.fullTermYears() so the UI's term-age display can't
 *  drift from the value the engine advances chronological age by. */
export function termLengthYears(editionId: string): number {
  return requireRule(
    getEdition(editionId).rules.survival?.fullTermYears,
    "rules.survival.fullTermYears", "TTB p. 18 / PM p. 45",
  );
}

/** Whether `character` may attempt anagathics for the upcoming term. The
 *  edition must declare the anagathics rule (MT does, CT doesn't); the
 *  character must reach `minAge` (default 30) by term end and have served
 *  `minTerms` (default 3). Thresholds come from rules.anagathics.eligibility
 *  — the same source and defaults chargen/anagathics.tryAnagathics uses — so
 *  the term UI's opt-in gate matches the engine's eligibility check. */
export function anagathicsEligible(character: Character): boolean {
  const ed = getEdition(character.editionId);
  if (!ed.meta.hasAnagathics) return false;
  const elig = ed.rules.anagathics?.eligibility;
  const minAge = requireRule(
    elig?.minAge, "rules.anagathics.eligibility.minAge", "PM p. 16",
  );
  const minTerms = requireRule(
    elig?.minTerms, "rules.anagathics.eligibility.minTerms", "PM p. 16",
  );
  const ageAfterTerm = character.age + termLengthYears(character.editionId);
  return ageAfterTerm >= minAge && character.terms >= minTerms;
}

// ---------- character sheet rulebook lookups -------------------------------

/** Read the edition's includesSkills entry for `name` and return its
 *  constituent skill names (level suffix stripped). Empty array when `name`
 *  is not an Includes-skill umbrella. PM umbrellas (e.g. MT "Handgun" →
 *  Body Pistol / Pistol / Revolver / Snub Pistol) expand to their
 *  constituents at chargen-grant time, so the sheet filters must recognise
 *  the constituents the character actually holds. */
export function expandIncludes(editionId: string, name: string): string[] {
  const data = getEdition(editionId).data.includesSkills;
  if (!data) return [];
  const entry = data[name];
  if (!Array.isArray(entry)) return [];
  return entry
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/-\d+$/, "").trim());
}

/** Pistol skills for the sheet's "Preferred Pistol" row: the edition's
 *  gun-combat cascade entries ending in "Pistol" (plus Revolver — TTB lists
 *  it alongside the pistols), including any Includes-skill constituents. */
export function pistolSkills(editionId: string): Set<string> {
  const out = new Set<string>();
  if (!getEdition(editionId).data.cascadeSkills?.["gunCombat"]) return out;
  const guns = cascadePoolByKey("gunCombat", editionId);
  for (const g of guns) {
    if (g.endsWith("Pistol") || g === "Revolver") out.add(g);
    for (const inner of expandIncludes(editionId, g)) {
      if (inner.endsWith("Pistol") || inner === "Revolver") out.add(inner);
    }
  }
  return out;
}

/** Blade skills for the sheet's "Preferred Blade" row: the edition's
 *  blade-combat cascade plus each umbrella's Includes-skill constituents
 *  (so a Marine's expanded Cutlass-1 is still recognised as a blade). */
export function bladeSkills(editionId: string): Set<string> {
  const out = new Set<string>();
  if (!getEdition(editionId).data.cascadeSkills?.["bladeCombat"]) return out;
  for (const name of cascadePoolByKey("bladeCombat", editionId)) {
    out.add(name);
    for (const inner of expandIncludes(editionId, name)) out.add(inner);
  }
  return out;
}

/** Ship / major-possession benefit names: every benefitDetails entry that
 *  declares a `shipType`. */
export function shipNames(editionId: string): Set<string> {
  const out = new Set<string>();
  const details = getEdition(editionId).data.benefitDetails;
  if (!details) return out;
  for (const [k, v] of Object.entries(details)) {
    if (v?.shipType !== undefined) out.add(k);
  }
  return out;
}

/** Passage benefit display names sourced from benefitDetails.passages.
 *  That key is a nested record the flat `Record<string, BenefitDetail>`
 *  type doesn't model, so read it as `unknown` and narrow rather than
 *  asserting a shape. PM prints "Mid Passage"; TTB and some tables print
 *  "Middle Passage" — accept both as the same kind for display. */
export function passageNames(editionId: string): string[] {
  const passagesRaw: unknown = getEdition(editionId).data.benefitDetails?.passages;
  const out = new Set<string>();
  if (passagesRaw && typeof passagesRaw === "object") {
    for (const entry of Object.values(passagesRaw) as unknown[]) {
      if (
        entry && typeof entry === "object"
        && "displayName" in entry
        && typeof entry.displayName === "string"
        && entry.displayName.length > 0
      ) {
        out.add(entry.displayName);
      }
    }
  }
  if (out.has("Mid Passage")) out.add("Middle Passage");
  return [...out];
}

/** Printed rank title for an ACG character, or null when none can be
 *  derived (the caller falls back to the raw rank code). Numeric officer
 *  ranks O1-O6 map onto the basic service ladder (service.ranks[1..6]),
 *  covering most non-flag-officer mercenary/navy/merchant cases; flag
 *  officers (O7+) and scout IS-* codes fall through to null. */
export function acgRankTitle(c: Character): string | null {
  const code = c.acgState?.rankCode;
  if (!code) return null;
  const officerMatch = code.match(/^O(\d+)$/);
  if (officerMatch) {
    const n = parseInt(officerMatch[1]!, 10);
    const title = c.serviceDef().ranks[n];
    if (title) return title;
  }
  return null;
}

// ---------- Mongoose display labels ----------------------------------------
// Surfaced for the UI (app/** cannot import engine/** directly): the sheet,
// summary, and phase views render career/assignment display names and the
// rank-ladder title rather than raw ids / rank numbers.
export {
  careerLabel,
  assignmentLabel,
  currentCareerLabel,
  currentAssignmentLabel,
  currentRankTitle,
} from "@/lib/traveller/engine/mongoose/labels";
