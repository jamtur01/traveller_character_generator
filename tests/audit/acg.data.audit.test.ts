// ACG data-audit tests. Verify the JSON-declared content of each
// edition's advancedCharacterGeneration block. Engine-side use of these
// helpers is covered by tests/acg.test.ts (API surface) and
// tests/acg.runtime.test.ts (behaviour).

import { describe, expect, it } from "vitest";
import {
  getAcgCommon, getAcgPathway, listAcgPathways,
} from "../../lib/traveller";

describe("MT ACG: listAcgPathways content", () => {
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

describe("MT ACG: getAcgPathway content", () => {
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
});

describe("MT ACG: getAcgCommon content", () => {
  it("exposes the four common tables for MT", () => {
    const common = getAcgCommon("mt-megatraveller");
    expect(common.preCareerOptions).toBeDefined();
    expect(common.courtMartial).toBeDefined();
    expect(common.browniePoints).toBeDefined();
    expect(common.decorationAndSurvival).toBeDefined();
  });
});
