// F8 — PM p. 55 line 3504: "The maximum officer rank is commodore (O7)
// in a System Squadron, fleet admiral (O8) in a Reserve Fleet, and grand
// admiral (O10) in the Imperial Navy." Test that the promotion engine
// enforces the cap per fleet.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { navyResolveAssignment } from "../lib/traveller/engine/acg/pathways/navy";
import { getEdition } from "../lib/traveller/editions";

afterEach(() => { vi.restoreAllMocks(); });

function navyOfficerAt(
  fleet: "imperialNavy" | "reserveFleet" | "systemSquadron",
  rankCode: string,
): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: 12, dexterity: 12, endurance: 12,
    intelligence: 12, education: 12, social: 12,
  };
  c.homeworld = {
    starport: "A", size: "Medium", atmosphere: "Standard",
    hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
    tech: "High Stellar",
  };
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  c.beginAcg("navy", { fleet });
  c.acgState!.isOfficer = true;
  c.acgState!.rankCode = rankCode;
  c.acgState!.branch = "Line";
  c.acgState!.fleet = fleet;
  c.acgState!.promotedThisTerm = false;
  return c;
}

/** Force-resolve "Battle" assignments repeatedly. Battle has promotion
 *  target 6+ on the Line Crew table; with Math.random=0.999 every promotion
 *  roll passes (rolls 12, target 6+). Each call also clears
 *  promotedThisTerm so the cap-enforcement code path is the only thing
 *  that can stop promotion. */
function pushPromotions(c: Character, attempts: number): string {
  for (let i = 0; i < attempts; i++) {
    if (!c.activeDuty || c.deceased) break;
    c.acgState!.promotedThisTerm = false;
    navyResolveAssignment(c, "Battle");
  }
  return c.acgState!.rankCode;
}

describe("Navy per-fleet officer rank caps (PM p. 55)", () => {
  it("System Squadron officer at O6 advances to O7 and stops there", () => {
    const c = navyOfficerAt("systemSquadron", "O6");
    const final = pushPromotions(c, 20);
    expect(final).toBe("O7");
  });

  it("System Squadron officer at O7 does not advance to O8", () => {
    const c = navyOfficerAt("systemSquadron", "O7");
    const final = pushPromotions(c, 20);
    expect(final).toBe("O7");
  });

  it("Reserve Fleet officer at O7 advances to O8 and stops there", () => {
    const c = navyOfficerAt("reserveFleet", "O7");
    const final = pushPromotions(c, 20);
    expect(final).toBe("O8");
  });

  it("Reserve Fleet officer at O8 does not advance to O9", () => {
    const c = navyOfficerAt("reserveFleet", "O8");
    const final = pushPromotions(c, 20);
    expect(final).toBe("O8");
  });

  it("Imperial Navy officer at O9 advances to O10", () => {
    const c = navyOfficerAt("imperialNavy", "O9");
    const final = pushPromotions(c, 20);
    expect(final).toBe("O10");
  });

  it("Imperial Navy officer at O10 stays at O10 (top of the ladder)", () => {
    const c = navyOfficerAt("imperialNavy", "O10");
    const final = pushPromotions(c, 20);
    expect(final).toBe("O10");
  });

  it("System Squadron officer at O1 advances exactly to O7 over enough attempts", () => {
    const c = navyOfficerAt("systemSquadron", "O1");
    const final = pushPromotions(c, 30);
    expect(final).toBe("O7");
  });
});

describe("Navy rank-caps JSON citation (PM p. 55)", () => {
  // Locks the JSON values against the PM. If someone edits the JSON away
  // from the printed cap, this fails and forces them to justify against
  // the source.
  it("rankCaps: Imperial Navy 10, Reserve Fleet 8, System Squadron 7", () => {
    const data = getEdition("mt-megatraveller").data;
    const caps = (data.advancedCharacterGeneration as unknown as
      { navy: { rankCaps: Record<string, number> } }).navy.rankCaps;
    expect(caps.imperialNavy).toBe(10);
    expect(caps.reserveFleet).toBe(8);
    expect(caps.systemSquadron).toBe(7);
  });
});
