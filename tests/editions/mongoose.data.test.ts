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
