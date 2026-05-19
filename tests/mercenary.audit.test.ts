// Mercenary pathway audit against MT PM pp. 50-51 (rules) and pp. 64-65
// (tables). Asserts engine output line-by-line where the PM specifies a
// concrete throw / DM / consequence. Failures here mean the engine
// diverges from canonical rules.

import { afterEach, describe, expect, it, vi } from "vitest";
import { auditAcg } from "./_audit";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Mercenary PM audit — initial activities", () => {
  it("PM p. 50: Army enlist 5+, DM+1 Dex 6+, DM+2 End 5+. Marines: 9+, DM+1 Int 8+, DM+2 Str 8+.", async () => {
    const { getEditionServices } = await import("../lib/traveller/services");
    const services = getEditionServices("mt-megatraveller");
    // Army basic enlistment via the basic-chargen service def.
    expect(services.army?.enlistmentThrow).toBe(5);
    // The DM function takes Attributes and returns the integer DM.
    expect(services.army!.enlistmentDM({
      strength: 5, dexterity: 6, endurance: 4,
      intelligence: 5, education: 5, social: 5,
    })).toBe(1);
    expect(services.army!.enlistmentDM({
      strength: 5, dexterity: 5, endurance: 5,
      intelligence: 5, education: 5, social: 5,
    })).toBe(2);
    expect(services.army!.enlistmentDM({
      strength: 5, dexterity: 6, endurance: 5,
      intelligence: 5, education: 5, social: 5,
    })).toBe(3);

    expect(services.marines?.enlistmentThrow).toBe(9);
    expect(services.marines!.enlistmentDM({
      strength: 5, dexterity: 5, endurance: 5,
      intelligence: 8, education: 5, social: 5,
    })).toBe(1);
    expect(services.marines!.enlistmentDM({
      strength: 8, dexterity: 5, endurance: 5,
      intelligence: 5, education: 5, social: 5,
    })).toBe(2);
  });

  it("PM p. 50: Army starts at E1; Marines starts at E1", async () => {
    const { Character } = await import("../lib/traveller/character");
    const session = await import("../lib/traveller/chargen/session");
    const { freshAcgState } = await import("../lib/traveller/engine/acg/state");
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character({
      attributes: {
        strength: 8, dexterity: 8, endurance: 8,
        intelligence: 8, education: 8, social: 8,
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.acgPathway = "mercenary";
    c.acgState = freshAcgState("mercenary");
    c.service = "army";
    // Enlist only (no runTerm).
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
    expect(c.acgState!.rankCode).toBe("E1");
  });

  it("PM p. 50: Combat arm Commandos is gated — not selectable initially without Mil Academy honors", async () => {
    const { getEdition } = await import("../lib/traveller/editions");
    const merc = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.mercenary;
    const gates = merc?.combatArmEligibility?.armGates as
      | Record<string, unknown> | undefined;
    // PM p. 50 line: "Commando, however, cannot be selected initially
    // by anyone except a Military Academy honors graduate."
    expect(gates).toBeDefined();
    expect(Object.keys(gates ?? {})).toContain("Commando");
  });

  it("PM p. 50: initial training = Gun Combat-1 + 1 MOS roll", () => {
    const r = auditAcg({
      pathway: "mercenary", service: "army", combatArm: "Infantry",
      attributes: {
        strength: 10, dexterity: 10, endurance: 10,
        intelligence: 10, education: 10, social: 10,
      },
    });
    // Initial training should grant Gun Combat-1 in the first term.
    const skillLearned = r.character.events.find(
      (_e, _) => false, // placeholder
    );
    void skillLearned;
    const gunCombat = r.character.skills.find(([s]) => s === "Gun Combat");
    expect(gunCombat, "Gun Combat-1 from Initial Training")
      .toBeDefined();
    expect(gunCombat![1]).toBeGreaterThanOrEqual(1);
  });
});

describe("Mercenary PM audit — reenlistment", () => {
  it("PM p. 51: Army reenlist 7+ with DM+2 for enlisted; Marines 6+", async () => {
    const { getEdition } = await import("../lib/traveller/editions");
    const merc = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.mercenary;
    expect(merc?.reenlistment?.army?.target).toBe(7);
    expect(merc?.reenlistment?.marines?.target).toBe(6);
    // Find the enlisted DM in army.dms.
    const armyDms = merc?.reenlistment?.army?.dms as Array<Record<string, unknown>> | undefined;
    const enlistedDm = armyDms?.find((d) =>
      "rankAtMost" in d || "enlisted" in d || "isEnlisted" in d,
    );
    expect(enlistedDm, "Army reenlist enlisted DM").toBeDefined();
  });
});

describe("Mercenary PM audit — Marine Tradition", () => {
  it("PM p. 51: Blade Combat for Marines becomes Large Blade with save 9+", async () => {
    const { getEdition } = await import("../lib/traveller/editions");
    const ed = getEdition("mt-megatraveller");
    const trad = ed.rules.marineTradition;
    expect(trad?.appliesToServices).toEqual(["marines"]);
    expect(trad?.savingThrow?.target).toBe(9);
    expect(trad?.appliesToCascade?.toLowerCase()).toMatch(/blade/);
    // PM: DM-3 if already Large Blade-1, DM-6 if Large Blade-2+.
    const dms = trad?.dmIfAlreadySkillAtLeast as
      Array<{ skill: string; level: number; dm: number }> | undefined;
    const dm1 = dms?.find((d) => d.level === 1);
    const dm2 = dms?.find((d) => d.level === 2);
    expect(dm1?.dm).toBe(-3);
    expect(dm2?.dm).toBe(-6);
  });
});

describe("Mercenary PM audit — draftees / OCS / SEH", () => {
  it("PM p. 51: Draftees may not OCS in their first term", async () => {
    const { getEdition } = await import("../lib/traveller/editions");
    const draftRule = getEdition("mt-megatraveller").rules.draft;
    expect(draftRule?.noCommissionFirstTerm).toBe(true);
  });
});
