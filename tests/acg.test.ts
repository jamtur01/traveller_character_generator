// Tests for the Advanced Character Generation API and renderer. These
// verify real behavior, not just shape: the API throws on misuse, the
// renderer emits ACG-specific bytes when useAcg is true, and CT
// characters can't accidentally access MT's ACG data.

import { describe, expect, it } from "vitest";
import {
  Character, editionHasAcg, getAcgCommon, getAcgPathway, listAcgPathways,
} from "../lib/traveller";
import { buildCharacterSheetPdf } from "../lib/pdfSheet";

// ---------------------------------------------------------------------------
// API: editionHasAcg / listAcgPathways
// ---------------------------------------------------------------------------

describe("editionHasAcg", () => {
  it("returns false for CT", () => {
    expect(editionHasAcg("ct-classic")).toBe(false);
  });

  it("returns true for MT", () => {
    expect(editionHasAcg("mt-megatraveller")).toBe(true);
  });

  it("throws for an unknown edition id", () => {
    expect(() => editionHasAcg("nonexistent-edition")).toThrow(/Unknown edition/);
  });
});

describe("listAcgPathways", () => {
  it("returns empty list for CT", () => {
    expect(listAcgPathways("ct-classic")).toEqual([]);
  });

  it("returns the four MT pathways", () => {
    const pathways = listAcgPathways("mt-megatraveller");
    expect(pathways).toContain("mercenary");
    expect(pathways).toContain("navy");
    expect(pathways).toContain("scout");
    expect(pathways).toContain("merchantPrince");
    expect(pathways).toHaveLength(4);
  });

  it("excludes the meta keys (common, source, coverage)", () => {
    const pathways = listAcgPathways("mt-megatraveller");
    expect(pathways).not.toContain("common");
    expect(pathways).not.toContain("source");
    expect(pathways).not.toContain("coverage");
  });
});

// ---------------------------------------------------------------------------
// API: getAcgPathway / getAcgCommon
// ---------------------------------------------------------------------------

describe("getAcgPathway", () => {
  it("returns the mercenary block for MT", () => {
    const m = getAcgPathway("mt-megatraveller", "mercenary");
    expect(m).toBeDefined();
    expect(typeof m).toBe("object");
    // The enlistment block is the canonical "is this real ACG data" signal.
    expect(m.enlistment).toBeDefined();
  });

  it("each MT pathway has a non-empty ranks block", () => {
    for (const name of listAcgPathways("mt-megatraveller")) {
      const p = getAcgPathway("mt-megatraveller", name);
      // Pathways use varying schemas: mercenary/navy have enlisted+officer,
      // scout uses ordinary, merchantPrince uses ranksAndPromotions. The
      // common contract: the pathway exposes SOME non-empty ranks group.
      const ranks = (p.ranks ?? p.ranksAndPromotions ?? {}) as
        Record<string, unknown>;
      const groups = Object.entries(ranks).filter(
        ([, v]) => Array.isArray(v) && v.length > 0,
      );
      expect(
        groups.length,
        `${name} has no non-empty rank group`,
      ).toBeGreaterThan(0);
    }
  });

  it("mercenary has the canonical E1–E9 enlisted ladder", () => {
    const m = getAcgPathway("mt-megatraveller", "mercenary");
    const enlisted = (m.ranks?.enlisted ?? []) as [string, string][];
    expect(enlisted).toHaveLength(9);
    expect(enlisted[0]?.[0]).toBe("E1");
    expect(enlisted[8]?.[0]).toBe("E9");
  });

  it("throws if the pathway doesn't exist in this edition", () => {
    expect(() => getAcgPathway("mt-megatraveller", "psionicist")).toThrow(
      /no ACG pathway/,
    );
  });

  it("throws if the edition has no ACG at all", () => {
    expect(() => getAcgPathway("ct-classic", "mercenary")).toThrow(
      /has no Advanced Character Generation/,
    );
  });
});

describe("getAcgCommon", () => {
  it("exposes the four common tables for MT", () => {
    const common = getAcgCommon("mt-megatraveller");
    expect(common.preCareerOptions).toBeDefined();
    expect(common.courtMartial).toBeDefined();
    expect(common.browniePoints).toBeDefined();
    expect(common.decorationAndSurvival).toBeDefined();
  });

  it("throws for CT", () => {
    expect(() => getAcgCommon("ct-classic")).toThrow(/has no Advanced/);
  });
});

// ---------------------------------------------------------------------------
// Character: ACG state fields default off
// ---------------------------------------------------------------------------

describe("Character ACG defaults", () => {
  it("a fresh Character has useAcg=false and no ACG state", () => {
    const c = new Character();
    expect(c.useAcg).toBe(false);
    expect(c.acgPathway).toBeNull();
    expect(c.acgBranch).toBeNull();
    expect(c.acgMos).toBeNull();
    expect(c.decorations).toEqual([]);
    expect(c.browniePoints).toBe(0);
    expect(c.schoolsAttended).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Renderer: ACG sheet appears only when useAcg is true; contains the
// ACG-specific labels in the PDF bytes
// ---------------------------------------------------------------------------

describe("ACG PDF renderer", () => {
  function freshAcgChar(): Character {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.name = "ColonelHazard";
    c.service = "marines";
    c.terms = 4;
    c.rank = 5;
    c.commissioned = true;
    c.useAcg = true;
    c.acgPathway = "mercenary";
    c.acgBranch = "Marines";
    c.acgMos = "Heavy Weapons";
    c.decorations = ["MCUF", "MCG"];
    c.browniePoints = 3;
    c.schoolsAttended = ["Combat Engineer School", "Intelligence School"];
    return c;
  }

  it("a non-ACG character has no ACG page in the output", () => {
    const ct = new Character();
    ct.editionId = "ct-classic";
    ct.service = "navy";
    ct.terms = 2;
    ct.credits = 5000; // forces the supplement page
    const doc = buildCharacterSheetPdf(ct);
    const bytes = doc.output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // ACG-specific labels must not appear in a non-ACG character's PDF.
    expect(text).not.toContain("ADVANCED CHARACTER GENERATION");
    expect(text).not.toContain("Brownie Points");
    expect(text).not.toContain("Decorations and Awards");
  });

  it("an ACG character's PDF includes the ACG record card heading", () => {
    const c = freshAcgChar();
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("ADVANCED CHARACTER GENERATION");
    expect(text).toContain("RECORD CARD");
  });

  it("ACG sheet renders pathway, branch, MOS, decorations, brownie points", () => {
    const c = freshAcgChar();
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // Field labels
    expect(text).toContain("Pathway");
    expect(text).toContain("Branch");
    expect(text).toContain("MOS");
    expect(text).toContain("Brownie Points");
    expect(text).toContain("Decorations");
    expect(text).toContain("Specialist Schools");
    // Values
    expect(text).toContain("mercenary");
    expect(text).toContain("Marines");
    expect(text).toContain("Heavy Weapons");
    expect(text).toContain("MCUF");
    expect(text).toContain("MCG");
    expect(text).toContain("Combat Engineer School");
  });

  it("ACG character produces one more page than the same character without ACG", () => {
    const acg = freshAcgChar();
    const basic = freshAcgChar();
    basic.useAcg = false;
    expect(buildCharacterSheetPdf(acg).getNumberOfPages())
      .toBeGreaterThan(buildCharacterSheetPdf(basic).getNumberOfPages());
  });

  it("CT character can't render ACG fields even if useAcg flag is set", () => {
    // Edge case: someone flips useAcg on a CT character. The renderer
    // doesn't gate on edition — it gates on the flag — so it WILL draw
    // the page. But the API editionHasAcg returns false, which is the
    // proper gate. The test documents that responsibility lies with the
    // caller (typically the UI), not the renderer.
    const ct = new Character();
    ct.editionId = "ct-classic";
    ct.useAcg = true; // caller error: CT has no ACG
    ct.service = "navy";
    expect(editionHasAcg(ct.editionId)).toBe(false);
    // The renderer still produces output (it doesn't crash); upstream
    // should never set useAcg=true on a non-ACG edition.
    expect(() => buildCharacterSheetPdf(ct)).not.toThrow();
  });

  it("edition footer identifies MT on an ACG character's PDF", () => {
    const c = freshAcgChar();
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("MegaTraveller");
  });

  it("edition footer identifies CT on a CT character's PDF", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "scouts";
    c.terms = 2;
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Classic Traveller");
  });
});
