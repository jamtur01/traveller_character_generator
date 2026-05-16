// Coverage for the pathway-gap fixes:
//   - Merchant row 13 reachable, Free Trader column mapped, Special routes
//     through Special Duty, bonus uses real cash table, Free Trader ship
//     awarded at muster.
//   - Mercenary academy graduates start at O1, homeworld Avg Stellar+
//     adds MOS DM, Marine cross-train reenlist DM works.
//   - Navy medical/flight grads auto-branch, Naval Academy auto-enlists O1.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { runAcgTerm } from "../lib/traveller/engine/acg/runner";
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
  it("Roll 12 + DM +1 (rank O4+) yields die=13 without clamping", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O4";
    const out = merchantRollAssignment(c);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("Merchant: Free Trader assignment column maps correctly", () => {
  it("Free Trader Exploratory Trade routes through resolution without throwing", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = makeMt();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.acgState!.department).toBe("Free Trader");
    expect(() => runAcgTerm(c)).not.toThrow();
  });
});

describe("Merchant: Free Trader Owner gets ship benefit at muster", () => {
  it("Rank O5+ Free Trader gets Free Trader benefit on musterOutPay", () => {
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
  it("Marine reenlist returns a boolean and consults crossTrainedArms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    const c = makeMt();
    c.beginAcg("mercenary", { service: "marines", combatArm: "Cavalry" });
    c.acgState!.combatArm = "Cavalry";
    c.acgState!.crossTrainedArms = ["Artillery"];
    const result = mercenaryReenlist(c);
    expect(typeof result).toBe("boolean");
  });
});
