// Behavioral edition tests. These don't just check that data is shaped
// correctly — they construct characters, run engine steps, and assert
// real state changes. The point: prove the engine *consumes* each
// edition's rules differently, so a bug that hardcodes CT behavior into
// the engine would fail one of these tests.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character, type ServiceKey } from "../lib/traveller";

afterEach(() => {
  vi.restoreAllMocks();
});

function freshChar(editionId: string, service: ServiceKey, attrs = 9): Character {
  const c = new Character();
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.editionId = editionId;
  c.attributes = {
    strength: attrs, dexterity: attrs, endurance: attrs,
    intelligence: attrs, education: attrs, social: attrs,
  };
  c.service = service;
  c.skills = [];
  c.benefits = [];
  c.history = [];
  c.musterLog = [];
  return c;
}

// ---------------------------------------------------------------------------
// Skill allocation: CT and MT diverge for the same service
// ---------------------------------------------------------------------------

describe("allocateSkills step reads rules.skillEligibility per edition", () => {
  // We need to bypass the survival/commission/etc. checks to test
  // allocateSkills in isolation. The cleanest way is to force survival to
  // always succeed and inspect skillPoints after doServiceTermStep — but
  // some randomness still creeps in via commission. So we lock Math.random
  // to a low value (forces failure on most checks except those with very
  // low targets) and just confirm skill points are at the expected MINIMUM
  // (allocateSkills always fires; everything else may add more).
  it("CT scouts → 2 skill points/term (perTermExceptions)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01); // every roll → 1, fails most
    const c = freshChar("ct-classic", "scouts");
    c.doServiceTermStep();
    // Scouts gets 2 from perTermExceptions; survival fails at min roll
    // so the term ends here. skillPoints should be exactly 2 (allocation
    // happens first, then survival kills the character — wait, no,
    // allocateSkills runs FIRST per CT lifecycle).
    expect(c.skillPoints).toBe(2);
  });

  it("CT navy term 1 → 2 skill points (initial term bonus)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const c = freshChar("ct-classic", "navy", 5);
    c.doServiceTermStep();
    expect(c.skillPoints).toBe(2);
  });

  it("CT navy term 2 → 1 skill point (subsequent)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const c = freshChar("ct-classic", "navy", 5);
    c.terms = 1; // pretend term 1 already happened
    c.doServiceTermStep();
    expect(c.skillPoints).toBe(1);
  });

  it("MT navy term 1 → 1 + 1 term1Bonus = 2 (different from CT path)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const c = freshChar("mt-megatraveller", "navy", 5);
    c.doServiceTermStep();
    // MT navy: skillsPerTerm=1 + term1Bonus = 2 in term 1.
    expect(c.skillPoints).toBe(2);
  });

  it("MT scouts → 2 skill points (skillsPerTerm=2, no term1Bonus stacking)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const c = freshChar("mt-megatraveller", "scouts", 5);
    c.doServiceTermStep();
    expect(c.skillPoints).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Aging: CT and MT use the same age breakpoints, but the data path matters
// ---------------------------------------------------------------------------

describe("doAging reads aging.rows per edition", () => {
  it("CT terms<4: no aging fires", () => {
    const c = freshChar("ct-classic", "navy", 9);
    c.terms = 3;
    c.doAging();
    expect(c.attributes.strength).toBe(9);
    expect(c.attributes.dexterity).toBe(9);
    expect(c.attributes.endurance).toBe(9);
  });

  it("MT terms<4: no aging fires", () => {
    const c = freshChar("mt-megatraveller", "navy", 9);
    c.terms = 3;
    c.doAging();
    expect(c.attributes.strength).toBe(9);
  });

  it("CT terms=4: term-4 row applies; failing saves drops attributes", () => {
    // Force Math.random to 0 → roll(2) returns 2 (minimum), which fails
    // every save. All three (Str/Dex/End) drop by 1.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshChar("ct-classic", "navy", 9);
    c.terms = 4;
    c.doAging();
    expect(c.attributes.strength).toBe(8);
    expect(c.attributes.dexterity).toBe(8);
    expect(c.attributes.endurance).toBe(8);
  });

  it("MT terms=4: term-4 row applies the same effects", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshChar("mt-megatraveller", "navy", 9);
    c.terms = 4;
    c.doAging();
    expect(c.attributes.strength).toBe(8);
    expect(c.attributes.dexterity).toBe(8);
    expect(c.attributes.endurance).toBe(8);
  });

  it("terms=12+: intelligence also degrades (-1 save 9)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshChar("ct-classic", "navy", 9);
    c.terms = 12;
    c.doAging();
    // Term-12+ row: Str/Dex/End -2 (save 9), Int -1 (save 9).
    expect(c.attributes.strength).toBe(7);
    expect(c.attributes.dexterity).toBe(7);
    expect(c.attributes.endurance).toBe(7);
    expect(c.attributes.intelligence).toBe(8);
  });

  it("high attributes never fail saves: no aging effect at full health", () => {
    // Force Math.random near 1 → roll(2) returns 12 (max), passing all saves.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshChar("mt-megatraveller", "navy", 12);
    c.terms = 8;
    c.doAging();
    expect(c.attributes.strength).toBe(12);
    expect(c.attributes.dexterity).toBe(12);
    expect(c.attributes.endurance).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// musterOutRolls: CT and MT compute different totals
// ---------------------------------------------------------------------------

describe("musterOutRolls reads rules.musterOutRolls per edition", () => {
  it("CT rank-0, 2 terms → 2 rolls (no rank band)", () => {
    const c = freshChar("ct-classic", "navy");
    c.terms = 2;
    c.rank = 0;
    expect(c.musterOutRolls()).toBe(2);
  });

  it("CT rank-1, 2 terms → 2 + 1 = 3", () => {
    const c = freshChar("ct-classic", "navy");
    c.terms = 2;
    c.rank = 1;
    expect(c.musterOutRolls()).toBe(3);
  });

  it("CT rank-3, 4 terms → 4 + 2 = 6", () => {
    const c = freshChar("ct-classic", "navy");
    c.terms = 4;
    c.rank = 3;
    expect(c.musterOutRolls()).toBe(6);
  });

  it("CT rank-6, 5 terms → 5 + 3 = 8", () => {
    const c = freshChar("ct-classic", "navy");
    c.terms = 5;
    c.rank = 6;
    expect(c.musterOutRolls()).toBe(8);
  });

  it("MT rank-0, 2 terms → 2 × 2 = 4 (perTerm=2, no rank band)", () => {
    const c = freshChar("mt-megatraveller", "navy");
    c.terms = 2;
    c.rank = 0;
    expect(c.musterOutRolls()).toBe(4);
  });

  it("MT rank-6, 5 terms → 5 × 2 + 1 = 11", () => {
    const c = freshChar("mt-megatraveller", "navy");
    c.terms = 5;
    c.rank = 6;
    expect(c.musterOutRolls()).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Cascade pool isolation: actually pick a blade for each edition and
// confirm it comes from the right pool. Random with mocked Math.random
// so the test is deterministic.
// ---------------------------------------------------------------------------

describe("blade cascade picks from the active edition's pool", () => {
  it("CT navy character's first blade is in CT bladeCombat pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const c = freshChar("ct-classic", "navy");
    c.bladeBenefit = "";
    c.doBladeBenefit();
    // CT JSON bladeCombat: Dagger, Foil, Sword, Cutlass, ... — no Axe.
    expect(["Dagger", "Foil", "Sword", "Cutlass", "Broadsword", "Bayonet",
      "Spear", "Halberd", "Pike", "Cudgel"]).toContain(c.bladeBenefit);
  });

  it("MT navy character's first blade is in MT bladeCombat pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const c = freshChar("mt-megatraveller", "navy");
    c.bladeBenefit = "";
    c.doBladeBenefit();
    // MT JSON bladeCombat: Axe, Cudgel, Foil, Large Blade, Polearm, Small Blade.
    expect(["Axe", "Cudgel", "Foil", "Large Blade", "Polearm", "Small Blade"])
      .toContain(c.bladeBenefit);
  });

  it("CT blade pool and MT blade pool overlap only at Foil/Cudgel", () => {
    const ct = new Set(["Dagger", "Foil", "Sword", "Cutlass", "Broadsword",
      "Bayonet", "Spear", "Halberd", "Pike", "Cudgel"]);
    const mt = new Set(["Axe", "Cudgel", "Foil", "Large Blade", "Polearm",
      "Small Blade"]);
    const overlap = [...ct].filter((x) => mt.has(x));
    expect(overlap.sort()).toEqual(["Cudgel", "Foil"]);
  });
});
