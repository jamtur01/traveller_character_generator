import { describe, it, expect } from "vitest";
import { parseCanonData } from "@/lib/traveller/editions/schema";
import mongooseJson from "@/data/editions/mongoose-2e.json";

describe("mongoose-2e core data", () => {
  const data = parseCanonData(mongooseJson, "mongoose-2e");

  it("passes canon-data schema validation", () => {
    expect(() => parseCanonData(mongooseJson, "mongoose-2e")).not.toThrow();
    expect(data.mongoose).toBeDefined();
  });

  it("declares the Characteristic Modifiers table (Core p.9)", () => {
    const bands = data.mongoose!.characteristicDmBands;
    expect(bands).toContainEqual({ min: 0, max: 0, dm: -3 });
    expect(bands).toContainEqual({ min: 6, max: 8, dm: 0 });
    expect(bands).toContainEqual({ min: 9, max: 11, dm: 1 });
    expect(bands.at(-1)).toMatchObject({ min: 15, dm: 3 });
  });

  it("declares 17 background skills at level 0 with base 3 (Core p.10)", () => {
    expect(data.mongoose!.backgroundSkills).toHaveLength(17);
    expect(data.mongoose!.backgroundSkills).toContain("Vacc Suit");
    expect(data.mongoose!.backgroundSkills).toContain("Streetwise");
    expect(data.mongoose!.backgroundSkillBase).toBe(3);
  });

  it("declares the 1D draft table (Core p.20)", () => {
    const draft = data.mongoose!.draft;
    expect(draft).toHaveLength(6);
    expect(draft.find((d) => d.roll === 1)?.career).toBe("navy");
    expect(draft.find((d) => d.roll === 4)?.assignment).toBe("merchantMarine");
    expect(draft.find((d) => d.roll === 6)?.assignment).toBe("lawEnforcement");
  });

  it("sets the Mongoose defaults: age 18, 4-year terms, target 8", () => {
    expect(data.mongoose!.startAge).toBe(18);
    expect(data.mongoose!.termLengthYears).toBe(4);
    expect(data.mongoose!.defaultTaskTarget).toBe(8);
  });
});

const CAREERS = parseCanonData(mongooseJson, "mongoose-2e").mongoose!.careers;
const EXPECTED_IDS = [
  "agent", "army", "citizen", "drifter", "entertainer", "marine",
  "merchant", "navy", "noble", "rogue", "scholar", "scout",
];
const MILITARY = new Set(["army", "navy", "marine"]);

function isCol7(col: readonly unknown[]): boolean {
  return Array.isArray(col) && col.length === 7 && col[0] === null;
}

describe("mongoose-2e careers", () => {
  it("declares all twelve core careers (Core pp.22-45)", () => {
    expect(Object.keys(CAREERS).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  for (const id of EXPECTED_IDS) {
    describe(id, () => {
      const c = CAREERS[id]!;

      it("has three assignments", () => {
        expect(c.assignments).toHaveLength(3);
      });

      it("events are a 2D table (rolls 2..12)", () => {
        expect(c.events.map((e) => e.roll)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      });

      it("mishaps are a 1D table (rolls 1..6)", () => {
        expect(c.mishaps.map((m) => m.roll)).toEqual([1, 2, 3, 4, 5, 6]);
      });

      it("muster is a 1D table (rolls 1..7)", () => {
        expect(c.musterOut.map((m) => m.roll)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      });

      it("shared + assignment skill columns are 7 wide with row 0 null", () => {
        expect(isCol7(c.skillTables.personalDevelopment)).toBe(true);
        expect(isCol7(c.skillTables.serviceSkills)).toBe(true);
        if (c.skillTables.advancedEducation !== null) {
          expect(isCol7(c.skillTables.advancedEducation)).toBe(true);
        }
        for (const a of c.assignments) expect(isCol7(a.skills)).toBe(true);
      });

      it("every assignment maps to a declared enlisted rank ladder", () => {
        const ladderKeys = new Set(Object.keys(c.ranks.enlisted));
        for (const a of c.assignments) {
          const ladder = c.ranks.enlistedByAssignment[a.id];
          expect(ladder, `assignment ${a.id} has no ladder`).toBeDefined();
          expect(ladderKeys.has(ladder!)).toBe(true);
        }
      });

      it(`is ${MILITARY.has(id) ? "military (commission + officer)" : "civilian (no commission/officer)"}`, () => {
        if (MILITARY.has(id)) {
          expect(c.commission).toBeDefined();
          expect(c.skillTables.officer).toBeDefined();
          expect(c.ranks.officer).toBeDefined();
        } else {
          expect(c.commission).toBeUndefined();
          expect(c.skillTables.officer).toBeUndefined();
          expect(c.ranks.officer).toBeUndefined();
        }
      });
    });
  }
});
