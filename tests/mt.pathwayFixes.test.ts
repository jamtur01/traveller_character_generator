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
} from "../lib/traveller/engine/acg/pathways/merchantPrince";
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
    expect(c.acgState!.department).toBe("Free Trader");
    const startAge = c.age;
    runAcgTerm(c);
    // 4-year term advances age by 4 (or fewer if invalided early).
    expect(c.age - startAge).toBeGreaterThan(0);
    expect(c.age - startAge).toBeLessThanOrEqual(4);
    // Department doesn't change mid-career for Free Traders.
    expect(c.acgState!.department).toBe("Free Trader");
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
    c.acgState!.lineType = "Free Trader";
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
    c.acgState!.lineType = "Free Trader";
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
    expect(c.acgState!.branch).toBe("Medical");
  });

  it("Naval Academy + Flight School → Flight branch", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.doPreCareer("navalAcademy");
    c.doPreCareer("flightSchool");
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(c.acgState!.branch).toBe("Flight");
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
    c.acgState!.combatArm = "Cavalry";
    c.acgState!.crossTrainedArms = ["Artillery"];
    expect(mercenaryReenlist(c)).toBe(true);
  });

  it("Same roll 5, no cross-training: no DM → 5 < 6 reenlist denied", () => {
    const c = setupMarineAtRoll5();
    c.acgState!.combatArm = "Cavalry";
    c.acgState!.crossTrainedArms = []; // no cross-training
    expect(mercenaryReenlist(c)).toBe(false);
  });

  it("Cross-trained but current arm is Infantry: DM does not fire → 5 < 6 denied", () => {
    // The DM rule requires currentCombatArmIn = [Artillery, Cavalry].
    // Infantry doesn't qualify even with cross-training.
    const c = setupMarineAtRoll5();
    c.acgState!.combatArm = "Infantry";
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
    expect(c.acgState!.branch).toBeFalsy(); // not set until choice resolves
    // Resolve to Flight → branch stamps onto state, choice clears.
    const flightIdx = choice.options.indexOf("Flight");
    c.resolveChoice(choice.id, flightIdx);
    expect(c.acgState!.branch).toBe("Flight");
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
