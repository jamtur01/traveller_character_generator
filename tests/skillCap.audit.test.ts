// Skill cap audit against MT PM p. 39 ("Skill Limitations"):
// "No character can (at any time) have more skills (or combined total
// levels of skills) than the sum of Intelligence and Education."
//
// CT TTB does not impose this cap.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition } from "../lib/traveller/editions";

afterEach(() => { vi.restoreAllMocks(); });

describe("MT skill cap (PM p. 39)", () => {
  it("MT declares rules.skillCap; CT does not", () => {
    expect(getEdition("mt-megatraveller").rules.skillCap).toBeDefined();
    expect(getEdition("ct-classic").rules.skillCap).toBeFalsy();
  });

  it("MT skill cap = Int+Edu", () => {
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7,
        intelligence: 8, education: 6, social: 7,
      },
    });
    c.editionId = "mt-megatraveller";
    expect(c.skillCap()).toBe(14);
  });

  it("MT enforceSkillCap reduces excess levels in auto mode", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7,
        intelligence: 5, education: 5, social: 7,
      },
    });
    c.editionId = "mt-megatraveller";
    c.choiceMode = "auto";
    // Add 12 levels of skills (cap is 10). Engine should reduce most-
    // recent skills until total is at most 10.
    c.skills.push(["Computer", 3]);
    c.skills.push(["Admin", 3]);
    c.skills.push(["Liaison", 3]);
    c.skills.push(["Pilot", 3]);
    expect(c.totalSkillLevels()).toBe(12);
    c.enforceSkillCap();
    expect(c.totalSkillLevels()).toBeLessThanOrEqual(10);
  });

  it("CT enforceSkillCap is a no-op (no rule)", () => {
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7,
        intelligence: 5, education: 5, social: 7,
      },
    });
    c.editionId = "ct-classic";
    c.choiceMode = "auto";
    c.skills.push(["Pilot", 5]);
    c.skills.push(["Navigation", 5]);
    c.skills.push(["Computer", 5]);
    expect(c.totalSkillLevels()).toBe(15);
    c.enforceSkillCap();
    // CT doesn't enforce — total stays at 15.
    expect(c.totalSkillLevels()).toBe(15);
  });
});
