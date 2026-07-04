// Scout pathway audit against PM pp. 56-59.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import { getEdition } from "../lib/traveller/editions";

afterEach(() => { vi.restoreAllMocks(); });

describe("Scout PM audit — enlistment (PM p. 58)", () => {
  it("Imperial Scouts 7+, DM+1 Int 6+, DM+2 Str 8+", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    expect(scout?.enlistment.target).toBe(7);
    const intDm = scout?.enlistment.dms.find((d) => d.attribute === "intelligence");
    const strDm = scout?.enlistment.dms.find((d) => d.attribute === "strength");
    expect(intDm?.min).toBe(6);
    expect(intDm?.dm).toBe(1);
    expect(strDm?.min).toBe(8);
    expect(strDm?.dm).toBe(2);
  });

  it("Starts at IS-1; college honors graduate at IS-10", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    expect(scout?.enlistment.startingRank).toBe("IS-1");
    // PM p. 58: "College honors graduates automatically receive rank IS-10."
    expect(scout?.enlistment.collegeHonorsStartingRank).toBe("IS-10");
  });

  it("Scout ordinary ranks IS-1 to IS-9 (enlisted-equivalent)", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    const ordinary = (scout?.ranks?.ordinary ?? []) as [string, string][];
    expect(ordinary.length).toBe(9);
    expect(ordinary[0]?.[0]).toBe("IS-1");
    expect(ordinary[8]?.[0]).toBe("IS-9");
  });

  it("Scout administrator ranks IS-10 to IS-18 (officer-equivalent)", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    const admin = (scout?.ranks?.administrator ?? []) as [string, string, number][];
    expect(admin.length).toBe(9);
    expect(admin[0]?.[0]).toBe("IS-10");
    expect(admin[8]?.[0]).toBe("IS-18");
  });

  it("PM p. 56: college graduates and med-school commissions enter the Bureaucracy; others the Field", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    expect(scout?.divisionPlacement).toMatchObject({
      collegeGraduate: "bureaucracy",
      medSchoolCommission: "bureaucracy",
      default: "field",
    });
  });
});

describe("Scout PM audit — reenlistment (PM p. 59)", () => {
  it("Scouts reenlist 3+", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    expect(scout?.reenlistment.target).toBe(3);
  });

  it("Up-or-out for ordinary rank declared", () => {
    const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
    // PM p. 59 "If a character's ordinary rank is not equal to or
    // greater than his or her number of terms of service, then he or
    // she will not be permitted to reenlist."
    const reenl = scout?.reenlistment as { $rule?: string } | undefined;
    expect(reenl?.$rule).toBeDefined();
  });
});

describe("Scout PM audit — Bureaucracy vs Field auto-rank (PM p. 59)", () => {
  it("Bureaucracy scout receives ordinary rank equal to terms served", () => {
    // PM: "the Scout character immediately receives ordinary rank equal
    // to the number of terms served (a Scout in the fourth term of
    // service becomes rank IS-4)."
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character({
      attributes: {
        strength: 10, dexterity: 10, endurance: 10,
        intelligence: 10, education: 10, social: 10,
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.acgPathway = "scout";
    c.acgState = freshAcgState("scout");
    c.requireScoutAcg().division = "bureaucracy";
    c.service = "scouts";
    let snap = session.enlist(
      { character: c, phase: "acg_enlist" },
      {
        verbose: false, preferredService: "random",
        acgService: "army", acgCombatArm: "Infantry",
        acgFleet: "imperialNavy", acgDivision: "bureaucracy",
        acgLineType: "Free Trader", acgSubsectorTech: "",
        acgMerchantAcademy: false,
      },
    );
    snap = session.runTerm(snap);
    snap = session.runTerm(snap);
    // After two terms in Bureaucracy, ordinary rank should be ≥ 2.
    const rank = snap.character.acgState?.rankCode;
    expect(rank).toMatch(/^IS-/);
    const n = parseInt(rank!.replace("IS-", ""), 10);
    expect(n).toBeGreaterThanOrEqual(snap.character.terms);
  });
});
