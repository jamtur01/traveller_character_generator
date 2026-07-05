import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { skillLevel, applySkillCell } from "@/lib/traveller/engine/mongoose/skills";
import { getMongooseData } from "@/lib/traveller/engine/mongoose/core";
import { commission } from "@/lib/traveller/engine/mongoose/ranks";
import { applyEffects } from "@/lib/traveller/engine/mongoose/effects";
import type { MongooseEffect } from "@/lib/traveller/engine/mongoose/types";

// Math.random value that makes the next single die / pick land on face/index `v`.
const d6 = (v: number) => (v - 1) / 6 + 0.001;

const BASE: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function mkChar(over: Partial<Attributes> = {}): Character {
  const c = new Character({ attributes: { ...BASE, ...over } });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  return c;
}

// Install the mock AFTER construction (the constructor consumes real randomness).
function mockRandom(seq: number[], fallback = d6(3)): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? fallback);
}

afterEach(() => vi.restoreAllMocks());

// A speciality parenthesis holding a top-level " or " ("Pilot (small craft or
// spacecraft)") — a compound-specialty cell that the engine would collapse into
// a single non-canonical skill. F1 re-encodes these as top-level choices.
const PAREN_OR = /\([^)]* or [^)]*\)/;

describe("BUG-1: commission() never demotes an already-commissioned officer", () => {
  it("commission() is a no-op for a rank-4 officer (stays rank 4, not reset to 1)", () => {
    const c = mkChar();
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "infantry";
    c.mongooseState!.commissioned = true;
    c.mongooseState!.rank = 4;
    commission(c);
    expect(c.mongooseState!.rank).toBe(4);
    expect(c.mongooseState!.commissioned).toBe(true);
  });

  it("the roll-12 autoCommission effect keeps a rank-4 officer at rank 4", () => {
    const c = mkChar();
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "infantry";
    c.mongooseState!.commissioned = true;
    c.mongooseState!.rank = 4;
    applyEffects(c, [{ kind: "autoCommission" }]);
    expect(c.mongooseState!.rank).toBe(4);
  });
});

describe("MG-F1: compound specialities are top-level choices, not merged skills", () => {
  it("no mechanical skill field embeds a paren-internal ' or ' in any career", () => {
    const data = getMongooseData(mkChar());
    const offenders: string[] = [];
    const check = (s: unknown): void => {
      if (typeof s === "string" && PAREN_OR.test(s)) offenders.push(s);
    };
    const walk = (effects: readonly MongooseEffect[]): void => {
      for (const e of effects) {
        const any = e as Record<string, unknown>;
        if (any.kind === "gainSkill") check(any.skill);
        if (any.kind === "gainSkillChoice") (any.options as string[]).forEach(check);
        if (any.kind === "check") (any.options as string[]).forEach(check);
        if (any.kind === "chooseEffect") {
          for (const branch of any.options as MongooseEffect[][]) walk(branch);
        }
        if (any.kind === "rollSubTable") {
          for (const branch of any.entries as MongooseEffect[][]) walk(branch);
        }
        if (any.onSuccess) walk(any.onSuccess as MongooseEffect[]);
        if (any.onFailure) walk(any.onFailure as MongooseEffect[]);
        if (any.onNatural2) walk(any.onNatural2 as MongooseEffect[]);
      }
    };
    for (const career of Object.values(data.careers)) {
      const t = career.skillTables;
      for (const col of [t.personalDevelopment, t.serviceSkills, t.advancedEducation]) {
        if (col) for (const cell of col) check(cell);
      }
      for (const asg of career.assignments) for (const cell of asg.skills) check(cell);
      for (const row of career.events) walk(row.effects);
      for (const row of career.mishaps) walk(row.effects);
    }
    for (const row of data.lifeEvents) walk(row.effects);
    for (const row of data.lifeEventsUnusual) walk(row.effects);
    expect(offenders).toEqual([]);
  });

  it("a split speciality cell grants one canonical speciality, never the merged literal", () => {
    const c = mkChar();
    mockRandom([d6(1)]); // rng.pick index 0 of 2 -> "Art (holography)"
    applySkillCell(c, "Art (holography) or Art (write)", "Skills");
    expect(skillLevel(c, "Art (holography)")).toBe(1);
    expect(skillLevel(c, "Art (write)")).toBe(-1);
    expect(skillLevel(c, "Art (holography or write)")).toBe(-1);
  });

  it("the Scout Service Skills Pilot cell is a choice of two real specialities", () => {
    const c = mkChar();
    const cell = getMongooseData(c).careers.scout!.skillTables.serviceSkills[1];
    expect(cell).toBe("Pilot (small craft) or Pilot (spacecraft)");
    mockRandom([d6(6)]); // rng.pick index 1 of 2 -> "Pilot (spacecraft)"
    applySkillCell(c, cell as string, "Skills");
    expect(skillLevel(c, "Pilot (spacecraft)")).toBe(1);
    expect(skillLevel(c, "Pilot (small craft or spacecraft)")).toBe(-1);
  });
});
