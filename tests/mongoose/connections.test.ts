import { describe, it, expect } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { applyConnections } from "@/lib/traveller/engine/mongoose/connections";

const ATTRS: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function mchar(connections: number): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement";
  c.skills.push(["Investigate", 1], ["Recon", 1], ["Streetwise", 1]);
  for (let i = 0; i < connections; i++) {
    c.mongooseState.connections.push({ relation: "ally", note: "" });
  }
  return c;
}

describe("applyConnections (solo interpretation, Core p.19)", () => {
  it("grants exactly one +1 skill bonus per connection", () => {
    const c = mchar(1);
    const before = c.totalSkillLevels();
    applyConnections(c);
    expect(c.totalSkillLevels() - before).toBe(1);
  });

  it("caps the free skills at the connection cap even with more connections", () => {
    const c = mchar(4); // cap is 2
    const before = c.totalSkillLevels();
    applyConnections(c);
    expect(c.totalSkillLevels() - before).toBe(2);
  });

  it("grants nothing when the Traveller formed no connections", () => {
    const c = mchar(0);
    const before = c.totalSkillLevels();
    applyConnections(c);
    expect(c.totalSkillLevels() - before).toBe(0);
  });

  it("never raises a skill above the connection max level (3)", () => {
    const c = mchar(2);
    // Only one eligible skill, already at the max level - nothing to raise.
    c.skills = [["Investigate", 3], ["Jack-of-all-Trades", 1]];
    const before = c.totalSkillLevels();
    applyConnections(c);
    expect(c.totalSkillLevels() - before).toBe(0);
  });
});
