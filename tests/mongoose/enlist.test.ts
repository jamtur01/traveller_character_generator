import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { qualifyForCareer, enterCareer } from "@/lib/traveller/engine/mongoose/enlist";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";

const d6 = (v: number) => (v - 1) / 6 + 0.001;
const ATTRS: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 9, education: 9, social: 7,
};

function mongooseChar(): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  return c;
}

function serviceSkillNames(c: Character): string[] {
  return getCareer(c, "agent").skillTables.serviceSkills
    .filter((x): x is string => typeof x === "string");
}

describe("qualifyForCareer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes Agent (INT 6+) when 2D + INT DM meets the target", () => {
    const c = mongooseChar(); // INT 9 -> DM +1
    const seq = [d6(3), d6(3)]; // 2D = 6
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    expect(qualifyForCareer(c, "agent")).toBe(true); // 6 + 1 = 7 >= 6
    const roll = c.events.find((e) => e.kind === "roll");
    expect(roll).toMatchObject({ rollName: "Qualification (Agent)", succeeded: true, target: 6 });
  });

  it("fails when the modified roll is below the target", () => {
    const c = mongooseChar();
    const seq = [d6(2), d6(2)]; // 2D = 4
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    expect(qualifyForCareer(c, "agent")).toBe(false); // 4 + 1 = 5 < 6
  });

  it("applies -1 DM per previous career", () => {
    const c = mongooseChar();
    c.mongooseState!.careerCount = 2; // -2
    const seq = [d6(3), d6(3)]; // 2D = 6
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    expect(qualifyForCareer(c, "agent")).toBe(false); // 6 + 1 - 2 = 5 < 6
  });

  it("qualifies Drifter automatically with no die roll", () => {
    const c = mongooseChar();
    const spy = vi.spyOn(Math, "random");
    expect(qualifyForCareer(c, "drifter")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(c.events.some((e) => e.kind === "raw" && /Drifter \(automatic\)/.test(e.text))).toBe(true);
  });
});

describe("enterCareer + basic training", () => {
  it("first career grants ALL service skills at level 0 (Agent)", () => {
    const c = mongooseChar();
    enterCareer(c, "agent", "lawEnforcement");
    for (const name of serviceSkillNames(c)) {
      const s = c.skills.find(([n]) => n === name);
      expect(s, `missing ${name}`).toBeDefined();
      expect(s![1]).toBe(0);
    }
    expect(c.mongooseState!.career).toBe("agent");
    expect(c.mongooseState!.assignment).toBe("lawEnforcement");
    expect(c.mongooseState!.rank).toBe(0);
  });

  it("subsequent career grants exactly one service skill at level 0", () => {
    const c = mongooseChar();
    c.mongooseState!.careerCount = 1;
    enterCareer(c, "agent", "lawEnforcement");
    const svc = new Set(serviceSkillNames(c));
    const gainedAt0 = c.skills.filter(([n, l]) => svc.has(n) && l === 0);
    expect(gainedAt0).toHaveLength(1);
  });
});
