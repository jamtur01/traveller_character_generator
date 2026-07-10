// Citation audit for the nine narrative-glossary commits (fa7c7d4..933a185).
//
// Each commit lifted an explanatory one-liner verbatim from a rulebook and logs
// it verbose at an engine emission point. A glossary block or entry with no
// sibling page-citation is either invented or drifted from its source — a
// silent corruption of the character log. This audit reads the on-disk edition
// JSON directly (never through an accessor, so it pins the shipped data) and
// asserts, per edition, that EVERY glossary block added by these commits:
//   1. exists and carries at least one entry (non-vacuous), and
//   2. every entry is a non-empty narrative string (or {code,name,meaning}), and
//   3. is covered by a sibling `$`-citation that names a source page.
//
// Teeth: blank an entry, drop a `$`-citation, or wipe a block and the matching
// row reddens. The blocks are enumerated by their exact JSON path so a renamed
// or relocated block also reddens rather than silently escaping the audit.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A citation names a source page: a non-empty string containing a digit. */
function isPageCitation(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0 && /\d/.test(v);
}

function loadEdition(id: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(__dirname, `../../data/editions/${id}.json`), "utf8"),
  );
  if (!isRecord(raw)) throw new Error(`edition ${id} JSON is not an object`);
  return raw;
}

const MT = loadEdition("mt-megatraveller");
const CT = loadEdition("ct-classic");
const MG = loadEdition("mongoose-2e");

/** Assert `block` is a non-empty object glossary whose every entry is a
 *  non-empty string, and that `citation` (its sibling) names a page. */
function assertObjectGlossary(
  block: unknown, citation: unknown, name: string,
): void {
  expect(isRecord(block), `${name} must be an object glossary`).toBe(true);
  const entries = Object.entries(block as Record<string, unknown>)
    .filter(([k]) => !k.startsWith("$"));
  expect(entries.length, `${name} must ship entries (non-vacuous)`).toBeGreaterThan(0);
  for (const [key, value] of entries) {
    expect(typeof value, `${name}.${key} must be a string`).toBe("string");
    expect(String(value).trim().length, `${name}.${key} must be non-empty`).toBeGreaterThan(0);
  }
  expect(isPageCitation(citation), `${name} needs a $-citation naming a page`).toBe(true);
}

// ---------------------------------------------------------------------------
// Mongoose (fa7c7d4 non-skill glossaries, 61e7292 skill definitions).
// ---------------------------------------------------------------------------

describe("Mongoose glossary blocks are cited (fa7c7d4, 61e7292)", () => {
  const M = MG.mongoose as Record<string, unknown>;

  it("mongoose block is present", () => {
    expect(isRecord(M), "mongoose sub-block missing").toBe(true);
  });

  it("materialBenefits (Core pp.47-48) is cited", () => {
    assertObjectGlossary(M.materialBenefits, M.$materialBenefits, "mongoose.materialBenefits");
  });

  it("benefitGlossary — ship shares / pensions (Core p.49) is cited", () => {
    assertObjectGlossary(M.benefitGlossary, M.$benefitGlossary, "mongoose.benefitGlossary");
  });

  it("connections — contact/ally/rival/enemy (Core pp.20-21) is cited", () => {
    assertObjectGlossary(M.connections, M.$connections, "mongoose.connections");
  });

  it("skillDefinitions (Core pp.64-72) is cited", () => {
    assertObjectGlossary(M.skillDefinitions, M.$skillDefinitions, "mongoose.skillDefinitions");
  });

  it("agingCrisisGlossary is a non-empty string cited by the sibling $aging (Core p.49)", () => {
    // The ageing-crisis note is a single string, so it carries no dedicated
    // `$agingCrisisGlossary` sibling; its page-citation is the co-located
    // `$aging`, which names the exact rule ("Reduce to 0 -> ageing crisis").
    expect(typeof M.agingCrisisGlossary).toBe("string");
    expect(String(M.agingCrisisGlossary).trim().length).toBeGreaterThan(0);
    expect(isPageCitation(M.$aging), "mongoose.$aging must cite Core p.49 for the ageing crisis").toBe(true);
    expect(String(M.$aging)).toMatch(/p\.?\s*49/i);
  });
});

// ---------------------------------------------------------------------------
// MT (2480589 non-skill glossaries, ab0ae1a skills, fb22216 characteristics).
// ---------------------------------------------------------------------------

describe("MT glossary blocks are cited (2480589, ab0ae1a, fb22216)", () => {
  const HW = MT.homeworld as Record<string, unknown>;
  const ACG = MT.advancedCharacterGeneration as Record<string, unknown>;
  const COMMON = (ACG?.common ?? {}) as Record<string, unknown>;

  it("musterBenefitDefinitions (PM p.19) is cited", () => {
    assertObjectGlossary(MT.musterBenefitDefinitions, MT.$musterBenefitDefinitions, "mt.musterBenefitDefinitions");
  });

  it("skillDefinitions (PM pp.30-40) is cited", () => {
    assertObjectGlossary(MT.skillDefinitions, MT.$skillDefinitions, "mt.skillDefinitions");
  });

  it("every UWP profile-code table (PM p.13) is cited", () => {
    expect(isRecord(HW), "mt.homeworld missing").toBe(true);
    const tables = [
      "starportTypes", "sizeCodes", "atmosphereCodes",
      "hydrosphereCodes", "populationCodes", "lawCodes",
    ] as const;
    for (const t of tables) {
      assertObjectGlossary(HW[t], HW[`$${t}`], `mt.homeworld.${t}`);
    }
  });

  it("decorationDefinitions (PM pp.46/49/57) is cited", () => {
    assertObjectGlossary(COMMON.decorationDefinitions, COMMON.$decorationDefinitions, "mt.common.decorationDefinitions");
  });

  it("schoolDefinitions (PM pp.44-63) — every namespace entry is cited", () => {
    const block = COMMON.schoolDefinitions;
    expect(isRecord(block), "mt.common.schoolDefinitions missing").toBe(true);
    const namespaces = Object.entries(block as Record<string, unknown>)
      .filter(([k]) => !k.startsWith("$"));
    expect(namespaces.length, "schoolDefinitions must ship namespaces").toBeGreaterThan(0);
    for (const [ns, entries] of namespaces) {
      // The block-level $schoolDefinitions covers all namespaces; each entry
      // must still be a non-empty string.
      expect(isRecord(entries), `schoolDefinitions.${ns} must be an object`).toBe(true);
      for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
        if (k.startsWith("$")) continue;
        expect(typeof v, `schoolDefinitions.${ns}.${k} must be a string`).toBe("string");
        expect(String(v).trim().length).toBeGreaterThan(0);
      }
    }
    expect(isPageCitation(COMMON.$schoolDefinitions), "mt.common.$schoolDefinitions").toBe(true);
  });

  it("court-martial concept (PM p.47) is a cited string", () => {
    const cm = COMMON.courtMartial as Record<string, unknown>;
    expect(isRecord(cm), "mt.common.courtMartial missing").toBe(true);
    expect(typeof cm.concept, "courtMartial.concept must be a string").toBe("string");
    expect(String(cm.concept).trim().length).toBeGreaterThan(0);
    expect(isPageCitation(cm.$concept), "courtMartial.$concept must name a page").toBe(true);
  });

  it("brownie-point concept (PM p.46) is a cited string", () => {
    const bp = COMMON.browniePoints as Record<string, unknown>;
    expect(isRecord(bp), "mt.common.browniePoints missing").toBe(true);
    expect(typeof bp.rule, "browniePoints.rule must be a string").toBe("string");
    expect(String(bp.rule).trim().length).toBeGreaterThan(0);
    expect(isPageCitation(bp.$rule), "browniePoints.$rule must name a page").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CT (83da80e muster+position, 8d705f9 skills, 933a185 characteristics).
// ---------------------------------------------------------------------------

describe("CT glossary blocks are cited (83da80e, 8d705f9, 933a185)", () => {
  it("musterBenefitDefinitions (TTB pp.29-30 / CotI pp.13-15) is cited", () => {
    assertObjectGlossary(CT.musterBenefitDefinitions, CT.$musterBenefitDefinitions, "ct.musterBenefitDefinitions");
  });

  it("skillDefinitions (TTB pp.21-28 / CotI pp.10-18) is cited", () => {
    assertObjectGlossary(CT.skillDefinitions, CT.$skillDefinitions, "ct.skillDefinitions");
  });
});
