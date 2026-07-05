import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { rollSurvival } from "@/lib/traveller/engine/mongoose/survival";

const d6 = (v: number) => (v - 1) / 6 + 0.001;
const ATTRS: Attributes = {
  strength: 8, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function agentChar(): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement"; // survival END 6+
  return c;
}

describe("rollSurvival", () => {
  afterEach(() => vi.restoreAllMocks());

  it("survives when 2D + END DM meets the target (no mishap, no ejection)", () => {
    const c = agentChar(); // END 7 -> DM 0
    const seq = [d6(4), d6(4)]; // 2D = 8 >= 6
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
    expect(rollSurvival(c)).toBe(true);
    expect(c.mongooseState!.perTerm.survived).toBe(true);
    expect(c.events.some((e) => e.kind === "mongooseMishap")).toBe(false);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(false);
  });

  it("a natural 2 always fails and triggers a mishap (ejected, benefit lost)", () => {
    const c = agentChar();
    // survival 2D = 2 (natural 2), then a Mishap roll (+ any effect rolls).
    const seq = [d6(1), d6(1), d6(6), d6(5)];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
    expect(rollSurvival(c)).toBe(false);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.loseBenefitThisTerm).toBe(true);
    expect(c.events.find((e) => e.kind === "mongooseMishap")).toMatchObject({ roll: 6 });
  });

  it("a low roll fails and resolves a mishap", () => {
    const c = agentChar();
    const seq = [d6(2), d6(3), d6(4), d6(3), d6(3), d6(3)]; // survival 5 < 6
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    expect(rollSurvival(c)).toBe(false);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.events.some((e) => e.kind === "mongooseMishap")).toBe(true);
  });
});
