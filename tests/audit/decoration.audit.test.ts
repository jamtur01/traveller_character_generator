// Decoration mechanics + brownie point awards audit against MT PM p. 49.
//
// Decoration tiers: throw or higher → MCUF; +3 to +5 → MCG; +6 or higher → SEH.
// SEH grants automatic +1 rank at muster-out.
// Purple Heart: awarded on exact survival roll in a combat assignment.
//
// Brownie point awards:
//   1 each: term completion, college, service academy, medical school,
//           flight school, honors, special assignment, MCUF.
//   2: MCG. 3: SEH. 0: Purple Heart.

import { describe, expect, it } from "vitest";
import { getAcgCommon } from "../../lib/traveller";

interface DecorationTier { minMargin: number; award: string; sehPromotion?: boolean }
interface BPAward { event: string; points: number }

describe("Decoration tiers audit (PM p. 49)", () => {
  const common = getAcgCommon("mt-megatraveller");

  it("MCUF at margin 0 (throw exact or higher)", () => {
    const tiers = (common.decorationTiers as { tiers?: DecorationTier[] })
      ?.tiers ?? [];
    const mcuf = tiers.find((t) => t.award === "MCUF");
    expect(mcuf?.minMargin).toBe(0);
  });

  it("MCG at margin 3+ (throw + 3)", () => {
    const tiers = (common.decorationTiers as { tiers?: DecorationTier[] })
      ?.tiers ?? [];
    const mcg = tiers.find((t) => t.award === "MCG");
    expect(mcg?.minMargin).toBe(3);
  });

  it("SEH at margin 6+ and grants auto +1 rank at muster", () => {
    const tiers = (common.decorationTiers as { tiers?: DecorationTier[] })
      ?.tiers ?? [];
    const seh = tiers.find((t) => t.award === "SEH");
    expect(seh?.minMargin).toBe(6);
    expect(seh?.sehPromotion).toBe(true);
  });

  it("Purple Heart: exact survival roll in a combat assignment", () => {
    const ph = (common.decorationTiers as {
      purpleHeart?: { trigger?: string; award?: string };
    }).purpleHeart;
    expect(ph?.trigger).toBe("exactSurvivalRollInCombatAssignment");
    expect(ph?.award).toBe("Purple Heart");
  });
});

describe("Decoration / survival DM tradeoff (PM p. 49)", () => {
  it("Negative survival DM → positive decoration DM; reverse triggers court-martial on -6", () => {
    const ds = getAcgCommon("mt-megatraveller").decorationAndSurvival as {
      notes?: string[];
    };
    const notes = (ds.notes ?? []).join(" ");
    expect(notes).toMatch(/negative survival DM/i);
    expect(notes).toMatch(/court-martial/i);
  });
});

describe("Brownie point awards audit (PM p. 49)", () => {
  const bp = getAcgCommon("mt-megatraveller").browniePoints as {
    awards?: BPAward[];
  };
  const byEvent = (substr: string) =>
    bp.awards?.find((a) => a.event.toLowerCase().includes(substr.toLowerCase()))?.points;

  it("1 per 4-year term completion", () => {
    expect(byEvent("4-year term")).toBe(1);
  });

  it("1 each for College / Service Academy / Medical / Flight School", () => {
    expect(byEvent("Graduation from College")).toBe(1);
    expect(byEvent("Service Academy")).toBe(1);
    expect(byEvent("Medical School")).toBe(1);
    expect(byEvent("Flight School")).toBe(1);
  });

  it("1 each for Honors and Special assignment", () => {
    expect(byEvent("Honors")).toBe(1);
    expect(byEvent("Special assignment")).toBe(1);
  });

  it("1 MCUF, 2 MCG, 3 SEH, 0 Purple Heart", () => {
    expect(byEvent("MCUF")).toBe(1);
    expect(byEvent("MCG")).toBe(2);
    expect(byEvent("SEH")).toBe(3);
    expect(byEvent("Purple Heart")).toBe(0);
  });
});
