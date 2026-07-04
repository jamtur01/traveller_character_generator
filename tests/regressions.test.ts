// Regression tests for bugs found during the code-review pass. Each
// describe block names the bug and the file:line of the fix.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { ChoicePendingError } from "../lib/traveller/engine/choices";
import { applyCell } from "../lib/traveller/engine/cellResolver";
import { evaluateDM } from "../lib/traveller/engine/dmEvaluator";
import { getEdition } from "../lib/traveller/editions";

/** Get the active edition's benefitDetails block — needed for the
 *  mortgage-payoff path in applyCell, which only fires when the
 *  benefitDetails for the ship label declares repeatReducesMortgageYears. */
function mtBenefitDetails() {
  return (getEdition("mt-megatraveller").data as {
    benefitDetails?: Record<string, { displayName?: string; firstReceiptMortgageYears?: number; repeatReducesMortgageYears?: number }>;
  }).benefitDetails;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMt(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  c.homeworld = {
    starport: "A", size: "Medium", atmosphere: "Standard",
    hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
    tech: "High Stellar",
  };
  return c;
}

// ---------------------------------------------------------------------------
// Bug #1 — anagathics retry leaves stale withdrawalThisTerm flag.
// Fix: character.ts rollAnagathicsAvailability success branch clears
// anagathicsWithdrawalThisTerm.
// ---------------------------------------------------------------------------

describe("Bug #1: anagathics retry clears withdrawal flag on success", () => {
  it("character on anagathics: 1st availability fails (sets withdrawal), retry survival passes, retry availability succeeds → withdrawal flag CLEARED", () => {
    const c = makeMt();
    c.age = 34;
    c.terms = 3;
    c.service = "army";
    c.anagathics.onAnagathics = true;
    // Sequence: availability roll fails → withdrawal set; retry survival
    // passes; retry availability succeeds → onAnagathics restored and
    // withdrawalThisTerm should be cleared.
    const r = vi.spyOn(c.rng, "roll");
    r.mockReturnValueOnce(2)  // availability roll 1: fail (2 < target with high DMs)
     .mockReturnValueOnce(8)  // retry survival: pass (army 5+)
     .mockReturnValueOnce(12); // retry availability: pass
    expect(c.tryAnagathics()).toBe(true);
    expect(c.anagathics.onAnagathics).toBe(true);
    expect(c.anagathics.anagathicsWithdrawalThisTerm).toBe(false);
  });

  it("character on anagathics: both availability attempts fail → withdrawal flag stays set, onAnagathics false", () => {
    const c = makeMt();
    c.age = 34;
    c.terms = 3;
    c.service = "army";
    c.anagathics.onAnagathics = true;
    c.homeworld = { ...c.homeworld!, starport: "E", tech: "Industrial" }; // no DMs
    const r = vi.spyOn(c.rng, "roll");
    r.mockReturnValueOnce(2)  // availability 1: fail
     .mockReturnValueOnce(8)  // retry survival: pass
     .mockReturnValueOnce(2); // retry availability: fail
    expect(c.tryAnagathics()).toBe(false);
    expect(c.anagathics.onAnagathics).toBe(false);
    expect(c.anagathics.anagathicsWithdrawalThisTerm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug #2 — ship mortgage can go negative when repeatReducesMortgageYears
// exceeds remaining mortgage.
// Fix: cellResolver.ts applyShipBenefit clamps the subtraction.
// ---------------------------------------------------------------------------

describe("Bug #2: ship-benefit repeat clamps mortgage payoff to remaining", () => {
  it("repeat ship benefit when mortgage < repeatReducesMortgageYears clamps to 0, never negative", () => {
    const c = makeMt();
    c.service = "merchants";
    c.editionId = "mt-megatraveller";
    // Pretend the character already has the benefit and just 5 years of
    // mortgage left. Free Trader's repeatReducesMortgageYears in MT is 10.
    c.benefits = ["Free Trader"];
    c.mortgage = 5;
    applyCell(c, "Free Trader", "muster", mtBenefitDetails());
    expect(c.mortgage).toBe(0);
  });

  it("repeat ship benefit when mortgage exactly equals repeatReducesMortgageYears lands at 0", () => {
    const c = makeMt();
    c.service = "merchants";
    c.benefits = ["Free Trader"];
    c.mortgage = 10;
    applyCell(c, "Free Trader", "muster", mtBenefitDetails());
    expect(c.mortgage).toBe(0);
  });

  it("repeat ship benefit when mortgage > repeatReducesMortgageYears reduces by exact amount", () => {
    const c = makeMt();
    c.service = "merchants";
    c.benefits = ["Free Trader"];
    c.mortgage = 25;
    applyCell(c, "Free Trader", "muster", mtBenefitDetails());
    expect(c.mortgage).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Bug #3 — app/page.tsx silent catch swallowed every error from runAcgYear,
// not just ChoicePendingError.
//
// We can't unit-test the React page directly here, but we can verify the
// contract: ChoicePendingError is identifiable, and non-ChoicePendingError
// errors from runAcgYear propagate up through normal try/catch.
// ---------------------------------------------------------------------------

describe("Bug #3: ChoicePendingError is distinguishable from other errors", () => {
  it("ChoicePendingError is an Error subclass with a name field", () => {
    const e = new ChoicePendingError("test pending");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ChoicePendingError);
    expect(e.name).toBe("ChoicePendingError");
  });

  it("a non-ChoicePendingError instance is not caught by instanceof ChoicePendingError", () => {
    const e = new Error("Mercenary assignment table missing row for die=14");
    expect(e instanceof ChoicePendingError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bug #4 — aging crisis loop could "die" multiple times in one term when
// multiple attributes hit the crisis threshold and multiple saves failed.
// Fix: character.ts doAging early-breaks the crisis loop after death.
// ---------------------------------------------------------------------------

describe("Bug #4: aging crisis loop early-breaks on death", () => {
  it("character with two attributes at crisis threshold dies once and stops processing", () => {
    const c = makeMt();
    c.service = "navy";
    c.terms = 4;
    c.age = 34;
    c.apparentAge = 34;
    // Force every save to fail (low rolls → 2 vs 8 save target).
    vi.spyOn(c.rng, "roll").mockReturnValue(2);
    // Two attributes already at 0 (the MT crisis threshold).
    c.attributes.strength = 0;
    c.attributes.dexterity = 0;
    c.doAging();
    expect(c.deceased).toBe(true);
    expect(c.activeDuty).toBe(false);
    // Death history line should appear exactly once. After the structured
    // event migration the line reads "Character deceased — generation
    // ended — aging crisis." rather than the old "Died of illness."
    const deathLines = c.history.filter((h) => /Character deceased/.test(h));
    expect(deathLines).toHaveLength(1);
  });

  it("character with one attribute at crisis threshold who passes the save lives and bumps attr to 1", () => {
    const c = makeMt();
    c.service = "navy";
    c.terms = 4;
    c.age = 34;
    c.apparentAge = 34;
    // First many calls (regular aging rolls) pass with 12; the crisis
    // roll also passes with 12.
    vi.spyOn(c.rng, "roll").mockReturnValue(12);
    c.attributes.strength = 0;
    c.doAging();
    expect(c.deceased).toBe(false);
    expect(c.attributes.strength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bug #5 — random service selection used bare Math.random in doEnlistment.
// Fix: the pick now flows through the character's owned RNG (character.rng),
// so a seeded run is reproducible instead of relying on hidden global state.
// ---------------------------------------------------------------------------

describe("Bug #5: random enlistment flows through the character's owned RNG", () => {
  it("two identically-seeded characters make the same random enlistment", () => {
    const build = (): Character => {
      const c = new Character({ seed: 0x5eed });
      c.editionId = "mt-megatraveller";
      c.showHistory = "none";
      c.choiceMode = "auto";
      c.attributes = {
        strength: 9, dexterity: 9, endurance: 9,
        intelligence: 9, education: 9, social: 6, // Soc 6 avoids auto-noble
      };
      c.homeworld = {
        starport: "A", size: "Medium", atmosphere: "Standard",
        hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
        tech: "High Stellar",
      };
      return c;
    };
    const a = build();
    const b = build();
    // Prove the random selection actually exercises the owned RNG boundary,
    // not bare Math.random: doEnlistment("") always makes a random service
    // pick, and if that pick escaped to Math.random the run could not be
    // reproduced and c.rng.pick would never be called.
    const pickA = vi.spyOn(a.rng, "pick");
    const svcA = a.doEnlistment("");
    const svcB = b.doEnlistment("");
    expect(pickA).toHaveBeenCalled();
    // Same seed + same owned stream → identical enlistment outcome.
    expect(svcA).toBe(svcB);
    expect(a.service).toBe(b.service);
    expect(a.drafted).toBe(b.drafted);
    expect(a.skills).toEqual(b.skills);
  });
});

// ---------------------------------------------------------------------------
// Bug #6 — dead `rankBands` block in mt-megatraveller.json with wrong values
// (all +1) shadowed by the correct `rankExtraRolls`. Removing the dead
// block ensures the fallback path won't yield wrong values if
// rankExtraRolls is ever removed.
// ---------------------------------------------------------------------------

describe("Bug #6: MT JSON has no stale rankBands block", () => {
  it("MT musterOutRolls does not declare rankBands (only rankExtraRolls)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const json = JSON.parse(
      readFileSync(resolve(__dirname, "../data/editions/mt-megatraveller.json"), "utf8"),
    ) as { rules: { musterOutRolls: Record<string, unknown> } };
    expect(json.rules.musterOutRolls.rankBands).toBeUndefined();
    expect(json.rules.musterOutRolls.rankExtraRolls).toBeDefined();
  });

  it("rank-5 4-term MT character still gets correct cumulative bonus (11 rolls)", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "navy";
    c.terms = 4;
    c.rank = 5;
    // MT: 2 per term × 4 terms + rank 5-6 cumulative +3 = 11
    expect(c.musterOutRolls()).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Bug #7 — honors education `+1` over-applied: stacked on top of education
// roll rather than being a replacement bonus per PM "raises to 10 or +1".
// Fix: take max(honorsDelta, rollDelta) rather than overwriting / stacking.
// ---------------------------------------------------------------------------

describe("Bug #7: honors education bonus does not stack on top of education roll", () => {
  function makeCandidate(eduStart: number): Character {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.useAcg = true;
    c.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 12, education: eduStart, social: 12,
    };
    return c;
  }

  // doPreCareer("college") consumes Math.random in this exact order:
  //   admission 2D (2 calls)
  //   success 2D   (2)
  //   OTC 2D       (2 — happens BEFORE education in the code)
  //   education 1D (1)
  //   honors 2D    (2)
  // For d6 = v, Math.random should return (v-1)/6 + 0.001.

  function d6(v: number): number {
    return (v - 1) / 6 + 0.001;
  }

  it("Edu 8 + low education roll → honors floor of 10 prevails (rollDelta < honorsDelta)", () => {
    const c = makeCandidate(8);
    let i = 0;
    const seq = [
      d6(6), d6(6), // admission 12
      d6(6), d6(6), // success 12
      d6(6), d6(6), // OTC 12
      d6(1),        // education 1D=1 → max(1, 1-2+1)=1 → rollDelta=1
      d6(6), d6(6), // honors 12
    ];
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
    c.doPreCareer("college");
    // honorsDelta = max(10, 8+1) - 8 = 2. rollDelta = 1. max(2,1) = 2.
    expect(c.attributes.education).toBe(10);
  });

  it("Edu 8 + max education roll: bonus is +3 roll, NOT stacked +4 (bug-#7 lock)", () => {
    // Pre-fix behaviour: projectedEdu = 8 + rollDelta(5) = 13; target =
    // max(10, 14) = 14; honorsDelta = 6 → attributeChanges.education
    // OVERWRITTEN to 6 → Edu = 14 (clamped if needed).
    // Fix: max(honorsDelta=2, rollDelta=5) = 5 → Edu = 13.
    const c = makeCandidate(8);
    let i = 0;
    const seq = [
      d6(6), d6(6), d6(6), d6(6), d6(6), d6(6),
      d6(6),        // education 1D=6 → max(1, 6-2+1) = 5 → rollDelta=5
      d6(6), d6(6),
    ];
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
    c.doPreCareer("college");
    expect(c.attributes.education).toBe(13); // pre-fix: 14
  });

  it("Edu 13 honors + low education roll → honors +1 floor raises to 14", () => {
    const c = makeCandidate(13);
    let i = 0;
    const seq = [
      d6(6), d6(6), d6(6), d6(6), d6(6), d6(6),
      d6(1),        // education 1D=1 → max(1, 1-2+1)=1 → rollDelta=1
      d6(6), d6(6),
    ];
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
    c.doPreCareer("college");
    // honorsDelta = max(10, 14) - 13 = 1, rollDelta = 1, max = 1 → Edu 14.
    expect(c.attributes.education).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Bug #8 — serviceLoader's enlistmentDM passed a Character cast from a
// partial object. evaluateDM now accepts a narrow DmContext type — no
// cast needed, and accidental widening to other Character fields would
// be a compile error.
// ---------------------------------------------------------------------------

describe("Bug #8: evaluateDM accepts a narrow DmContext (no Character cast required)", () => {
  it("evaluateDM with {attributes, terms} compiles and evaluates correctly", () => {
    const ctx = {
      attributes: {
        strength: 8, dexterity: 8, endurance: 8,
        intelligence: 8, education: 8, social: 8,
      },
      terms: 2,
    };
    // attribute threshold rule
    expect(evaluateDM(
      [{ dm: 1, attribute: "intelligence", min: 8 }],
      ctx,
    )).toBe(1);
    // per-term rule (Belter): dmPerTerm × terms
    expect(evaluateDM([{ dmPerTerm: 1 }], ctx)).toBe(2);
    // multiple rules sum
    expect(evaluateDM([
      { dm: 1, attribute: "intelligence", min: 8 },
      { dm: 2, attribute: "education", min: 8 },
    ], ctx)).toBe(3);
  });

  it("threshold below min does not fire", () => {
    expect(evaluateDM(
      [{ dm: 1, attribute: "intelligence", min: 9 }],
      { attributes: { strength: 7, dexterity: 7, endurance: 7,
        intelligence: 8, education: 7, social: 7 }, terms: 0 },
    )).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Minor — improveAttribute now logs every change (including the social-min
// clamp case, which previously fell off the log path).
// ---------------------------------------------------------------------------

describe("Minor: improveAttribute logs every change including social clamp", () => {
  it("social clamp produces a verbose-history line", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "verbose";
    c.attributes.social = 1;
    c.improveAttribute("social", -5); // would go to -4, clamped to socialMin=1
    expect(c.attributes.social).toBe(1);
    expect(c.history.some((h) => /Soc\b|social/i.test(h))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minor — applyPreCareerResult now clamps attribute changes at the lower
// bound (0) too, not just the upper bound (15).
// ---------------------------------------------------------------------------

describe("Minor: pre-career attributeChanges clamp lower bound at 0", () => {
  it("a hypothetical negative pre-career delta cannot push attribute below 0", async () => {
    const { applyPreCareerResult } = await import("../lib/traveller/engine/acg/preCareer");
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.useAcg = true;
    c.attributes = {
      strength: 2, dexterity: 5, endurance: 5,
      intelligence: 5, education: 5, social: 5,
    };
    applyPreCareerResult(c, "college", {
      admitted: true, graduated: true, honors: false, commissioned: false,
      attributeChanges: { strength: -10 }, // hypothetical pathological delta
      skills: [], notes: [], ageGainedYears: 0, firstTermShort: false,
      branch: null, autoEnlistPathway: null, draftedInto: null,
      medicalDirectCommission: false,
    });
    expect(c.attributes.strength).toBe(0);
  });
});
