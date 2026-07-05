import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { rollAdvancement, attemptCommission } from "@/lib/traveller/engine/mongoose/advancement";

const d6 = (v: number) => (v - 1) / 6 + 0.001;

function mchar(over: Partial<Attributes>, career: string, assignment: string): Character {
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7, ...over,
    },
  });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = career;
  c.mongooseState.assignment = assignment;
  c.mongooseState.termsInCareer = 1;
  return c;
}

describe("rollAdvancement", () => {
  afterEach(() => vi.restoreAllMocks());

  it("promotes to rank 1 on success (Agent Law Enforcement, INT 6+)", () => {
    const c = mchar({ intelligence: 9 }, "agent", "lawEnforcement"); // INT DM +1
    const seq = [d6(3), d6(3)]; // 2D = 6 -> 7 >= 6
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    expect(rollAdvancement(c)).toBe(true);
    expect(c.mongooseState!.rank).toBe(1);
    expect(c.mongooseState!.perTerm.advancedThisTerm).toBe(true);
    expect(c.events.find((e) => e.kind === "mongooseRank")).toMatchObject({ rank: 1, commission: false });
  });

  it("a natural 12 forces continuation", () => {
    const c = mchar({ intelligence: 9 }, "agent", "lawEnforcement");
    const seq = [d6(6), d6(6)]; // natural 12
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    rollAdvancement(c);
    expect(c.mongooseState!.perTerm.mustContinue).toBe(true);
  });

  it("an advancement roll <= terms in career forces leaving", () => {
    const c = mchar({ intelligence: 9 }, "agent", "lawEnforcement");
    c.mongooseState!.termsInCareer = 4;
    const seq = [d6(1), d6(2)]; // 2D = 3, 3 <= 4 and 3+1=4 < 6 (fail)
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    expect(rollAdvancement(c)).toBe(false);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.rank).toBe(0);
  });
});

describe("attemptCommission", () => {
  afterEach(() => vi.restoreAllMocks());

  it("commissions on success in a military career (Army)", () => {
    const c = mchar({ social: 10 }, "army", "support");
    const seq = [d6(6), d6(6)]; // 2D = 12 -> guaranteed success
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
    expect(attemptCommission(c)).toBe(true);
    expect(c.mongooseState!.commissioned).toBe(true);
    expect(c.mongooseState!.rank).toBe(1);
    expect(c.events.find((e) => e.kind === "mongooseRank")).toMatchObject({ commission: true });
  });

  it("is not available in a non-military career", () => {
    const c = mchar({}, "agent", "lawEnforcement");
    expect(attemptCommission(c)).toBe(false);
  });

  it("is not available after the first term below SOC 9", () => {
    const c = mchar({ social: 7 }, "army", "support");
    c.mongooseState!.termsInCareer = 2;
    expect(attemptCommission(c)).toBe(false);
  });
});
