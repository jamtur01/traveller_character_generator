// Regression tests for the Group A/B/D basic-chargen + JSON-source-of-truth
// fixes (commits 4fe5776 "Fix chargen bugs and migrate hardcoded rules to
// edition JSON" and e52cbe7 "Remove dead JSON/schema keys and close cleanup
// gaps"). Each describe block names the fix ID and the contract it defends.
//
// Value-preserving migrations (a hardcoded constant moved into JSON with the
// same value) are proven data-driven by temporarily overriding the JSON value
// to a NON-default and asserting the observable behavior follows it — the
// pre-fix hardcoded constant ignores the override, so the test fails on old
// code. Every override is restored in a finally block for full-suite safety.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition } from "../lib/traveller/editions";
import { getEditionServices } from "../lib/traveller/services";
import { applyCell } from "../lib/traveller/engine/cellResolver";
import { promotionStep } from "../lib/traveller/engine/steps/promotion";
import { commissionStep } from "../lib/traveller/engine/steps/commission";
import { applyPreCareerResult } from "../lib/traveller/engine/acg/preCareer";
import { skillRequiresOverride } from "../lib/traveller/engine/skillRestrictions";
import { cascadePoolByKey } from "../lib/traveller/engine/cascadeMap";

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

function makeBasic(editionId: string, service: string): Character {
  const c = new Character();
  c.editionId = editionId;
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  c.service = service as Character["service"];
  c.skills = [];
  c.benefits = [];
  return c;
}

// ---------------------------------------------------------------------------
// A2 — promotion is capped at a service's highest NAMED rank. Services that
// top out at index 5 (CT merchants "Captain", pirates, nobles, barbarians)
// have an empty ranks[6]; the old cap = max(Object.keys()) = 6 let them
// over-promote into that empty slot and bank a spurious skill point.
// Fix: lib/traveller/engine/steps/promotion.ts derives the cap from the
// highest rank index whose name is non-empty.
// ---------------------------------------------------------------------------

describe("A2: promotion capped at highest named rank (no phantom rank 6)", () => {
  it("commissioned CT merchant at top rank (Captain=5) does not promote into empty rank 6", () => {
    // roll(2) = 12 clears the merchants promotion target (10), so the ONLY
    // thing that can stop promotion is the rank cap. On the old code the cap
    // was 6, so the character would advance to the empty rank 6 and gain a
    // skill point.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeBasic("ct-classic", "merchants");
    c.commissioned = true;
    c.rank = 5; // Captain — top named merchant rank
    c.skillPoints = 0;
    const service = getEditionServices("ct-classic")["merchants"]!;
    promotionStep({ ch: c, edition: getEdition("ct-classic"), service, config: {} });
    expect(c.rank).toBe(5);
    expect(c.skillPoints).toBe(0);
  });

  it("a commissioned merchant BELOW the top rank still promotes (cap does not over-restrict)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeBasic("ct-classic", "merchants");
    c.commissioned = true;
    c.rank = 3;
    c.skillPoints = 0;
    const service = getEditionServices("ct-classic")["merchants"]!;
    promotionStep({ ch: c, edition: getEdition("ct-classic"), service, config: {} });
    expect(c.rank).toBe(4);
    expect(c.skillPoints).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A6 — the `retired` flag and the pension must agree. MT excludes terms whose
// muster benefits were forfeited to anagathics from BOTH eligibility and the
// pension (rules.retirement.anagathicTermsExcluded). The old isRetirementEligible
// used raw `terms`, so a 5-term character with 2 forfeited terms was flagged
// retired (5 >= 5) while the pension calc — which excluded the forfeited terms
// — paid nothing. Fix: both route through qualifyingRetirementTerms().
// ---------------------------------------------------------------------------

describe("A6: retirement flag agrees with pension via qualifyingRetirementTerms", () => {
  it("MT anagathics user terms=5, forfeited=2 (qualifying=3<5): not retired, no pension", () => {
    const c = makeMt();
    c.service = "army"; // not on the retirement excludedServices list
    c.terms = 5;
    c.anagathics.anagathicsBenefitForfeitedTerms = 2;
    c.endChargenRetired("mustered out at term 5");
    expect(c.retired).toBe(false);
    c.musterOutPay();
    expect(c.benefits.some((b) => /Retirement Pay/i.test(b))).toBe(false);
    expect(c.retirementPay ?? 0).toBe(0);
  });

  it("MT user terms=5, forfeited=0 (qualifying=5): retired with pension (control)", () => {
    const c = makeMt();
    c.service = "army";
    c.terms = 5;
    c.anagathics.anagathicsBenefitForfeitedTerms = 0;
    c.endChargenRetired("mustered out at term 5");
    expect(c.retired).toBe(true);
    c.musterOutPay();
    expect(c.benefits.some((b) => /Retirement Pay/i.test(b))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A7(b) — fail-fast: an edition that generates homeworlds but declares no
// rules.homeworldSkillRestrictions must throw rather than silently disabling
// every homeworld weapon/vehicle skill limit. The old guard returned null.
// (A7(a) — that the override roll actually fires for a restricted skill — is
// already covered by tests/skillRestrictions.test.ts.)
// ---------------------------------------------------------------------------

describe("A7(b): missing homeworldSkillRestrictions fails fast", () => {
  it("MT with a homeworld block but no rules.homeworldSkillRestrictions throws", () => {
    const c = makeMt();
    c.service = "army";
    const rules = getEdition("mt-megatraveller").rules as { homeworldSkillRestrictions?: unknown };
    const saved = rules.homeworldSkillRestrictions;
    try {
      rules.homeworldSkillRestrictions = undefined;
      expect(() => skillRequiresOverride(c, "Grav Vehicle"))
        .toThrow(/homeworldSkillRestrictions/);
    } finally {
      rules.homeworldSkillRestrictions = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// B1 — a full term advances age by rules.survival.fullTermYears. The value is
// 4 in both shipped editions, so the migration is proven data-driven by
// overriding fullTermYears and asserting the age bump follows. Old code
// hardcoded `ch.age += 4`.
// ---------------------------------------------------------------------------

describe("B1: term length sourced from rules.survival.fullTermYears", () => {
  for (const editionId of ["ct-classic", "mt-megatraveller"]) {
    it(`${editionId}: a term advances age by the JSON fullTermYears, not a hardcoded 4`, () => {
      vi.spyOn(Math, "random").mockReturnValue(0.999); // survive/commission/reenlist pass
      const c = makeBasic(editionId, "army");
      const survival = getEdition(editionId).rules.survival as { fullTermYears: number };
      const saved = survival.fullTermYears;
      try {
        survival.fullTermYears = 6;
        const before = c.age;
        c.doServiceTermStep();
        expect(c.age - before).toBe(6);
      } finally {
        survival.fullTermYears = saved;
      }
    });
  }
});

// ---------------------------------------------------------------------------
// B2 — the first-term commission block for draftees is gated on
// rules.draft.noCommissionFirstTerm. Old code hardcoded the block, so a
// drafted first-term character could NEVER commission regardless of edition.
// With the flag off, a drafted first-term commission must go through.
// ---------------------------------------------------------------------------

describe("B2: drafted-first-term commission gated by rules.draft.noCommissionFirstTerm", () => {
  for (const editionId of ["ct-classic", "mt-megatraveller"]) {
    it(`${editionId}: rule ON blocks the drafted first-term commission`, () => {
      vi.spyOn(Math, "random").mockReturnValue(0.999); // commission would otherwise pass
      const c = makeBasic(editionId, "army");
      c.drafted = true;
      c.terms = 1;
      c.commissioned = false;
      c.rank = 0;
      const service = getEditionServices(editionId)["army"]!;
      commissionStep({ ch: c, edition: getEdition(editionId), service, config: {} });
      expect(c.commissioned).toBe(false);
    });

    it(`${editionId}: rule OFF (data-driven) lets the drafted first-term commission through`, () => {
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      const c = makeBasic(editionId, "army");
      c.drafted = true;
      c.terms = 1;
      c.commissioned = false;
      c.rank = 0;
      const draft = getEdition(editionId).rules.draft as { noCommissionFirstTerm?: boolean | undefined };
      const saved = draft.noCommissionFirstTerm;
      try {
        draft.noCommissionFirstTerm = false;
        const service = getEditionServices(editionId)["army"]!;
        commissionStep({ ch: c, edition: getEdition(editionId), service, config: {} });
        expect(c.commissioned).toBe(true);
        expect(c.rank).toBe(1);
      } finally {
        draft.noCommissionFirstTerm = saved;
      }
    });
  }
});

// ---------------------------------------------------------------------------
// B3 — pre-career attribute gains clamp through improveAttribute, which reads
// rules.attributeCaps.max, instead of a hardcoded 0..15 clamp.
// ---------------------------------------------------------------------------

describe("B3: pre-career Edu gain clamps via rules.attributeCaps.max", () => {
  it("Edu gain clamps at the JSON attributeCaps.max, not a hardcoded 15", () => {
    const c = makeMt();
    c.attributes.education = 12;
    const caps = getEdition("mt-megatraveller").rules.attributeCaps as { max: number };
    const saved = caps.max;
    try {
      caps.max = 13;
      applyPreCareerResult(c, "college", {
        admitted: true, graduated: true, honors: false, commissioned: false,
        attributeChanges: { education: 5 }, // 12 + 5 = 17, clamps to 13
        skills: [], notes: [], ageGainedYears: 0, firstTermShort: false,
        branch: null, autoEnlistPathway: null, draftedInto: null,
        medicalDirectCommission: false,
      });
      expect(c.attributes.education).toBe(13);
    } finally {
      caps.max = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// B4 — first receipt of a ship benefit sets the mortgage from
// benefitDetails.<ship>.firstReceiptMortgageYears (mortgaged ships) or 0
// (owned ships that omit it). Old applyShipBenefit never set the mortgage on
// first receipt, so it kept whatever value was already on the character.
// ---------------------------------------------------------------------------

describe("B4: ship first-receipt mortgage from benefitDetails.firstReceiptMortgageYears", () => {
  it("Free Trader (mortgaged) sets mortgage to 40 on first receipt", () => {
    const c = makeMt();
    c.service = "merchants";
    c.mortgage = 99; // sentinel: proves applyShipBenefit sets, not leaves
    applyCell(c, "Free Trader", "muster", getEdition("mt-megatraveller").data.benefitDetails);
    expect(c.mortgage).toBe(40);
    expect(c.ship).toBe(true);
  });

  it("Scout Ship (owned, no firstReceiptMortgageYears) sets mortgage to 0", () => {
    const c = makeMt();
    c.service = "scouts";
    c.mortgage = 99;
    applyCell(c, "Scout Ship", "muster", getEdition("mt-megatraveller").data.benefitDetails);
    expect(c.mortgage).toBe(0);
    expect(c.ship).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B10 — the MT skill cap is the sum of the attributes named in
// rules.skillCap.attributes, not a hardcoded intelligence+education.
// ---------------------------------------------------------------------------

describe("B10: skillCap sums rules.skillCap.attributes", () => {
  it("uses the JSON-named operands, not a hardcoded Int+Edu", () => {
    const c = makeMt();
    c.attributes = {
      strength: 7, dexterity: 6, endurance: 5,
      intelligence: 4, education: 3, social: 2,
    };
    const skillCap = getEdition("mt-megatraveller").rules.skillCap as { attributes: string[] };
    const saved = skillCap.attributes;
    try {
      skillCap.attributes = ["strength", "dexterity"];
      expect(c.skillCap()).toBe(13); // 7 + 6, not intelligence(4)+education(3)
    } finally {
      skillCap.attributes = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// B11 — a repeated muster benefit is non-stackable only when its
// benefitDetails.<label>.repeat === "no effect". Old code additionally
// hardcoded "Watch"/"Instruments" as non-stackable regardless of config, so
// a Watch with no repeat marker would still be suppressed on the old code.
// ---------------------------------------------------------------------------

describe("B11: benefit non-stackability is driven by benefitDetails.repeat", () => {
  it("repeat = 'no effect' suppresses the second receipt", () => {
    const c = makeMt();
    const bd = { Watch: { displayName: "Watch", repeat: "no effect" } };
    applyCell(c, "Watch", "muster", bd);
    applyCell(c, "Watch", "muster", bd);
    expect(c.benefits.filter((b) => b === "Watch")).toHaveLength(1);
  });

  it("no repeat marker means the benefit stacks (old code hardcoded Watch as non-stackable)", () => {
    const c = makeMt();
    const bd = { Watch: { displayName: "Watch" } };
    applyCell(c, "Watch", "muster", bd);
    applyCell(c, "Watch", "muster", bd);
    expect(c.benefits.filter((b) => b === "Watch")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// B12 — muster blade/gun cascades route through cascadeKeyForLabel (edition
// cascadeAliases), not a hardcoded {blade cbt / blade combat / blade} label
// list. A newly-aliased label must therefore reach doBladeBenefit; the old
// hardcoded check would drop it into the generic cascade path (which never
// sets bladeBenefit).
// ---------------------------------------------------------------------------

describe("B12: blade/gun muster cascade routed via cascadeKeyForLabel", () => {
  it("a bladeCombat-aliased label reaches the blade weapon benefit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const c = makeMt();
    c.service = "navy";
    c.bladeBenefit = "";
    const aliases = getEdition("mt-megatraveller").data.cascadeAliases as Record<string, string>;
    const had = Object.prototype.hasOwnProperty.call(aliases, "sabre");
    try {
      aliases["sabre"] = "bladeCombat";
      applyCell(c, "Sabre", "muster");
      expect(c.bladeBenefit).not.toBe("");
      expect(cascadePoolByKey("bladeCombat", "mt-megatraveller")).toContain(c.bladeBenefit);
    } finally {
      if (!had) delete aliases["sabre"];
    }
  });
});

// ---------------------------------------------------------------------------
// B14 — MT reenlistment has no mandatory retire-term cap (voluntaryAnyTerms),
// and the dead retire-cap keys were removed from the JSON.
// ---------------------------------------------------------------------------

describe("B14: MT reenlistment has voluntaryAnyTerms and no dead retire-cap keys", () => {
  it("declares voluntaryAnyTerms and drops retireAfterCompletedTerm/mandatoryRoll(+Note)", () => {
    const reenl = getEdition("mt-megatraveller").rules.reenlistment as Record<string, unknown>;
    expect(reenl.voluntaryAnyTerms).toBe(true);
    expect(reenl.retireAfterCompletedTerm).toBeUndefined();
    expect(reenl.mandatoryRoll).toBeUndefined();
    expect(reenl.mandatoryRollNote).toBeUndefined();
  });

  it("a past-cap MT character is not force-retired at reenlistment", () => {
    const c = makeMt();
    c.service = "army";
    c.terms = 8; // well past the CT term-7 cap
    vi.spyOn(c.rng, "roll").mockReturnValue(11); // clears reenlist target, not the exact-12 mandatory
    c.doReenlistmentStep();
    expect(c.chargenStatus.kind).not.toBe("retired");
  });
});

// ---------------------------------------------------------------------------
// D3 — the forceTable skill path gates advancedEducation8Plus on
// rules.skillTableMeta.advancedEducationEduMin. A character below the Edu
// floor who forces that table rerolls onto the standard advancedEducation
// table. Old code rolled the 8+ table regardless of Education.
// ---------------------------------------------------------------------------

describe("D3: forceTable Advanced Education (8+) gated by Edu, rerolls to Edu table", () => {
  it("Edu < 8 forcing the 8+ table gets a standard Advanced Education skill", () => {
    const c = makeMt();
    c.service = "army";
    c.attributes.education = 6; // below advancedEducationEduMin (8)
    c.skills = [];
    c.muster.forceTable = true;
    c.muster.forceTableIndex = 4; // advancedEducation8Plus
    vi.spyOn(c.rng, "roll").mockReturnValue(2); // die 2
    getEditionServices("mt-megatraveller")["army"]!.acquireSkill(c);
    // die 2: advancedEducation → "Mechanical"; advancedEducation8Plus → "Tactics"
    expect(c.skills.some(([n]) => n === "Mechanical")).toBe(true);
    expect(c.skills.some(([n]) => n === "Tactics")).toBe(false);
  });

  it("Edu >= 8 forcing the 8+ table gets the Advanced Education (8+) skill", () => {
    const c = makeMt();
    c.service = "army";
    c.attributes.education = 9; // meets the floor
    c.skills = [];
    c.muster.forceTable = true;
    c.muster.forceTableIndex = 4;
    vi.spyOn(c.rng, "roll").mockReturnValue(2);
    getEditionServices("mt-megatraveller")["army"]!.acquireSkill(c);
    expect(c.skills.some(([n]) => n === "Tactics")).toBe(true);
    expect(c.skills.some(([n]) => n === "Mechanical")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D6(a) — CT (Citizens of the Imperium) barbarians cannot retire; they are on
// rules.retirement.excludedServices. Old CT excludedServices was
// ["scouts", "other"], so a many-term barbarian was wrongly eligible.
// ---------------------------------------------------------------------------

describe("D6(a): CT barbarians are excluded from retirement", () => {
  it("a CT barbarian with 8 terms is not retirement-eligible", () => {
    const c = makeBasic("ct-classic", "barbarians");
    c.terms = 8;
    expect(c.isRetirementEligible()).toBe(false);
  });

  it("a CT army character with 8 terms IS retirement-eligible (exclusion is service-specific)", () => {
    const c = makeBasic("ct-classic", "army");
    c.terms = 8;
    expect(c.isRetirementEligible()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D6(b) — a failed anagathics retry-survival ends the term after only the
// short-term length, so the full-term age bump applied at term start must be
// rewound to rules.survival.shortTermYears. Old code left the age advanced.
// ---------------------------------------------------------------------------

describe("D6(b): failed anagathics retry survival rewinds age to the short-term length", () => {
  it("age is rewound by fullTermYears - shortTermYears on retry-survival failure", () => {
    const c = makeMt();
    c.service = "army";
    c.age = 34;
    c.terms = 3;
    c.resumeActive();
    const r = vi.spyOn(c.rng, "roll");
    r.mockReturnValueOnce(2)  // availability (2 + 6 homeworld DMs = 8 < 12): fail
     .mockReturnValueOnce(2); // retry survival (army 5+): fail → forced short-term muster
    expect(c.tryAnagathics()).toBe(false);
    expect(c.age).toBe(32); // 34 - (fullTermYears 4 - shortTermYears 2)
    expect(c.chargenStatus.kind).toBe("retired");
  });
});
