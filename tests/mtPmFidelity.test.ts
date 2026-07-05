// Regression guards for six MegaTraveller data-fidelity corrections
// (branch feat/chargen-models, commit 7ede4c2 "Correct MT edition data
// against the Players' Manual"). Every EXPECTED value below is a literal
// transcribed from the MT Players' Manual page images; only the ACTUAL side
// reads getEdition("mt-megatraveller") or drives the chargen engine. Reverting
// any one corrected JSON value reddens exactly the matching case.
//
// Determinism note (MT-H): the classic model runs a whole service term on a
// clone of the character (session.runAction -> cloneCharacter), and
// cloneCharacter forks a FRESH Rng via rng.clone(). An instance-level
// `vi.spyOn(c.rng, "roll")` therefore does NOT pin the cloned term's rolls —
// its promotion throw falls back to Math.random and the noble intermittently
// promotes off the social-derived rank (observed rank 3 OR 4 over repeated
// runs). We pin `Rng.prototype.roll` instead so every clone's roll is fixed at
// 8: survival passes (4+), promotion fails (12+), isolating the rank-by-social
// derivation. This is the only shape that is not flaky.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition } from "../lib/traveller/editions";
import { getEditionServices } from "../lib/traveller/services";
import { musterOutPay } from "../lib/traveller/chargen/muster";
import * as session from "../lib/traveller/chargen/session";
import { Rng } from "../lib/traveller/random";
import type { ServiceKey } from "../lib/traveller";

const MT = "mt-megatraveller";

afterEach(() => { vi.restoreAllMocks(); });

function mtCharacter(social = 7): Character {
  return new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social,
    },
  });
}

// MT-G — Retirement pension is Cr2000 x terms served (PM p.22). The engine
// computes basePensionCredits + (qualifyingTerms - eligibleAfter) * perTerm;
// the fix set basePensionCredits 4000 -> 10000 so a 5-term retiree draws
// Cr10,000 (= Cr2000 x 5), not the CT-copied Cr4,000.
describe("MT-G retirement pension (PM p.22)", () => {
  function retiree(service: ServiceKey, terms: number): Character {
    const c = mtCharacter();
    c.editionId = MT;
    c.chargenModelId = "classic";
    c.service = service;
    c.terms = terms;
    c.chargenStatus = { kind: "retired", reason: "retirement", withPension: true };
    return c;
  }

  it("Army 5 terms = Cr 10,000 (base pension at the 5-term floor)", () => {
    const c = retiree("army", 5);
    musterOutPay(c);
    expect(c.retirementPay).toBe(10000);
  });

  it("Army 8 terms = Cr 16,000 (base + 3 x Cr2,000)", () => {
    const c = retiree("army", 8);
    musterOutPay(c);
    expect(c.retirementPay).toBe(16000);
  });

  it("Army 4 terms = Cr 0 (below the 5-term floor)", () => {
    const c = retiree("army", 4);
    musterOutPay(c);
    expect(c.retirementPay).toBe(0);
  });

  it("Scouts 8 terms = Cr 0 (excluded service)", () => {
    const c = retiree("scouts", 8);
    musterOutPay(c);
    expect(c.retirementPay).toBe(0);
  });
});

// MT-H — Noble rank derives from Social Standing (PM p.22 Table of Ranks:
// Knight/11 .. Duke/15). The rankBySocial block (rankOffset -10, socialFloor
// 10, maxRank 5) makes rank = Social - 10. Without it the noble commissions to
// rank 1 off the term roll, so every row here (rank != 1) reddens on revert.
describe("MT-H noble rank derives from Social Standing (PM p.22)", () => {
  const rows: { social: number; rank: number; title: string }[] = [
    { social: 12, rank: 2, title: "Baron" },
    { social: 13, rank: 3, title: "Marquis" },
    { social: 15, rank: 5, title: "Duke (maxRank boundary)" },
  ];

  for (const { social, rank, title } of rows) {
    it(`Soc ${social} noble ends the term at rank ${rank} (${title})`, () => {
      // Fixed roll of 8 across the cloned term: survival passes, promotion
      // fails, so rank comes solely from the social-derived starting rank.
      vi.spyOn(Rng.prototype, "roll").mockReturnValue(8);
      const c = mtCharacter(social);
      c.editionId = MT;
      c.chargenModelId = "classic";
      c.service = "nobles";
      const snap = session.runTerm({ character: c, phase: "term" });
      expect(snap.character.rank).toBe(rank);
    });
  }
});

// MT-A — Sailor "Large Watercraft" is a rank-2 grant, not rank-1 (PM p.20
// Table of Ranks: Sailor Lieutenant = rank 2). Exercised behaviorally: the
// service's rank-triggered auto-skill fires in doPromotion when ch.rank equals
// the entry's rank. Before the fix, a rank-1 sailor received the skill and a
// rank-2 sailor did not; both assertions flip on revert.
describe("MT-A Sailor Large Watercraft is a rank-2 grant (PM p.20)", () => {
  function sailorAtRank(rank: number): Character {
    const c = mtCharacter();
    c.editionId = MT;
    c.service = "sailors";
    c.rank = rank;
    getEditionServices(MT).sailors!.doPromotion(c);
    return c;
  }

  it("A sailor promoted to rank 2 gains Large Watercraft-1", () => {
    expect(sailorAtRank(2).checkSkillLevel("Large Watercraft", 1)).toBe(true);
  });

  it("A sailor at rank 1 does NOT gain Large Watercraft", () => {
    expect(sailorAtRank(1).checkSkill("Large Watercraft")).toBe(-1);
  });
});

// MT-C / MT-D — Doctor and Diplomat Personal Development die 2 were swapped
// (PM p.23). Skill tables are 1-indexed by die roll (index 0 = null); die 2 is
// index 2. Doctor die 2 is +1 Dexterity; Diplomat die 2 is +1 Education.
describe("MT-C/MT-D Personal Development die 2 (PM p.23)", () => {
  it("Doctor PD die 2 = +1 Dexterity", () => {
    expect(getEdition(MT).data.services.doctors.skillTables.personalDevelopment[2])
      .toBe("+1 Dexterity");
  });

  it("Diplomat PD die 2 = +1 Education", () => {
    expect(getEdition(MT).data.services.diplomats.skillTables.personalDevelopment[2])
      .toBe("+1 Education");
  });
});

// MT-F — Hunter Advanced Education die 6 is Economic, not Academic (PM p.25).
describe("MT-F Hunter Advanced Education die 6 (PM p.25)", () => {
  it("Hunter advanced-education die 6 = Economic", () => {
    expect(getEdition(MT).data.services.hunters.skillTables.advancedEducation[6])
      .toBe("Economic");
  });
});
