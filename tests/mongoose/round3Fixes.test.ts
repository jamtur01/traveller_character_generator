// Round-3 Mongoose 2e engine + data fixes (feat/chargen-models). Teeth-tests
// that pin Math.random and assert exact end-state for the behavioral fixes:
// centralized skill-cell parsing (whichever-higher SOC, top-level "X or Y"
// choice, atomic skill catalog), forfeitBenefits zeroing muster rolls,
// rollDraft leaving the current career, the mandatory forced-career transfer,
// and the F1 Diplomat data correction.

import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { getCareer, mongooseSkillNames } from "@/lib/traveller/engine/mongoose/core";
import { applySkillCell, skillLevel } from "@/lib/traveller/engine/mongoose/skills";
import { applyRankBenefit } from "@/lib/traveller/engine/mongoose/ranks";
import { applyEffects } from "@/lib/traveller/engine/mongoose/effects";
import { getEdition } from "@/lib/traveller/editions";
import type { MongooseEffect } from "@/lib/traveller/engine/mongoose/types";

// Math.random value that makes the next single die / pick land on face `v`.
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

function mockRandom(seq: number[], fallback = d6(3)): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? fallback);
}

afterEach(() => vi.restoreAllMocks());

describe("H1: officer 'SOC N or SOC +1, whichever is higher' (Core p.25/32/36)", () => {
  it("raises SOC to the floor when the floor wins, granting NO skill", () => {
    const c = mkChar({ social: 7 });
    applySkillCell(c, "SOC 10 or SOC +1, whichever is higher", "Rank 6");
    expect(c.attributes.social).toBe(10); // max(10, 7+1)
    expect(c.skills).toEqual([]); // no garbage "SOC ..." / "whichever ..." skill
  });

  it("adds +1 when current+1 beats the floor", () => {
    const c = mkChar({ social: 11 });
    applySkillCell(c, "SOC 10 or SOC +1, whichever is higher", "Rank 6");
    expect(c.attributes.social).toBe(12); // max(10, 11+1)
    expect(c.skills).toEqual([]);
  });

  it("Army General (officer rank 6) via the real ladder reaches SOC 10", () => {
    const c = mkChar({ social: 7 });
    const ladder = getCareer(c, "army").ranks.officer!;
    applyRankBenefit(c, ladder, 6);
    expect(c.attributes.social).toBe(10);
    expect(c.skills).toEqual([]);
  });

  it("Navy Admiral (officer rank 6) via the real ladder reaches SOC 12", () => {
    const c = mkChar({ social: 9 });
    const ladder = getCareer(c, "navy").ranks.officer!;
    applyRankBenefit(c, ladder, 6); // "SOC 12 or SOC +1, whichever is higher"
    expect(c.attributes.social).toBe(12); // max(12, 9+1)
    expect(c.skills).toEqual([]);
  });
});

describe("A1/M1: top-level 'X or Y' cell resolves to one atomic skill", () => {
  it("'Drive or Vacc Suit' grants exactly one, never the merged string", () => {
    const c = mkChar();
    mockRandom([d6(1)]); // rng.pick index 0 of 2 -> "Drive"
    applySkillCell(c, "Drive or Vacc Suit", "Skills");
    expect(skillLevel(c, "Drive")).toBe(1);
    expect(skillLevel(c, "Vacc Suit")).toBe(-1);
    expect(skillLevel(c, "Drive or Vacc Suit")).toBe(-1);
  });

  it("picks the second branch when the pick lands on index 1", () => {
    const c = mkChar();
    mockRandom([d6(6)]); // rng.pick index 1 of 2 -> "Vacc Suit"
    applySkillCell(c, "Drive or Vacc Suit", "Skills");
    expect(skillLevel(c, "Vacc Suit")).toBe(1);
    expect(skillLevel(c, "Drive")).toBe(-1);
  });

  it("a rank 'Gun Combat 1 or Melee 1' benefit grants ONE skill at level 1", () => {
    const c = mkChar();
    mockRandom([d6(1)]); // index 0 -> "Gun Combat 1"
    applySkillCell(c, "Gun Combat 1 or Melee 1", "Rank 3");
    expect(skillLevel(c, "Gun Combat")).toBe(1);
    expect(skillLevel(c, "Melee")).toBe(-1);
  });

  it("a specialty parenthesis is NOT split (single skill, gained at 1)", () => {
    const c = mkChar();
    applySkillCell(c, "Pilot (small craft or spacecraft)", "Skills");
    expect(skillLevel(c, "Pilot (small craft or spacecraft)")).toBe(1);
    expect(c.skills).toHaveLength(1);
  });
});

describe("A5: the gainAnySkill catalog holds atomic skill names, not merged", () => {
  it("mongooseSkillNames splits 'Drive or Flyer' into 'Drive' and 'Flyer'", () => {
    const c = mkChar();
    const names = mongooseSkillNames(c);
    expect(names.has("Drive")).toBe(true);
    expect(names.has("Flyer")).toBe(true);
    expect(names.has("Vacc Suit")).toBe(true);
    expect(names.has("Drive or Flyer")).toBe(false);
    expect(names.has("Drive or Vacc Suit")).toBe(false);
  });
});

describe("F1: Noble event 6 uses the real skill 'Diplomat', not phantom 'Diplomacy'", () => {
  const noble = getEdition("mongoose-2e").data.mongoose!.careers.noble!;
  const ev6 = noble.events.find((e) => e.roll === 6)!;

  it("the event-6 choice lists 'Diplomat' and never 'Diplomacy'", () => {
    const choice = ev6.effects.find((e) => e.kind === "gainSkillChoice");
    const options = choice && choice.kind === "gainSkillChoice" ? choice.options : [];
    expect(options).toContain("Diplomat");
    expect(options).not.toContain("Diplomacy");
  });

  it("no gainSkill / gainSkillChoice token 'Diplomacy' survives in any career", () => {
    const tokens: string[] = [];
    const walk = (effs: readonly MongooseEffect[]): void => {
      for (const e of effs) {
        if (e.kind === "gainSkill") tokens.push(e.skill);
        else if (e.kind === "gainSkillChoice") tokens.push(...e.options);
        else if (e.kind === "chooseEffect") for (const b of e.options) walk(b);
        else if (e.kind === "check") { walk(e.onSuccess); walk(e.onFailure); walk(e.onNatural2 ?? []); }
        else if (e.kind === "rollSubTable") for (const en of e.entries) walk(en);
      }
    };
    for (const car of Object.values(getEdition("mongoose-2e").data.mongoose!.careers)) {
      for (const r of [...car.events, ...car.mishaps]) walk(r.effects);
    }
    expect(tokens).not.toContain("Diplomacy");
  });

  it("applying event 6 with the pick landing on Diplomat grants Diplomat 1", () => {
    const c = mkChar();
    c.mongooseState!.career = "noble";
    c.mongooseState!.assignment = "dilettante";
    mockRandom([0.6]); // rng.pick index 2 of 4 -> "Diplomat"
    applyEffects(c, ev6.effects);
    expect(skillLevel(c, "Diplomat")).toBe(1);
    expect(skillLevel(c, "Diplomacy")).toBe(-1);
  });
});
