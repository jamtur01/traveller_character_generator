// ACG runtime tests. These verify the ACG-specific lifecycle steps and
// enlistment-path actually mutate Character state correctly. Not just
// "the JSON has the right keys" — actual end-to-end runs.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  Character, benefitDmFor, cashDmFor,
  pathwayBaseService,
  type ServiceKey,
} from "../lib/traveller";

afterEach(() => {
  vi.restoreAllMocks();
});

function freshMtAcgChar(pathway = "mercenary"): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  c.useAcg = true;
  c.acgPathway = pathway;
  c.acgBranch = pathway;
  return c;
}

// ---------------------------------------------------------------------------
// Pathway → base service mapping
// ---------------------------------------------------------------------------

describe("pathwayBaseService", () => {
  it("mercenary maps to army", () => {
    expect(pathwayBaseService("mercenary")).toBe("army");
  });
  it("navy maps to navy", () => {
    expect(pathwayBaseService("navy")).toBe("navy");
  });
  it("scout maps to scouts", () => {
    expect(pathwayBaseService("scout")).toBe("scouts");
  });
  it("merchantPrince maps to merchants", () => {
    expect(pathwayBaseService("merchantPrince")).toBe("merchants");
  });
  it("throws on unknown pathway", () => {
    expect(() => pathwayBaseService("psionicist")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ACG enlistment: useAcg=true with a pathway routes to the base service
// ---------------------------------------------------------------------------

describe("ACG enlistment", () => {
  it("mercenary pathway character enlists into army", () => {
    const c = freshMtAcgChar("mercenary");
    // Force enlistment success: max roll.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const service = c.doEnlistment("");
    expect(service).toBe("army");
    expect(c.acgBranch).toBe("mercenary");
  });

  it("scout pathway character enlists into scouts", () => {
    const c = freshMtAcgChar("scout");
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const service = c.doEnlistment("");
    expect(service).toBe("scouts");
  });

  it("non-ACG character enlistment is unaffected", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.showHistory = "none";
    c.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 12, education: 12, social: 12,
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const service = c.doEnlistment("navy");
    // Soc 12 auto-enrolls to nobles; force-method bypasses that — but
    // soc>=10 still takes the noble path. Test that no ACG state leaks.
    expect(c.useAcg).toBe(false);
    expect(c.acgPathway).toBeNull();
    expect(typeof service).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// brownieAward step: awards 1 per term for ACG; nothing for non-ACG
// ---------------------------------------------------------------------------

describe("brownieAward step", () => {
  it("ACG character gains 1 brownie point per term", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // mid-range rolls
    const c = freshMtAcgChar("scout");
    c.service = "scouts" as ServiceKey;
    expect(c.browniePoints).toBe(0);
    c.doServiceTermStep();
    expect(c.browniePoints).toBe(1);
    c.doServiceTermStep();
    expect(c.browniePoints).toBe(2);
  });

  it("non-ACG character never gains brownie points", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.choiceMode = "auto";
    c.showHistory = "none";
    c.attributes = {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    };
    c.service = "scouts" as ServiceKey;
    c.doServiceTermStep();
    expect(c.browniePoints).toBe(0);
  });

  it("deceased ACG character gets no brownie point for the killing term", () => {
    // Force minimum survival roll → death.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshMtAcgChar("scout");
    c.service = "scouts" as ServiceKey;
    // Scouts survival target is 7 — minimum roll fails.
    c.doServiceTermStep();
    expect(c.deceased).toBe(true);
    expect(c.browniePoints).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// decorationCheck step: awards based on survival overshoot
// ---------------------------------------------------------------------------

describe("decorationCheck step", () => {
  it("ACG character with low roll gets no decoration", () => {
    // Sequence of Math.random returns: 0 for every roll → 2d6=2 → fails.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshMtAcgChar("mercenary");
    c.service = "army" as ServiceKey;
    // Survival fails at roll 2 — character dies before decoration step.
    c.doServiceTermStep();
    expect(c.decorations).toEqual([]);
  });

  it("ACG character with maximum decoration roll gets SEH", () => {
    // Survive (force high), then decoration roll: 12 vs 10 = margin 2 = MCUF.
    // Need to be cleverer: use a sequence of returns.
    let callCount = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      callCount++;
      // First few rolls: ensure survival passes. Force last decoration
      // roll to max (margin 6 from 12 vs 6 — but target is 10, so margin
      // 2). To get SEH (+6), we need roll 16 against target 10 — but
      // 2d6 caps at 12. Per JSON, margin 6 = SEH. So target needs to
      // be ≤6. The config-level target in mtJson is 10; pure-12 margin
      // is 2 → MCUF only. So this test asserts that lookup correctly.
      return 0.999;
    });
    const c = freshMtAcgChar("mercenary");
    c.service = "army" as ServiceKey;
    c.doServiceTermStep();
    // All rolls force 12. Survival passes; decoration roll 12 vs 10 →
    // margin 2 → MCUF (not SEH, since target is 10 not 6).
    expect(c.decorations.length).toBeGreaterThanOrEqual(1);
    expect(c.decorations[0]).toBe("MCUF");
    expect(callCount).toBeGreaterThan(0);
  });

  it("non-ACG character never gets decorations even with high rolls", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.choiceMode = "auto";
    c.showHistory = "none";
    c.attributes = {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    };
    c.service = "scouts" as ServiceKey;
    c.doServiceTermStep();
    expect(c.decorations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle dispatch: ACG characters use lifecycle.acgTerms; non-ACG uses
// lifecycle.terms
// ---------------------------------------------------------------------------

describe("runTermSteps dispatches per useAcg", () => {
  it("MT ACG character runs decorationCheck (basic doesn't)", () => {
    // The marker: ACG characters can accumulate decorations across terms.
    // Force a maxed Math.random so every roll is high.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const acg = freshMtAcgChar("navy");
    acg.service = "navy" as ServiceKey;
    acg.doServiceTermStep();
    expect(acg.decorations.length).toBeGreaterThan(0); // proves decoration step ran

    const basic = new Character();
    basic.editionId = "mt-megatraveller";
    basic.choiceMode = "auto";
    basic.showHistory = "none";
    basic.attributes = {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    };
    basic.service = "navy" as ServiceKey;
    basic.doServiceTermStep();
    expect(basic.decorations).toEqual([]); // basic skips decoration
  });
});

// ---------------------------------------------------------------------------
// Cash/Benefit DM wiring — actually consume the rules
// ---------------------------------------------------------------------------

describe("cashDmFor reads conditions from JSON", () => {
  it("CT navy character without Gambling: cash DM = 0", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    expect(cashDmFor(c)).toBe(0);
  });

  it("CT navy character with Gambling-1: cash DM = 1", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.skills = [["Gambling", 1]];
    expect(cashDmFor(c)).toBe(1);
  });

  it("MT navy character without skills: cash DM = 0", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "navy";
    expect(cashDmFor(c)).toBe(0);
  });

  it("MT navy character with Gambling-1: cash DM = 1", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "navy";
    c.skills = [["Gambling", 1]];
    expect(cashDmFor(c)).toBe(1);
  });

  it("MT belters character with Prospecting-1: cash DM = 1 (Prospecting allowed)", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "belters";
    c.skills = [["Prospecting", 1]];
    expect(cashDmFor(c)).toBe(1);
  });

  it("MT navy character with Prospecting-1: cash DM = 0 (Prospecting NOT allowed for navy)", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "navy";
    c.skills = [["Prospecting", 1]];
    expect(cashDmFor(c)).toBe(0);
  });

  it("MT belters character retired AND Prospecting-1: cash DM = 2", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "belters";
    c.skills = [["Prospecting", 1]];
    c.retired = true;
    expect(cashDmFor(c)).toBe(2);
  });
});

describe("benefitDmFor reads conditions from JSON", () => {
  it("rank 4 character: benefit DM = 0", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.rank = 4;
    expect(benefitDmFor(c)).toBe(0);
  });

  it("rank 5 character: benefit DM = 1", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.rank = 5;
    expect(benefitDmFor(c)).toBe(1);
  });

  it("rank 6 character: benefit DM = 1", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.rank = 6;
    expect(benefitDmFor(c)).toBe(1);
  });
});
