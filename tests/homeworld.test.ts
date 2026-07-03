// MT homeworld engine-behaviour tests. JSON↔PM citation locks for the
// rollTable / starportXRoll / defaultSkills blocks live in
// tests/audit/mt.json.audit.test.ts.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  applyHomeworldSkills, availableServicesForHomeworld, editionHasHomeworld,
  rollHomeworld,
} from "../lib/traveller/engine/homeworld";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Exact level of a skill (not the array index returned by checkSkill).
 *  Returns -1 if the skill is absent. */
function skillLevel(c: Character, skill: string): number {
  return c.skills.find(([n]) => n === skill)?.[1] ?? -1;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

describe("editionHasHomeworld", () => {
  it("returns true for MT", () => {
    expect(editionHasHomeworld("mt-megatraveller")).toBe(true);
  });
  it("returns false for CT", () => {
    expect(editionHasHomeworld("ct-classic")).toBe(false);
  });
});

// JSON↔PM cell-for-cell audit for the rollTable, starportXRoll, and
// defaultSkills blocks lives in tests/audit/mt.json.audit.test.ts.
// This file covers engine behaviour against those JSON declarations.

// ---------------------------------------------------------------------------
// Engine behaviour
// ---------------------------------------------------------------------------

describe("rollHomeworld", () => {
  it("Math.random=0.5 produces a deterministic mid-roll profile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    const hw = rollHomeworld(c)!;
    expect(hw).toEqual({
      starport: "B",
      size: "Medium",
      atmosphere: "Standard",
      hydrosphere: "Wet World",
      population: "High Pop",
      law: "Mod Law",
      tech: "High Stellar",
    });
  });

  it("returns null for CT (no homeworld step)", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    expect(rollHomeworld(c)).toBeNull();
  });

  it("low-roll (Math.random=0) generates a Pre-Industrial Asteroid world", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    const hw = rollHomeworld(c)!;
    // All rolls forced to 2: starport=A, size=Asteroid. After Asteroid is
    // chosen, atmosphere DM applies (size=Asteroid → -9), so roll 2 - 9
    // is clamped to 2 → Vacuum. Tech rolls also get +1 (Asteroid) +3
    // (Starport A) → minimum-roll 2 + 4 = 6 → still Pre-Stellar with row 6.
    expect(hw.starport).toBe("A");
    expect(hw.size).toBe("Asteroid");
    expect(hw.atmosphere).toBe("Vacuum");
  });
});

describe("availableServicesForHomeworld", () => {
  it("Pre-Industrial homeworld only allows Barbarians + low-tech careers", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.attributes.social = 5;
    const hw = {
      starport: "X" as const, size: "Small" as const, atmosphere: "Vacuum" as const,
      hydrosphere: "Desert" as const, population: "Low Pop" as const,
      law: "No Law" as const, tech: "Pre-Industrial" as const,
    };
    const all = ["navy", "marines", "army", "scouts", "merchants", "barbarians",
      "doctors", "diplomats"] as const;
    const out = availableServicesForHomeworld(c, hw, [...all]);
    expect(out).toContain("barbarians");
    expect(out).not.toContain("navy");
    expect(out).not.toContain("army");
    expect(out).not.toContain("marines");
    expect(out).not.toContain("scouts");
    expect(out).not.toContain("merchants");
    expect(out).not.toContain("doctors");
    expect(out).not.toContain("diplomats");
  });

  it("High Stellar homeworld allows all services except Barbarians (and Nobles need Soc 10+)", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.attributes.social = 12;
    const hw = {
      starport: "A" as const, size: "Large" as const, atmosphere: "Dense" as const,
      hydrosphere: "Wet World" as const, population: "High Pop" as const,
      law: "High Law" as const, tech: "High Stellar" as const,
    };
    const all = ["navy", "marines", "army", "scouts", "merchants", "barbarians",
      "nobles", "doctors"] as const;
    const out = availableServicesForHomeworld(c, hw, [...all]);
    expect(out).toContain("navy");
    expect(out).toContain("merchants");
    expect(out).toContain("nobles"); // Soc 12 ≥ 10
    expect(out).not.toContain("barbarians");
  });

  it("Soc <10 forbids Nobles regardless of tech", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.attributes.social = 8;
    const hw = {
      starport: "A" as const, size: "Large" as const, atmosphere: "Dense" as const,
      hydrosphere: "Wet World" as const, population: "High Pop" as const,
      law: "High Law" as const, tech: "High Stellar" as const,
    };
    const out = availableServicesForHomeworld(c, hw, ["navy", "nobles"]);
    expect(out).not.toContain("nobles");
    expect(out).toContain("navy");
  });
});

describe("applyHomeworldSkills", () => {
  it("Early Stellar grants Computer-0", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    const hw = {
      starport: "B" as const, size: "Medium" as const, atmosphere: "Standard" as const,
      hydrosphere: "Wet World" as const, population: "Mod Pop" as const,
      law: "Mod Law" as const, tech: "Early Stellar" as const,
    };
    c.homeworld = hw;
    applyHomeworldSkills(c);
    expect(skillLevel(c, "Computer")).toBe(0);
    expect(skillLevel(c, "Wheeled Vehicle")).toBe(0); // Industrial/Pre-Stellar/Early Stellar
    expect(c.checkSkill("Grav Vehicle")).toBe(-1); // requires Avg Stellar+
  });

  it("Avg Stellar grants Computer AND Grav Vehicle", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    const hw = {
      starport: "C" as const, size: "Large" as const, atmosphere: "Dense" as const,
      hydrosphere: "Wet World" as const, population: "High Pop" as const,
      law: "High Law" as const, tech: "Avg Stellar" as const,
    };
    c.homeworld = hw;
    applyHomeworldSkills(c);
    expect(skillLevel(c, "Computer")).toBe(0);
    expect(skillLevel(c, "Grav Vehicle")).toBe(0);
  });

  it("Pre-Industrial grants no tech-gated skills", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    c.service = "barbarians";
    const hw = {
      starport: "X" as const, size: "Asteroid" as const, atmosphere: "Vacuum" as const,
      hydrosphere: "Desert" as const, population: "Low Pop" as const,
      law: "No Law" as const, tech: "Pre-Industrial" as const,
    };
    c.homeworld = hw;
    applyHomeworldSkills(c);
    expect(c.checkSkill("Computer")).toBe(-1);
    expect(c.checkSkill("Grav Vehicle")).toBe(-1);
    expect(c.checkSkill("Wheeled Vehicle")).toBe(-1);
    // Barbarians don't get Gun Combat-0 either.
    expect(c.checkSkill("Gun Combat")).toBe(-1);
  });

  it("Navy service grants Vacc Suit-0", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    c.service = "navy";
    const hw = {
      starport: "A" as const, size: "Medium" as const, atmosphere: "Standard" as const,
      hydrosphere: "Wet World" as const, population: "Mod Pop" as const,
      law: "Mod Law" as const, tech: "Early Stellar" as const,
    };
    c.homeworld = hw;
    applyHomeworldSkills(c);
    expect(skillLevel(c, "Vacc Suit")).toBe(0);
    expect(skillLevel(c, "Gun Combat")).toBe(0);
  });

  it("Barbarian gets neither Vacc Suit nor Gun Combat", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    c.service = "barbarians";
    const hw = {
      starport: "X" as const, size: "Small" as const, atmosphere: "Standard" as const,
      hydrosphere: "Wet World" as const, population: "Mod Pop" as const,
      law: "Low Law" as const, tech: "Pre-Industrial" as const,
    };
    c.homeworld = hw;
    applyHomeworldSkills(c);
    expect(c.checkSkill("Vacc Suit")).toBe(-1);
    expect(c.checkSkill("Gun Combat")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: Character.generateHomeworld
// ---------------------------------------------------------------------------

describe("Character.generateHomeworld", () => {
  it("MT character: max rolls land on row 12 (Exotic / High Stellar) and apply Computer-0", () => {
    // Math.random=0.999 → every d6=6 → 2d6=12 → homeworld row die=12.
    // Row 12 per PM p. 12: Starport D-X / Large / Exotic / Water World /
    // High Pop / Ext Law / High Stellar. High Stellar gates Computer-0
    // and Grav Vehicle-0 (Avg Stellar+ in defaultSkills).
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    c.generateHomeworld();
    expect(c.homeworld).toEqual({
      starport: "X",
      size: "Large",
      atmosphere: "Exotic",
      hydrosphere: "Water World",
      population: "High Pop",
      law: "Ext Law",
      tech: "High Stellar",
    });
    expect(skillLevel(c, "Computer")).toBe(0);
    expect(skillLevel(c, "Grav Vehicle")).toBe(0);
  });

  it("CT character: no-op (no homeworld step in CT)", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.generateHomeworld();
    expect(c.homeworld).toBeNull();
  });
});
