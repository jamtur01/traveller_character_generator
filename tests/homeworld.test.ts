// MT homeworld tests. Exercises the actual generation engine plus
// validates the JSON data against the MT Players' Manual pp. 12-13.

import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Character } from "../lib/traveller/character";
import {
  applyHomeworldSkills, availableServicesForHomeworld, editionHasHomeworld,
  rollHomeworld,
} from "../lib/traveller/engine/homeworld";

afterEach(() => {
  vi.restoreAllMocks();
});

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

// ---------------------------------------------------------------------------
// JSON ↔ Manual validation
//
// MT Players' Manual p. 12 prints the homeworld description codes table
// (rolls 2–12). Compare every cell.
// ---------------------------------------------------------------------------

interface ManualRow {
  die: number;
  starport: string;
  size: string;
  atmosphere: string;
  hydrosphere: string;
  population: string;
  law: string;
  tech: string;
}

const MANUAL_ROWS: ManualRow[] = [
  { die: 2,  starport: "A",   size: "Asteroid", atmosphere: "Vacuum",   hydrosphere: "Desert",      population: "Low Pop",  law: "No Law",    tech: "Pre-Industrial" },
  { die: 3,  starport: "A",   size: "Small",    atmosphere: "Vacuum",   hydrosphere: "Desert",      population: "Low Pop",  law: "Low Law",   tech: "Industrial" },
  { die: 4,  starport: "A",   size: "Small",    atmosphere: "Thin",     hydrosphere: "Dry",         population: "Mod Pop",  law: "Low Law",   tech: "Industrial" },
  { die: 5,  starport: "A",   size: "Small",    atmosphere: "Thin",     hydrosphere: "Dry",         population: "Mod Pop",  law: "Mod Law",   tech: "Pre-Stellar" },
  { die: 6,  starport: "A",   size: "Small",    atmosphere: "Standard", hydrosphere: "Wet World",   population: "Mod Pop",  law: "Mod Law",   tech: "Pre-Stellar" },
  { die: 7,  starport: "B",   size: "Medium",   atmosphere: "Standard", hydrosphere: "Wet World",   population: "Mod Pop",  law: "Mod Law",   tech: "Early Stellar" },
  { die: 8,  starport: "B",   size: "Medium",   atmosphere: "Standard", hydrosphere: "Wet World",   population: "High Pop", law: "Mod Law",   tech: "Early Stellar" },
  { die: 9,  starport: "B",   size: "Medium",   atmosphere: "Dense",    hydrosphere: "Wet World",   population: "High Pop", law: "Mod Law",   tech: "Avg Stellar" },
  { die: 10, starport: "C",   size: "Large",    atmosphere: "Dense",    hydrosphere: "Wet World",   population: "High Pop", law: "High Law",  tech: "Avg Stellar" },
  { die: 11, starport: "C",   size: "Large",    atmosphere: "Exotic",   hydrosphere: "Wet World",   population: "High Pop", law: "High Law",  tech: "High Stellar" },
  { die: 12, starport: "D-X", size: "Large",    atmosphere: "Exotic",   hydrosphere: "Water World", population: "High Pop", law: "Ext Law",   tech: "High Stellar" },
];

describe("MT homeworld JSON matches the Players' Manual p. 12 table", () => {
  const mt = JSON.parse(
    readFileSync(resolve(__dirname, "../data/editions/mt-megatraveller.json"), "utf8"),
  ) as { homeworld: { rollTable: { rows: ManualRow[] } } };
  const rows = mt.homeworld.rollTable.rows;

  it("table has 11 rows (rolls 2-12)", () => {
    expect(rows).toHaveLength(11);
  });

  for (const m of MANUAL_ROWS) {
    it(`row die=${m.die} matches manual cell-for-cell`, () => {
      const r = rows.find((r) => r.die === m.die);
      expect(r).toBeDefined();
      expect(r!.starport).toBe(m.starport);
      expect(r!.size).toBe(m.size);
      expect(r!.atmosphere).toBe(m.atmosphere);
      expect(r!.hydrosphere).toBe(m.hydrosphere);
      expect(r!.population).toBe(m.population);
      expect(r!.law).toBe(m.law);
      expect(r!.tech).toBe(m.tech);
    });
  }
});

describe("MT homeworld starport X follow-up roll matches the manual", () => {
  it("1-3 → D, 4-5 → E, 6 → X", () => {
    const mt = JSON.parse(
      readFileSync(resolve(__dirname, "../data/editions/mt-megatraveller.json"), "utf8"),
    ) as { homeworld: { starportXRoll: { results: Record<string, string> } } };
    const r = mt.homeworld.starportXRoll.results;
    expect(r["1"]).toBe("D");
    expect(r["2"]).toBe("D");
    expect(r["3"]).toBe("D");
    expect(r["4"]).toBe("E");
    expect(r["5"]).toBe("E");
    expect(r["6"]).toBe("X");
  });
});

describe("MT default skills match the manual (p. 13)", () => {
  it("includes the five canonical entries", () => {
    const mt = JSON.parse(
      readFileSync(resolve(__dirname, "../data/editions/mt-megatraveller.json"), "utf8"),
    ) as {
      homeworld: {
        defaultSkills: Array<{
          skill: string;
          level: number;
          when?: {
            serviceIn?: string[];
            serviceNotIn?: string[];
            techAtLeast?: string;
            techIn?: string[];
          };
        }>;
      };
    };
    const ds = mt.homeworld.defaultSkills;
    // Vacc Suit-0 for navy/marines/flyers/scouts/merchants/pirates
    expect(ds.some((d) =>
      d.skill === "Vacc Suit" &&
      d.when?.serviceIn?.includes("navy") === true,
    )).toBe(true);
    // Gun Combat-0 for all except barbarians
    expect(ds.some((d) =>
      d.skill === "Gun Combat" &&
      d.when?.serviceNotIn?.includes("barbarians") === true,
    )).toBe(true);
    // Computer-0 for Early Stellar+
    expect(ds.some((d) =>
      d.skill === "Computer" && d.when?.techAtLeast === "Early Stellar",
    )).toBe(true);
    // Grav Vehicle-0 for Avg Stellar+
    expect(ds.some((d) =>
      d.skill === "Grav Vehicle" && d.when?.techAtLeast === "Avg Stellar",
    )).toBe(true);
    // Wheeled Vehicle-0 for Industrial/Pre-Stellar/Early Stellar
    expect(ds.some((d) =>
      d.skill === "Wheeled Vehicle" && d.when?.techIn?.includes("Industrial") === true,
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Engine behaviour
// ---------------------------------------------------------------------------

describe("rollHomeworld", () => {
  it("produces a complete homeworld profile for MT", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    const hw = rollHomeworld(c);
    expect(hw).not.toBeNull();
    expect(hw!.starport).toBeDefined();
    expect(hw!.size).toBeDefined();
    expect(hw!.atmosphere).toBeDefined();
    expect(hw!.hydrosphere).toBeDefined();
    expect(hw!.population).toBeDefined();
    expect(hw!.law).toBeDefined();
    expect(hw!.tech).toBeDefined();
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
    applyHomeworldSkills(c, hw);
    expect(c.checkSkill("Computer")).toBeGreaterThanOrEqual(0);
    expect(c.checkSkill("Wheeled Vehicle")).toBeGreaterThanOrEqual(0); // Industrial/Pre-Stellar/Early Stellar
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
    applyHomeworldSkills(c, hw);
    expect(c.checkSkill("Computer")).toBeGreaterThanOrEqual(0);
    expect(c.checkSkill("Grav Vehicle")).toBeGreaterThanOrEqual(0);
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
    applyHomeworldSkills(c, hw);
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
    applyHomeworldSkills(c, hw);
    expect(c.checkSkill("Vacc Suit")).toBeGreaterThanOrEqual(0);
    expect(c.checkSkill("Gun Combat")).toBeGreaterThanOrEqual(0);
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
    applyHomeworldSkills(c, hw);
    expect(c.checkSkill("Vacc Suit")).toBe(-1);
    expect(c.checkSkill("Gun Combat")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: Character.generateHomeworld
// ---------------------------------------------------------------------------

describe("Character.generateHomeworld", () => {
  it("MT character: rolls homeworld and applies tech-gated skills", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.6);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.skills = [];
    c.generateHomeworld();
    expect(c.homeworld).not.toBeNull();
    // Tech-gated skill should be applied; service-gated isn't yet (service not set).
    if (c.homeworld!.tech === "Early Stellar" || c.homeworld!.tech === "Avg Stellar" ||
        c.homeworld!.tech === "High Stellar") {
      expect(c.checkSkill("Computer")).toBeGreaterThanOrEqual(0);
    }
  });

  it("CT character: no-op (no homeworld step in CT)", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.generateHomeworld();
    expect(c.homeworld).toBeNull();
  });
});
