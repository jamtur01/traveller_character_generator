import { describe, expect, it, vi, beforeEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEditionServices } from "../lib/traveller/services";
import type { Homeworld } from "../lib/traveller/engine/homeworld";
import * as random from "../lib/traveller/random";

function makeMtChar(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 7, dexterity: 7, endurance: 7,
    intelligence: 7, education: 7, social: 7,
  };
  c.homeworld = {
    starport: "A",
    size: "Medium",
    atmosphere: "Standard",
    hydrosphere: "Wet World",
    population: "Mod Pop",
    law: "Low Law",
    tech: "High Stellar",
  } as Homeworld;
  c.service = "army";
  c.choiceMode = "auto";
  return c;
}

describe("anagathics integration (B5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("preSurvivalAnagathicsHook", () => {
    it("does nothing without standing order", () => {
      const c = makeMtChar();
      c.age = 34;
      c.terms = 3;
      c.preSurvivalAnagathicsHook();
      expect(c.wantsAnagathicsThisTerm).toBe(false);
      expect(c.anagathicsActiveThisTerm).toBe(false);
    });

    it("declines silently when not yet eligible (age < 30 or terms < 3)", () => {
      const c = makeMtChar();
      c.age = 22;
      c.terms = 1;
      c.anagathicsStandingOrder = true;
      c.preSurvivalAnagathicsHook();
      expect(c.wantsAnagathicsThisTerm).toBe(false);
    });

    it("sets wantsAnagathicsThisTerm and attempts supply when eligible", () => {
      const c = makeMtChar();
      c.age = 34;
      c.terms = 3;
      c.anagathicsStandingOrder = true;
      // Force availability success (homeworld has +3 starport + +3 tech, so
      // any 2d6 ≥ 6 succeeds with the +6 DM — fix to a known value).
      vi.spyOn(random, "roll").mockReturnValueOnce(6);
      c.preSurvivalAnagathicsHook();
      expect(c.wantsAnagathicsThisTerm).toBe(true);
      expect(c.anagathicsActiveThisTerm).toBe(true);
      expect(c.onAnagathics).toBe(true);
      expect(c.anagathicsEverTaken).toBe(true);
    });

    it("desire still flags survival DM even when supply not found", () => {
      const c = makeMtChar();
      c.homeworld = { ...c.homeworld!, starport: "E", tech: "Industrial" } as Homeworld;
      c.age = 34;
      c.terms = 3;
      c.anagathicsStandingOrder = true;
      // Pin every roll low so: (1) availability fails, (2) retry survival
      // fails, (3) no second availability roll fires. Without pinning all
      // three calls, real random fills in and the retry path can flip
      // anagathicsActiveThisTerm to true (CI flake).
      vi.spyOn(random, "roll").mockReturnValue(2);
      c.preSurvivalAnagathicsHook();
      expect(c.wantsAnagathicsThisTerm).toBe(true);
      expect(c.anagathicsActiveThisTerm).toBe(false);
    });
  });

  describe("survival DM", () => {
    it("applies -1 survival DM when wantsAnagathicsThisTerm is set", () => {
      // Make Edu < 6 so the army +2 survival DM is suppressed and the only
      // remaining modifier is the -1 anagathics penalty.
      const c = makeMtChar();
      c.service = "army";
      c.attributes.education = 5;
      c.showHistory = "verbose";
      c.wantsAnagathicsThisTerm = true;
      const svc = getEditionServices(c.editionId)["army"]!;
      const rollSpy = vi.spyOn(random, "roll").mockReturnValue(6);
      svc.checkSurvival(c);
      expect(c.history.some((h) => /Survival.*[−-]\s*1/.test(h))).toBe(true);
      rollSpy.mockRestore();
    });

    it("applies -2 survival DM for nobles on anagathics", () => {
      const c = makeMtChar();
      c.showHistory = "verbose";
      c.service = "nobles";
      c.attributes.social = 11;
      c.wantsAnagathicsThisTerm = true;
      const svc = getEditionServices(c.editionId)["nobles"]!;
      const rollSpy = vi.spyOn(random, "roll").mockReturnValue(8);
      svc.checkSurvival(c);
      expect(c.history.some((h) => /Survival.*[−-]\s*2/.test(h))).toBe(true);
      rollSpy.mockRestore();
    });

    it("no DM when neither flag is set", () => {
      const c = makeMtChar();
      c.showHistory = "verbose";
      const svc = getEditionServices(c.editionId)["army"]!;
      vi.spyOn(random, "roll").mockReturnValue(8);
      svc.checkSurvival(c);
      expect(c.history.some((h) => /Anagathics survival DM/.test(h))).toBe(false);
    });
  });

  describe("muster benefit forfeit", () => {
    it("anagathicsBenefitForfeitedTerms reduces qualifying terms", () => {
      const c = makeMtChar();
      c.terms = 5;
      c.rank = 0;
      c.anagathicsBenefitForfeitedTerms = 2;
      const withForfeit = c.musterOutRolls();
      c.anagathicsBenefitForfeitedTerms = 0;
      const withoutForfeit = c.musterOutRolls();
      // Each forfeited term shaves perTerm rolls.
      expect(withoutForfeit - withForfeit).toBeGreaterThan(0);
    });
  });

  describe("retry mechanic (PM p. 15)", () => {
    it("on first failure, succeeds on retry when survival roll passes", () => {
      const c = makeMtChar();
      c.age = 34;
      c.terms = 3;
      c.service = "army";
      const r = vi.spyOn(random, "roll");
      // 2D availability fails (low roll), 2D survival pass, 2D availability pass
      r.mockReturnValueOnce(2)  // availability roll 1: fail
       .mockReturnValueOnce(8)  // retry survival roll: pass (army survival is 5+)
       .mockReturnValueOnce(6); // availability roll 2: 6 + +6 starport/tech DMs = pass
      expect(c.tryAnagathics()).toBe(true);
      expect(c.onAnagathics).toBe(true);
    });

    it("on first failure, forces muster-out when retry survival fails", () => {
      const c = makeMtChar();
      c.age = 34;
      c.terms = 3;
      c.service = "army";
      c.resumeActive();
      const r = vi.spyOn(random, "roll");
      r.mockReturnValueOnce(2)  // availability roll 1: fail
       .mockReturnValueOnce(2); // retry survival roll: fail → force muster-out
      expect(c.tryAnagathics()).toBe(false);
      expect(c.activeDuty).toBe(false);
      // shortTermsCount is incremented (this term doesn't count for
      // muster benefits); status transitions directly to retired since
      // chargen ends here — the intermediate shortTerm state is skipped.
      expect(c.shortTermsCount).toBeGreaterThanOrEqual(1);
      expect(c.chargenStatus.kind).toBe("retired");
    });

    it("retry disabled when allowRetry=false", () => {
      const c = makeMtChar();
      c.age = 34;
      c.terms = 3;
      c.service = "army";
      vi.spyOn(random, "roll").mockReturnValueOnce(2); // fail, no retry
      expect(c.tryAnagathics(false)).toBe(false);
      expect(c.onAnagathics).toBe(false);
    });
  });

  describe("auto-aging-saves benefit (PM p. 15)", () => {
    it("on anagathics: 2 attributes auto-pass, only the rest roll", () => {
      const c = makeMtChar();
      c.attributes.strength = 10;
      c.attributes.dexterity = 10;
      c.attributes.endurance = 10;
      c.terms = 4;
      c.age = 34;
      c.apparentAge = 34;
      c.onAnagathics = true;
      c.anagathicsBenefitForfeitedTerms = 1;
      // Aging table for term 4-7 has Str/Dex/End each needing a save. With
      // auto-saves on 2, only the third one rolls. Force that to fail.
      vi.spyOn(random, "roll").mockReturnValue(2);
      c.doAging();
      // Exactly one attribute should have been reduced by aging.
      const reductions =
        (10 - c.attributes.strength) +
        (10 - c.attributes.dexterity) +
        (10 - c.attributes.endurance);
      expect(reductions).toBe(1);
    });

    it("not on anagathics: no auto-saves; all attributes roll", () => {
      const c = makeMtChar();
      c.attributes.strength = 10;
      c.attributes.dexterity = 10;
      c.attributes.endurance = 10;
      c.terms = 4;
      c.age = 34;
      c.apparentAge = 34;
      c.onAnagathics = false;
      vi.spyOn(random, "roll").mockReturnValue(2);
      c.doAging();
      const reductions =
        (10 - c.attributes.strength) +
        (10 - c.attributes.dexterity) +
        (10 - c.attributes.endurance);
      expect(reductions).toBeGreaterThanOrEqual(3);
    });
  });

  describe("doServiceTermStep resets per-term flags", () => {
    it("clears anagathicsActiveThisTerm at the start of each term", () => {
      const c = makeMtChar();
      c.anagathicsActiveThisTerm = true;
      c.anagathicsWithdrawalThisTerm = true;
      // Standing order off — hook is a no-op; just verify the reset.
      c.service = "army";
      c.terms = 0;
      c.resumeActive();
      vi.spyOn(random, "roll").mockReturnValue(8);
      c.doServiceTermStep();
      expect(c.anagathicsActiveThisTerm).toBe(false);
      expect(c.anagathicsWithdrawalThisTerm).toBe(false);
    });
  });
});

// H2 regression — muster-out double-subtracted a term that was BOTH an
// anagathics-benefit-forfeit term AND a short term.
//
// A term that both secured anagathics (forfeiting its benefit roll) and then
// became a short term is counted by BOTH `shortTermsCount` and
// `anagathicsBenefitForfeitedTerms`, so it was excluded twice. The fix:
// `enterShortTerm` records the collision in `anagathicsShortTermOverlap`
// (only while `anagathicsActiveThisTerm`), and `musterOutRolls` adds that
// overlap back so the term drops exactly one roll's worth of benefits.
//
// No dice are rolled by enterShortTerm or musterOutRolls, so no Math.random
// mock is needed. MT rules.musterOutRolls.perTerm = 2.
//
// Teeth: pre-fix there was no overlap counter and no add-back, so a doubly-
// excluded term subtracted 2×perTerm. The counter assertion (1, not 0) and
// the roll-count assertion (6, not 4) both fail against that behavior.
describe("H2: anagathics short-term overlap counter", () => {
  it("enterShortTerm records the overlap when anagathics is active this term", () => {
    const c = makeMtChar();
    c.anagathicsActiveThisTerm = true;
    c.enterShortTerm("survival fail");
    expect(c.anagathicsShortTermOverlap).toBe(1);
    expect(c.shortTermsCount).toBe(1);
  });

  it("enterShortTerm leaves overlap at 0 when anagathics is NOT active", () => {
    const c = makeMtChar();
    c.anagathicsActiveThisTerm = false;
    c.enterShortTerm("reenlistment denied");
    expect(c.anagathicsShortTermOverlap).toBe(0);
    expect(c.shortTermsCount).toBe(1);
  });

  it("musterOutRolls excludes the overlapping term exactly once (3 qualifying terms, not 2)", () => {
    const c = makeMtChar();
    c.rank = 0; // no rank-band extra rolls
    c.terms = 4;
    c.shortTermsCount = 1;
    c.anagathicsBenefitForfeitedTerms = 1;
    // The short term and the forfeit term are the SAME term.
    c.anagathicsShortTermOverlap = 1;
    // qualifyingTerms = 4 - 1 - 1 + 1 = 3; perTerm 2 → 6 rolls.
    const withAddBack = c.musterOutRolls();
    expect(withAddBack).toBe(6);

    // Drop the add-back → the term is excluded twice (the pre-fix bug):
    // qualifyingTerms = 4 - 1 - 1 = 2; perTerm 2 → 4 rolls.
    c.anagathicsShortTermOverlap = 0;
    const doublyExcluded = c.musterOutRolls();
    expect(doublyExcluded).toBe(4);

    // The add-back restores exactly one term's worth of rolls (perTerm=2).
    expect(withAddBack - doublyExcluded).toBe(2);
  });
});
