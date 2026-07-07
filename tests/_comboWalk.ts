// Coverage-combo dispatch + labelling — the one place that turns a
// coverageMatrix() `CoverageCombo` into a walked `WalkResult` and into the
// human/filesystem labels the sample viewer and the exhaustive coverage
// drivers share.
//
// Before this helper the identical combo->walker `switch` lived (twice) inside
// tests/fullCoverage.test.ts and tests/fullCoverageSeeded.test.ts; both now
// import `walkCombo` / `comboLabel` from here so the dispatch has a single
// definition. `comboSlug` / `sheetFileName` add the filesystem-safe naming the
// per-combo sheet dump (tests/sampleDump.demo.test.ts) writes with, and
// `selectCombo` resolves an env-var combo selector back to its combo for the
// on-demand sample viewer.
//
// This module only WALKS; it never validates. Callers run
// assertCharacterConsistent on the returned character (the drivers do so as
// their oracle; the sample files do so before printing/writing a sheet), so a
// combo can never surface a sheet that failed its whole-character invariants.

import { coverageMatrix, type CoverageCombo } from "@/tests/_coverageMatrix";
import { walkAcg, walkBasic, walkMongoose, type WalkResult } from "@/tests/_walker";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

// Registry picks arrive as Readonly<Record<string,string>>; the option-domain
// audit-locks + the coverageMatrix self-check prove those values ARE the
// declared union members, so narrowing them to the walkers' literal-union
// params is a sound unchecked cast (the compiler cannot narrow a Record read).
// The narrowed value is handed straight to the walker (re-typed via
// EnlistOptions), never trusted for a member access.
type WalkBasicOpts = Parameters<typeof walkBasic>[0];
type WalkAcgOpts = Parameters<typeof walkAcg>[0];

/** The deterministic seed the per-combo dump uses, and the default the
 *  on-demand viewer falls back to when SAMPLE_SEED is unset. Seed 1 is inside
 *  the 1..20 band fullCoverageSeeded.test.ts validates for every combo, so a
 *  sheet generated at this seed is a proven-consistent character. */
export const DEFAULT_SAMPLE_SEED = 1;

/** Dispatch one combo to its chargen-model walker. `seed` undefined -> each
 *  walker's deterministic default (basic/acg pin an all-6s stream, mongoose
 *  uses its fixed internal seed); a number threads that seed through the
 *  character's own mulberry32 rng (the UI/replay path). */
export function walkCombo(combo: CoverageCombo, seed?: number): WalkResult {
  switch (combo.model) {
    case "classic":
      return walkBasic({
        edition: combo.edition as WalkBasicOpts["edition"],
        service: combo.service,
        ...(seed !== undefined ? { seed } : {}),
      });
    case "acg": {
      // exactOptionalPropertyTypes forbids an explicit `undefined`, and a
      // pathway's picks only carry the sub-domains it crosses (navy has no
      // acgService, mercenary has no acgFleet, ...), so assign each optional
      // field only when its pick is present; the walker fills the rest.
      const p = combo.picks;
      const opts: WalkAcgOpts = {
        pathway: combo.pathway as WalkAcgOpts["pathway"],
        ...(seed !== undefined ? { seed } : {}),
      };
      if (p.acgService !== undefined) opts.service = p.acgService as EnlistOptions["acgService"];
      if (p.acgCombatArm !== undefined) opts.combatArm = p.acgCombatArm;
      if (p.acgFleet !== undefined) opts.fleet = p.acgFleet as EnlistOptions["acgFleet"];
      if (p.acgDivision !== undefined) opts.division = p.acgDivision as EnlistOptions["acgDivision"];
      if (p.acgLineType !== undefined) opts.lineType = p.acgLineType;
      if (p.acgSubsectorTech !== undefined) opts.subsectorTech = p.acgSubsectorTech;
      return walkAcg(opts);
    }
    case "mongoose":
      return walkMongoose({
        career: combo.career,
        ...(seed !== undefined ? { seed } : {}),
      });
  }
}

/** Human-readable label naming the exact combo (it.each names + sample header). */
export function comboLabel(combo: CoverageCombo): string {
  switch (combo.model) {
    case "classic":
      return `${combo.edition} · classic · service=${combo.service}`;
    case "acg": {
      const picks = Object.entries(combo.picks)
        .map(([field, value]) => `${field}=${value}`)
        .join(", ");
      return `${combo.edition} · acg · ${combo.pathway}${picks ? ` · ${picks}` : ""}`;
    }
    case "mongoose":
      return `${combo.edition} · mongoose · career=${combo.career}`;
  }
}

/** Filesystem-safe token: alphanumerics kept, every other run collapsed to a
 *  single "-", ends trimmed; an all-non-alnum value (e.g. the empty
 *  subsectorTech) becomes "none" so a slug is never empty or edge-hyphenated. */
function slug(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "none";
}

/** Filesystem-safe combo identifier (the part after the edition prefix in a
 *  dumped sheet's filename, and the SAMPLE_COMBO selector value). Every field
 *  that discriminates a combo within its {edition, model} appears, so distinct
 *  combos yield distinct slugs (the dump asserts this). */
export function comboSlug(combo: CoverageCombo): string {
  switch (combo.model) {
    case "classic":
      return `classic__service-${slug(combo.service)}`;
    case "acg": {
      const picks = Object.entries(combo.picks)
        .map(([field, value]) => `${slug(field)}-${slug(value)}`)
        .join("__");
      return `acg__${slug(combo.pathway)}${picks ? `__${picks}` : ""}`;
    }
    case "mongoose":
      return `mongoose__career-${slug(combo.career)}`;
  }
}

/** The dumped sheet's filename: `<edition>__<comboSlug>.txt`. */
export function sheetFileName(combo: CoverageCombo): string {
  return `${slug(combo.edition)}__${comboSlug(combo)}.txt`;
}

/** Resolve an on-demand selection (edition + combo selector) to its combo.
 *  The selector accepts the bare `comboSlug`, or a full dumped filename
 *  (`<edition>__<slug>` with or without a `.txt` suffix). Throws a loud,
 *  actionable error naming the valid selectors when nothing matches, so a
 *  typo can never silently generate the wrong character. */
export function selectCombo(edition: string, selector: string): CoverageCombo {
  const matrix = coverageMatrix();
  const forEdition = matrix.filter((c) => c.edition === edition);
  if (forEdition.length === 0) {
    const editions = [...new Set(matrix.map((c) => c.edition))].sort().join(", ");
    throw new Error(
      `sample: unknown SAMPLE_EDITION "${edition}". Active editions: ${editions}`,
    );
  }
  let key = selector.endsWith(".txt") ? selector.slice(0, -4) : selector;
  const prefix = `${slug(edition)}__`;
  if (key.startsWith(prefix)) key = key.slice(prefix.length);
  const match = forEdition.find((c) => comboSlug(c) === key);
  if (match === undefined) {
    const available = forEdition.map(comboSlug).sort().join("\n  ");
    throw new Error(
      `sample: no combo "${key}" for edition "${edition}". ` +
        `Set SAMPLE_COMBO to one of:\n  ${available}`,
    );
  }
  return match;
}
