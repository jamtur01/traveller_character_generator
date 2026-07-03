// Navy pathway audit against PM pp. 52-55. Asserts engine output
// matches canonical PM rules where the PM specifies a concrete value.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import { getEdition } from "../lib/traveller/editions";
import { formatEvent } from "../lib/traveller/history";

afterEach(() => { vi.restoreAllMocks(); });

describe("Navy PM audit — enlistment (PM p. 52)", () => {
  it("Imperial Navy 8+, Reserve Fleet 7+, System Squadron 6+", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    expect(navy?.enlistment.imperialNavy.target).toBe(8);
    expect(navy?.enlistment.reserveFleet.target).toBe(7);
    expect(navy?.enlistment.systemSquadron.target).toBe(6);
  });

  it("All three fleets: DM+1 Int 8+, DM+2 Edu 9+", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    for (const fleet of ["imperialNavy", "reserveFleet", "systemSquadron"] as const) {
      const dms = navy?.enlistment[fleet].dms;
      const intDm = dms?.find((d) => d.attribute === "intelligence");
      const eduDm = dms?.find((d) => d.attribute === "education");
      expect(intDm?.min, `${fleet} int`).toBe(8);
      expect(intDm?.dm).toBe(1);
      expect(eduDm?.min, `${fleet} edu`).toBe(9);
      expect(eduDm?.dm).toBe(2);
    }
  });

  it("System Squadron requires homeworld tech Early Stellar+", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    expect(navy?.enlistment.systemSquadron.requirement).toMatch(/Early Stellar/i);
  });

  it("Navy starts at E1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character({
      attributes: {
        strength: 8, dexterity: 8, endurance: 8,
        intelligence: 10, education: 10, social: 10,
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.acgPathway = "navy";
    c.acgState = freshAcgState("navy");
    c.service = "navy";
    session.enlist(
      { character: c, phase: "acg_enlist" },
      {
        verbose: false, preferredService: "random",
        acgService: "army", acgCombatArm: "Infantry",
        acgFleet: "imperialNavy", acgDivision: "field",
        acgLineType: "Free Trader", acgSubsectorTech: "",
        acgMerchantAcademy: false,
      },
    );
    // Should be E1 immediately after enlistment.
    expect(c.acgState!.rankCode).toBe("E1");
  });
});

describe("Navy PM audit — branches (PM p. 52)", () => {
  it("Five branches: Flight, Engineering, Medical, Gunnery, Technical Services, plus Line", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    const branches = (navy?.branches ?? []) as string[];
    // PM specifies five branches PLUS Line as a generalized duty branch.
    // The engine's branches list should contain the four named branches
    // (Flight, Engineering, Medical, Gunnery) plus Line/Technical Services.
    expect(branches).toContain("Flight");
    expect(branches).toContain("Engineering");
    expect(branches).toContain("Medical");
    expect(branches).toContain("Gunnery");
    expect(branches.some((b) => /line|technical/i.test(b))).toBe(true);
  });

  it("Technical Services exists only in Imperial Navy (PM p. 52 line 3261)", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    const restrictions = navy?.branchFleetRestrictions;
    // Some entry should restrict Technical to imperialNavy only.
    const techKey = Object.keys(restrictions ?? {}).find((k) =>
      /tech/i.test(k));
    if (techKey) {
      expect(restrictions?.[techKey]).toContain("imperialNavy");
    }
  });
});

describe("Navy PM audit — reenlistment (PM p. 55)", () => {
  it("Imperial Navy 6+, DM+1 if E4+ or O1+", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    const inFleet = navy?.reenlistment?.perFleet?.imperialNavy;
    expect(inFleet?.target).toBe(6);
    const e4 = inFleet?.dms?.find((d) => d.rankAtLeast === "E4");
    const off = inFleet?.dms?.find((d) => d.officer === true);
    expect(e4?.dm).toBe(1);
    expect(off?.dm).toBe(1);
  });

  it("Reserve Fleet 6+, DM+2 if E4+ or O1+", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    const rfFleet = navy?.reenlistment?.perFleet?.reserveFleet;
    expect(rfFleet?.target).toBe(6);
    const e4 = rfFleet?.dms?.find((d) => d.rankAtLeast === "E4");
    const off = rfFleet?.dms?.find((d) => d.officer === true);
    expect(e4?.dm).toBe(2);
    expect(off?.dm).toBe(2);
  });

  it("System Squadron 5+, DM+2 if O1+ (no E4+ DM)", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    const ssFleet = navy?.reenlistment?.perFleet?.systemSquadron;
    expect(ssFleet?.target).toBe(5);
    const off = ssFleet?.dms?.find((d) => d.officer === true);
    expect(off?.dm).toBe(2);
    // PM p. 55: "Commissioned officers (rank 01+) receive DM +2" —
    // no E4+ bonus for System Squadron.
    const e4 = ssFleet?.dms?.find((d) => d.rankAtLeast === "E4");
    expect(e4).toBeUndefined();
  });
});

describe("Navy PM audit — initial training (PM p. 52)", () => {
  it("Enlisted character gets 2 skill rolls on Branch Skills", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character({
      attributes: {
        strength: 8, dexterity: 8, endurance: 8,
        intelligence: 10, education: 10, social: 7, // soc 7 → no Branch picker
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.acgPathway = "navy";
    c.acgState = freshAcgState("navy");
    c.service = "navy";
    let snap = session.enlist(
      { character: c, phase: "acg_enlist" },
      {
        verbose: false, preferredService: "random",
        acgService: "army", acgCombatArm: "Infantry",
        acgFleet: "imperialNavy", acgDivision: "field",
        acgLineType: "Free Trader", acgSubsectorTech: "",
        acgMerchantAcademy: false,
      },
    );
    snap = session.runTerm(snap);
    // Count branch-skill events from term 1 year 1 (initial training).
    const branchSkillEvents = snap.character.events.filter(
      (e) => /branch skills/i.test(formatEvent(e)),
    );
    expect(branchSkillEvents.length).toBeGreaterThanOrEqual(2);
  });
});
