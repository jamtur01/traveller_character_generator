import { getEdition, listEditions } from "@/lib/traveller/editions";
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
  "merchant", "navy", "noble", "prisoner", "rogue", "scholar", "scout",
];
const MILITARY = new Set(["army", "navy", "marine"]);

function isCol7(col: readonly unknown[]): boolean {
  return Array.isArray(col) && col.length === 7 && col[0] === null;
}

describe("mongoose-2e careers", () => {
  it("declares all thirteen careers: the twelve core (Core pp.22-45) + Prisoner (Core pp.56-57)", () => {
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

describe("mongoose-2e edition registration", () => {
  it("builds and is discoverable via listEditions", () => {
    expect(listEditions().map((e) => e.id)).toContain("mongoose-2e");
  });

  it("getEdition('mongoose-2e') builds and runs lazy validators without throwing", () => {
    const ed = getEdition("mongoose-2e");
    expect(ed.meta.id).toBe("mongoose-2e");
    expect(ed.meta.status).toBe("active");
    expect(ed.data.mongoose).toBeDefined();
  });
});

describe("mongoose-2e shared muster/aging/life-events data", () => {
  const MG = parseCanonData(mongooseJson, "mongoose-2e").mongoose!;

  it("declares the 1D Injury table (Core p.49)", () => {
    expect(MG.injury.map((r) => r.roll)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(MG.injury[5]!.reductions).toEqual([]); // roll 6 = lightly injured
    expect(MG.injury[2]!.reductions[0]).toMatchObject({ pool: ["strength", "dexterity"], amount: 2 });
  });

  it("declares the Ageing table clamped to [-6, 1] with term-4 start (Core p.49)", () => {
    expect(MG.agingStartTerm).toBe(4);
    expect(MG.aging.map((r) => r.threshold)).toEqual([-6, -5, -4, -3, -2, -1, 0, 1]);
    expect(MG.aging.at(-1)!.reductions).toEqual([]); // 1+ = no effect
  });

  it("declares Benefits of Rank and Pensions (Core pp.46, 49)", () => {
    expect(MG.cashRollCap).toBe(3);
    expect(MG.benefitsOfRank.at(-1)).toMatchObject({ bonusRolls: 3, benefitDm: 1 });
    expect(MG.pensions.minTerms).toBe(5);
    expect(MG.pensions.excludedCareers).toContain("scout");
    expect(MG.pensions.table.find((t) => t.terms === 5)?.pay).toBe(10000);
  });

  it("declares the 2D Life Events table + Unusual sub-table (Core p.46)", () => {
    expect(MG.lifeEvents.map((r) => r.roll)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(MG.lifeEventsUnusual.map((r) => r.roll)).toEqual([1, 2, 3, 4, 5, 6]);
    // Event 7 -> new Contact.
    expect(MG.lifeEvents.find((r) => r.roll === 7)!.effects[0]).toMatchObject({ kind: "gainRelation", relation: "contact" });
  });
});
