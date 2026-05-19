// Tests for the pathway-narrowed AcgState helpers (Option E).
//
// The Character class exposes requireMercenaryAcg / requireNavyAcg /
// requireScoutAcg / requireMerchantAcg that throw if the character
// isn't on the expected pathway. The TypeScript types narrow the
// pathway-specific fields (combatArm, fleet, division, lineType) from
// optional to required, so pathway code reads them without bang or
// null-coalesce.

import { describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  isMercenaryAcg, isNavyAcg, isScoutAcg, isMerchantAcg,
} from "../lib/traveller/engine/acg/state";

function mtChar(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  c.homeworld = {
    starport: "A", size: "Medium", atmosphere: "Standard",
    hydrosphere: "Wet World", population: "Mod Pop", law: "Mod Law",
    tech: "Avg Stellar",
  };
  c.choiceMode = "auto";
  return c;
}

describe("AcgState pathway type guards", () => {
  it("isMercenaryAcg recognises a mercenary character with combatArm", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    expect(isMercenaryAcg(c.requireAcgState())).toBe(true);
    expect(isNavyAcg(c.requireAcgState())).toBe(false);
    vi.restoreAllMocks();
  });

  it("isNavyAcg recognises a navy character with fleet", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(isNavyAcg(c.requireAcgState())).toBe(true);
    expect(isMercenaryAcg(c.requireAcgState())).toBe(false);
    vi.restoreAllMocks();
  });

  it("isScoutAcg recognises a scout character with division", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("scout", { division: "field" });
    expect(isScoutAcg(c.requireAcgState())).toBe(true);
    vi.restoreAllMocks();
  });

  it("isMerchantAcg recognises a merchant character with lineType", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(isMerchantAcg(c.requireAcgState())).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("Character.requireXxxAcg accessors", () => {
  it("requireMercenaryAcg returns a state with non-optional combatArm", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    const acg = c.requireMercenaryAcg();
    // TypeScript-narrowed: combatArm is required.
    expect(acg.combatArm).toBe("Infantry");
    expect(acg.pathway).toBe("mercenary");
    vi.restoreAllMocks();
  });

  it("requireMercenaryAcg throws on a navy character (cross-pathway protection)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(() => c.requireMercenaryAcg()).toThrow(/Expected mercenary acgState/);
    vi.restoreAllMocks();
  });

  it("requireNavyAcg returns a state with literal-typed fleet", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("navy", { fleet: "reserveFleet" });
    const acg = c.requireNavyAcg();
    expect(acg.fleet).toBe("reserveFleet");
    vi.restoreAllMocks();
  });

  it("requireScoutAcg returns a state with non-optional division", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("scout", { division: "field" });
    const acg = c.requireScoutAcg();
    expect(acg.division).toBe("field");
    vi.restoreAllMocks();
  });

  it("requireMerchantAcg throws on a scout character", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("scout", { division: "field" });
    expect(() => c.requireMerchantAcg()).toThrow(/Expected merchantPrince acgState/);
    vi.restoreAllMocks();
  });

  it("requireXxxAcg on non-ACG character throws via requireAcgState", () => {
    const c = new Character();
    expect(() => c.requireMercenaryAcg()).toThrow(/non-ACG character/);
  });
});
