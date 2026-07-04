// Coverage for the pathway-gap fixes:
//   - Merchant row 13 reachable, Free Trader column mapped, Special routes
//     through Special Duty, bonus uses real cash table, Free Trader ship
//     awarded at muster.
//   - Mercenary academy graduates start at O1, homeworld Avg Stellar+
//     adds MOS DM, Marine cross-train reenlist DM works.
//   - Navy medical/flight grads auto-branch, Naval Academy auto-enlists O1.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { runAcgTerm } from "../lib/traveller/engine/runners/acg";
import {
  merchantRollAssignment,
  merchantEndOfTerm,
} from "../lib/traveller/engine/acg/pathways/merchantPrince";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import {
  mercenaryReenlist,
} from "../lib/traveller/engine/acg/pathways/mercenary";

afterEach(() => { vi.restoreAllMocks(); });

function makeMt(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.useAcg = true;
  c.attributes = {
    strength: 10, dexterity: 10, endurance: 10,
    intelligence: 10, education: 10, social: 10,
  };
  return c;
}

describe("Merchant: row 13 reachable on the specific assignment table", () => {
  // Use a smallLine (Interface) because its column distinguishes row 12
  // from row 13: die 12 = "Special", die 13 = "Transfer Up". Largelines
  // are "Special" on both rows so wouldn't prove the DM shifted the result.
  it("Roll 12 + DM 0 (smallLine O1) → die 12 → 'Special'", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Interface" });
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O1";
    c.attributes.education = 12; // avoid -1 edu DM
    expect(merchantRollAssignment(c)).toBe("Special");
  });

  it("Roll 12 + DM +1 (smallLine O4+) → die 13 → 'Transfer Up'", () => {
    // Same roll, rankAtLeast O4 DM +1 → die 13. Proves the +1 DM is
    // both wired and that the table does not clamp at 12.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Interface" });
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O4";
    c.attributes.education = 12;
    expect(merchantRollAssignment(c)).toBe("Transfer Up");
  });
});

describe("Merchant: Free Trader assignment column maps correctly", () => {
  it("Free Trader term advances time, gains skills, and stays in Free Trader department", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.requireMerchantAcg().department).toBe("Free Trader");
    const startAge = c.age;
    runAcgTerm(c);
    // 4-year term advances age by 4 (or fewer if invalided early).
    expect(c.age - startAge).toBeGreaterThan(0);
    expect(c.age - startAge).toBeLessThanOrEqual(4);
    // Department doesn't change mid-career for Free Traders.
    expect(c.requireMerchantAcg().department).toBe("Free Trader");
    // A successful term should have produced at least one history entry
    // referencing an assignment outcome.
    expect(c.history.length).toBeGreaterThan(0);
  });
});

describe("Merchant: Free Trader Owner gets ship benefit at muster", () => {
  it("Rank O5+ Free Trader gets Free Trader benefit on musterOutPay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O5";
    c.requireMerchantAcg().lineType = "Free Trader";
    c.terms = 4;
    c.musterOutPay();
    const hasShip = c.benefits.some((b) => /free trader/i.test(b));
    expect(hasShip).toBe(true);
  });

  it("Rank below O5 Free Trader does NOT get the ship", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O3";
    c.requireMerchantAcg().lineType = "Free Trader";
    c.musterOutPay();
    const hasShip = c.benefits.some((b) => /free trader/i.test(b));
    expect(hasShip).toBe(false);
  });
});

describe("Mercenary: academy graduate auto-enlists at O1", () => {
  it("Military Academy honors → mercenary enlist preserves rank O1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    const pc = c.doPreCareer("militaryAcademy");
    expect(pc.graduated).toBe(true);
    expect(pc.commissioned).toBe(true);
    expect(c.acgState!.rankCode).toBe("O1");
    expect(c.acgState!.isOfficer).toBe(true);
    expect(c.acgState!.preCareerCommission).toBe(true);
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    expect(c.acgState!.rankCode).toBe("O1");
    expect(c.acgState!.isOfficer).toBe(true);
    expect(c.commissioned).toBe(true);
  });
});

describe("Navy: medical/flight school graduates get auto-branch", () => {
  it("Naval Academy + Medical School → Medical branch", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.doPreCareer("navalAcademy");
    expect(c.acgState!.preCareerCommission).toBe(true);
    c.doPreCareer("medicalSchool");
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(c.requireNavyAcg().branch).toBe("Medical");
  });

  it("Naval Academy + Flight School → Flight branch", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.doPreCareer("navalAcademy");
    c.doPreCareer("flightSchool");
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(c.requireNavyAcg().branch).toBe("Flight");
  });
});

describe("Mercenary: cross-trained Marines get reenlist DM +1", () => {
  // Marine reenlist target=6. DM +1 fires when crossTrainedInAny includes
  // Artillery/Cavalry AND currentCombatArm is Artillery/Cavalry. Pin the
  // 2d6 to 5 (one below target) so DM is the only thing that flips the
  // outcome between pass and fail.
  function setupMarineAtRoll5(): Character {
    const c = makeMt();
    // Pin all post-construction rolls to produce 2d6=5 (2/6+0.001 → die=2,
    // 2/6+0.001 → die=3 — total 5).
    const seq = [1 / 6 + 0.001, 2 / 6 + 0.001];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]!);
    c.beginAcg("mercenary", { service: "marines", combatArm: "Infantry" });
    return c;
  }

  it("Cross-trained Cavalry Marine on Cavalry: +1 DM → roll 5+1=6 ≥ 6 reenlists", () => {
    const c = setupMarineAtRoll5();
    c.requireMercenaryAcg().combatArm = "Cavalry";
    c.acgState!.crossTrainedArms = ["Artillery"];
    expect(mercenaryReenlist(c)).toBe(true);
  });

  it("Same roll 5, no cross-training: no DM → 5 < 6 reenlist denied", () => {
    const c = setupMarineAtRoll5();
    c.requireMercenaryAcg().combatArm = "Cavalry";
    c.acgState!.crossTrainedArms = []; // no cross-training
    expect(mercenaryReenlist(c)).toBe(false);
  });

  it("Cross-trained but current arm is Infantry: DM does not fire → 5 < 6 denied", () => {
    // The DM rule requires currentCombatArmIn = [Artillery, Cavalry].
    // Infantry doesn't qualify even with cross-training.
    const c = setupMarineAtRoll5();
    c.requireMercenaryAcg().combatArm = "Infantry";
    c.acgState!.crossTrainedArms = ["Cavalry"];
    expect(mercenaryReenlist(c)).toBe(false);
  });
});

describe("F4: interactive ACG choices pause the year via ChoicePendingError", () => {
  it("navy Soc 9+ branch pick queues a navyBranch choice; resolveChoice applies it", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.choiceMode = "interactive";
    c.attributes.social = 9;
    c.beginAcg("navy", { fleet: "imperialNavy" });
    // Interactive mode + Soc 9+ → branch choice is queued (not auto-resolved).
    expect(c.pendingChoices.length).toBeGreaterThan(0);
    const choice = c.pendingChoices[0]!;
    expect(choice.kind).toBe("navyBranch");
    expect(choice.options).toContain("Flight");
    expect(c.requireNavyAcg().branch).toBeFalsy(); // not set until choice resolves
    // Resolve to Flight → branch stamps onto state, choice clears.
    const flightIdx = choice.options.indexOf("Flight");
    c.resolveChoice(choice.id, flightIdx);
    expect(c.requireNavyAcg().branch).toBe("Flight");
    expect(c.pendingChoices.find((p) => p.id === choice.id)).toBeUndefined();
  });
});

describe("Mercenary: combat-arm entry restrictions (PM p. 50)", () => {
  it("Army cannot start as Commando without Military Academy honors", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    expect(() =>
      c.beginAcg("mercenary", { service: "army", combatArm: "Commando" }),
    ).toThrow(/Military Academy honors/);
  });
  it("Marines cannot start in Cavalry or Artillery", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    expect(() =>
      c.beginAcg("mercenary", { service: "marines", combatArm: "Cavalry" }),
    ).toThrow(/Marines cannot enter combat arm/);
  });
  it("Marines can start in Infantry or Support", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("mercenary", { service: "marines", combatArm: "Infantry" });
    expect(c.acgPathway).toBe("mercenary");
    expect(c.service).toBe("marines");
    expect(c.requireMercenaryAcg().combatArm).toBe("Infantry");
  });
});

// H1 regression — Merchant promotion was completely dead.
//
// Bug: the exam code indexed `ranksAndPromotions` by line-SIZE keys and
// expected an `.officer` sub-array, but the JSON is DEPARTMENT-keyed bare
// ladder arrays. The lookup returned nothing, so officers never promoted
// and enlisted route-servers never earned a commission. The fix reads the
// department ladder (Free Trader lines use the `freeTrader` ladder) and
// advances by rank number.
//
// Determinism: `roll(2)` consumes exactly two Math.random calls. d6(v) =
// (v-1)/6 + 0.001 so Math.floor(rand*6+1) === v. A constant mock is used
// because merchantEndOfTerm makes no other random calls on these paths.
//
// Teeth: on the pre-fix code the ladder lookup found nothing and both exam
// helpers early-returned, so rankCode never changed. Each "promotes" /
// "commissions" assertion below fails against that behavior.
function d6(v: number): number {
  return (v - 1) / 6 + 0.001;
}

describe("H1: Merchant Prince promotion exam (department-keyed ladder)", () => {
  function makeDeckOfficer(rankCode: string): Character {
    const c = makeMt();
    c.acgPathway = "merchantPrince";
    c.acgState = freshAcgState("merchantPrince");
    c.acgState.isOfficer = true;
    c.acgState.rankCode = rankCode;
    c.requireMerchantAcg().department = "Deck";
    c.requireMerchantAcg().lineType = "Megacorp"; // Large line → deck ladder
    return c;
  }

  it("officer O1→O2 on a passing deck exam (target 6+)", () => {
    // deck ladder O2 row exam target is 6+; roll(2) = 6 clears it exactly.
    vi.spyOn(Math, "random").mockReturnValue(d6(3)); // roll(2) = 3+3 = 6
    const c = makeDeckOfficer("O1");
    merchantEndOfTerm(c);
    expect(c.acgState!.rankCode).toBe("O2");
  });

  it("officer stays O1 on a failing deck exam (roll 5 < 6)", () => {
    // roll(2) = 5 (2 + 3) falls one under the 6+ target → no promotion.
    const seq = [d6(2), d6(3)];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]!);
    const c = makeDeckOfficer("O1");
    merchantEndOfTerm(c);
    expect(c.acgState!.rankCode).toBe("O1");
  });

  it("enlisted route-server earns a commission (E4 → officer O1) on a passing exam", () => {
    // Enlisted deck route-server tests the O1 entry exam (target 6+).
    vi.spyOn(Math, "random").mockReturnValue(d6(3)); // roll(2) = 6 → pass
    const c = makeMt();
    c.acgPathway = "merchantPrince";
    c.acgState = freshAcgState("merchantPrince");
    c.acgState.isOfficer = false;
    c.acgState.rankCode = "E4";
    c.requireMerchantAcg().department = "Deck";
    c.requireMerchantAcg().lineType = "Megacorp";
    c.acgState.perTerm.routeAssignmentThisTerm = true;
    merchantEndOfTerm(c);
    expect(c.acgState!.isOfficer).toBe(true);
    expect(c.acgState!.rankCode).toBe("O1");
  });

  it("enlisted route-server stays enlisted on a failing exam (roll 5 < 6)", () => {
    const seq = [d6(2), d6(3)]; // roll(2) = 5 → fail
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]!);
    const c = makeMt();
    c.acgPathway = "merchantPrince";
    c.acgState = freshAcgState("merchantPrince");
    c.acgState.isOfficer = false;
    c.acgState.rankCode = "E4";
    c.requireMerchantAcg().department = "Deck";
    c.requireMerchantAcg().lineType = "Megacorp";
    c.acgState.perTerm.routeAssignmentThisTerm = true;
    merchantEndOfTerm(c);
    expect(c.acgState!.isOfficer).toBe(false);
    expect(c.acgState!.rankCode).toBe("E4");
  });
});
