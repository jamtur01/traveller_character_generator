import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { availableTables, rollSkillTraining } from "@/lib/traveller/engine/mongoose/skillsTraining";
import { grantSkillIncrement, skillLevel } from "@/lib/traveller/engine/mongoose/skills";

function mchar(over: Partial<Attributes>): Character {
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 9, social: 7, ...over,
    },
  });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement";
  return c;
}

describe("availableTables", () => {
  it("offers PD, Service, assignment, and Advanced Education when EDU meets the minimum", () => {
    const c = mchar({ education: 9 }); // Agent Advanced Education min 8
    expect(availableTables(c).map((t) => t.key)).toEqual([
      "personalDevelopment", "serviceSkills", "assignment", "advancedEducation",
    ]);
  });

  it("omits Advanced Education below the EDU minimum", () => {
    const c = mchar({ education: 7 });
    expect(availableTables(c).map((t) => t.key)).toEqual([
      "personalDevelopment", "serviceSkills", "assignment",
    ]);
  });

  it("adds the Officer table once commissioned (military career)", () => {
    const c = mchar({});
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    c.mongooseState!.commissioned = true;
    expect(availableTables(c).map((t) => t.key)).toContain("officer");
  });
});

describe("rollSkillTraining", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gains or raises a skill or characteristic each term (auto)", () => {
    const c = mchar({});
    rollSkillTraining(c);
    expect(c.events.some((e) =>
      e.kind === "skillLearned" || e.kind === "skillImproved" || e.kind === "attributeChange",
    )).toBe(true);
  });
});

describe("skill caps (Core p.19)", () => {
  it("never raises a skill beyond level 4", () => {
    const c = mchar({});
    c.skills.push(["Investigate", 4]);
    grantSkillIncrement(c, "Investigate");
    expect(skillLevel(c, "Investigate")).toBe(4);
  });
});
