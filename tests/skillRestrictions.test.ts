import { describe, expect, it, vi, beforeEach } from "vitest";
import { Character } from "../lib/traveller/character";
import type { Homeworld } from "../lib/traveller/engine/homeworld";
import {
  skillRequiresOverride,
  rollSkillOverride,
  acquireSkillWithRestrictionCheck,
} from "../lib/traveller/engine/skillRestrictions";
import * as random from "../lib/traveller/random";

function makeMtChar(overrides: Partial<Character> = {}): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 7, dexterity: 7, endurance: 7,
    intelligence: 7, education: 7, social: 7,
  };
  c.homeworld = {
    starport: "B",
    size: "Medium",
    atmosphere: "Standard",
    hydrosphere: "Wet World",
    population: "Mod Pop",
    law: "Low Law",
    tech: "Industrial",
  } as Homeworld;
  c.service = "army";
  Object.assign(c, overrides);
  return c;
}

describe("homeworld skill restrictions (B7)", () => {
  it("flags Grav Vehicle as restricted for an Industrial homeworld", () => {
    const c = makeMtChar();
    expect(skillRequiresOverride(c, "Grav Vehicle")).toBe(7);
  });

  it("flags Grav Belt as restricted for an Industrial homeworld", () => {
    const c = makeMtChar();
    expect(skillRequiresOverride(c, "Grav Belt")).toBe(7);
  });

  it("does not restrict Wheeled Vehicle on an Industrial homeworld", () => {
    const c = makeMtChar();
    expect(skillRequiresOverride(c, "Wheeled Vehicle")).toBeNull();
  });

  it("does not restrict skills the homeworld already exceeds in tech", () => {
    const c = makeMtChar({
      homeworld: {
        starport: "A", size: "Medium", atmosphere: "Standard",
        hydrosphere: "Wet World", population: "Mod Pop", law: "Low Law",
        tech: "High Stellar",
      } as Homeworld,
    });
    expect(skillRequiresOverride(c, "Grav Vehicle")).toBeNull();
  });

  it("exempts Nobles from homeworld restrictions", () => {
    const c = makeMtChar({ service: "nobles" });
    expect(skillRequiresOverride(c, "Grav Belt")).toBeNull();
  });

  it("does not restrict skills outside the vehicle/weapon table", () => {
    const c = makeMtChar();
    expect(skillRequiresOverride(c, "Computer")).toBeNull();
    expect(skillRequiresOverride(c, "Tactics")).toBeNull();
  });

  it("rollSkillOverride returns true on 7+, false below 7", () => {
    const c = makeMtChar();
    const spy = vi.spyOn(random, "roll").mockReturnValueOnce(7);
    expect(rollSkillOverride(c, "Grav Vehicle", 7)).toBe(true);
    spy.mockReturnValueOnce(6);
    expect(rollSkillOverride(c, "Grav Vehicle", 7)).toBe(false);
    spy.mockRestore();
  });

  it("acquireSkillWithRestrictionCheck forfeits on override failure", () => {
    const c = makeMtChar();
    const spy = vi.spyOn(random, "roll").mockReturnValueOnce(5);
    expect(acquireSkillWithRestrictionCheck(c, "Grav Vehicle")).toBe(false);
    spy.mockRestore();
  });

  it("acquireSkillWithRestrictionCheck passes through unrestricted skills", () => {
    const c = makeMtChar();
    expect(acquireSkillWithRestrictionCheck(c, "Tactics")).toBe(true);
  });

  it("CT character (no homeworld block) is unaffected", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    expect(skillRequiresOverride(c, "Grav Vehicle")).toBeNull();
  });

  describe("weapon law-code restrictions (PM p. 39)", () => {
    it("Body Pistol restricted when homeworld law > No Law", () => {
      const c = makeMtChar({
        homeworld: {
          starport: "A", size: "Medium", atmosphere: "Standard",
          hydrosphere: "Wet World", population: "Mod Pop", law: "Low Law",
          tech: "High Stellar",
        } as Homeworld,
      });
      expect(skillRequiresOverride(c, "Body Pistol")).toBe(7);
    });

    it("Body Pistol unrestricted on a No Law homeworld", () => {
      const c = makeMtChar({
        homeworld: {
          starport: "A", size: "Medium", atmosphere: "Standard",
          hydrosphere: "Wet World", population: "Low Pop", law: "No Law",
          tech: "High Stellar",
        } as Homeworld,
      });
      expect(skillRequiresOverride(c, "Body Pistol")).toBeNull();
    });

    it("Handgun restricted when homeworld law > Low Law", () => {
      const c = makeMtChar({
        homeworld: {
          starport: "A", size: "Medium", atmosphere: "Standard",
          hydrosphere: "Wet World", population: "Mod Pop", law: "Mod Law",
          tech: "High Stellar",
        } as Homeworld,
      });
      expect(skillRequiresOverride(c, "Handgun")).toBe(7);
    });

    it("Rogues see one law code lower for weapon skills", () => {
      const c = makeMtChar({
        service: "rogues",
        homeworld: {
          starport: "A", size: "Medium", atmosphere: "Standard",
          hydrosphere: "Wet World", population: "Mod Pop", law: "Mod Law",
          tech: "High Stellar",
        } as Homeworld,
      });
      // Handgun maxLaw=Low Law; homeworld Mod Law → normally restricted, but
      // Rogue sees effective Low Law → unrestricted.
      expect(skillRequiresOverride(c, "Handgun")).toBeNull();
    });

    it("Law Enforcers see one law code lower for weapon skills", () => {
      const c = makeMtChar({
        service: "lawenforcers",
        homeworld: {
          starport: "A", size: "Medium", atmosphere: "Standard",
          hydrosphere: "Wet World", population: "Mod Pop", law: "Mod Law",
          tech: "High Stellar",
        } as Homeworld,
      });
      expect(skillRequiresOverride(c, "Handgun")).toBeNull();
    });

    it("the one-step-lower exception does not apply to non-weapon vehicle skills", () => {
      const c = makeMtChar({ service: "rogues" });
      // Industrial homeworld; Grav Vehicle requires Avg Stellar — still restricted.
      expect(skillRequiresOverride(c, "Grav Vehicle")).toBe(7);
    });
  });
});

describe("Int+Edu skill cap (B7)", () => {
  let c: Character;
  beforeEach(() => {
    c = makeMtChar();
    c.attributes.intelligence = 5;
    c.attributes.education = 5; // cap = 10
    c.choiceMode = "auto";
  });

  it("totalSkillLevels sums all skill levels", () => {
    c.skills = [["Pilot", 2], ["Vacc Suit", 1], ["Computer", 3]];
    expect(c.totalSkillLevels()).toBe(6);
  });

  it("skillCap returns Int+Edu", () => {
    expect(c.skillCap()).toBe(10);
  });

  it("enforceSkillCap is a no-op when under cap", () => {
    c.skills = [["Pilot", 3]];
    c.enforceSkillCap();
    expect(c.totalSkillLevels()).toBe(3);
    expect(c.skills).toHaveLength(1);
  });

  it("enforceSkillCap reduces the most-recently-acquired skill in auto mode", () => {
    c.skills = [["Pilot", 5], ["Vacc Suit", 3], ["Computer", 4]]; // total 12 > 10
    c.enforceSkillCap();
    expect(c.totalSkillLevels()).toBe(10);
    expect(c.skills[0]).toEqual(["Pilot", 5]);
    expect(c.skills[1]).toEqual(["Vacc Suit", 3]);
    expect(c.skills[2]?.[1]).toBe(2);
  });

  it("enforceSkillCap forfeits a level-1 skill rather than dropping to 0", () => {
    c.skills = [["Pilot", 5], ["Vacc Suit", 5], ["Computer", 1]]; // total 11
    c.enforceSkillCap();
    expect(c.totalSkillLevels()).toBe(10);
    expect(c.skills.find(([n]) => n === "Computer")).toBeUndefined();
  });

  it("enforceSkillCap is a no-op for editions without a skillCap block", () => {
    const ct = new Character();
    ct.editionId = "ct-classic";
    ct.attributes.intelligence = 5;
    ct.attributes.education = 5;
    ct.skills = [["Pilot", 99]]; // way over cap, but CT has no cap rule
    ct.choiceMode = "auto";
    ct.enforceSkillCap();
    expect(ct.skills[0]?.[1]).toBe(99);
  });
});
