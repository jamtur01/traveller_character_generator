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
      vi.spyOn(random, "roll").mockReturnValueOnce(2); // availability fail
      c.preSurvivalAnagathicsHook();
      expect(c.wantsAnagathicsThisTerm).toBe(true);
      expect(c.anagathicsActiveThisTerm).toBe(false);
    });
  });

  describe("survival DM", () => {
    it("applies -1 survival DM when wantsAnagathicsThisTerm is set", () => {
      const c = makeMtChar();
      c.service = "army";
      c.showHistory = "verbose";
      c.wantsAnagathicsThisTerm = true;
      const svc = getEditionServices(c.editionId)["army"]!;
      const rollSpy = vi.spyOn(random, "roll").mockReturnValue(6);
      svc.checkSurvival(c);
      expect(c.history.some((h) => /Anagathics survival DM -1/.test(h))).toBe(true);
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
      expect(c.history.some((h) => /Anagathics survival DM -2/.test(h))).toBe(true);
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

  describe("doServiceTermStep resets per-term flags", () => {
    it("clears anagathicsActiveThisTerm at the start of each term", () => {
      const c = makeMtChar();
      c.anagathicsActiveThisTerm = true;
      c.anagathicsWithdrawalThisTerm = true;
      // Standing order off — hook is a no-op; just verify the reset.
      c.service = "army";
      c.terms = 0;
      c.activeDuty = true;
      vi.spyOn(random, "roll").mockReturnValue(8);
      c.doServiceTermStep();
      expect(c.anagathicsActiveThisTerm).toBe(false);
      expect(c.anagathicsWithdrawalThisTerm).toBe(false);
    });
  });
});
