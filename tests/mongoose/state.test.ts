import { describe, it, expect } from "vitest";
import { Character, cloneCharacter } from "@/lib/traveller/character";
import {
  freshMongooseState,
  resetMongoosePerTerm,
  consumePendingDm,
} from "@/lib/traveller/engine/mongoose/state";

describe("freshMongooseState", () => {
  it("starts a Traveller with no career, rank 0, and empty accumulators", () => {
    const s = freshMongooseState();
    expect(s.career).toBeNull();
    expect(s.assignment).toBeNull();
    expect(s.rank).toBe(0);
    expect(s.commissioned).toBe(false);
    expect(s.careerCount).toBe(0);
    expect(s.draftedOnce).toBe(false);
    expect(s.benefitRolls).toBe(0);
    expect(s.cashRollsUsed).toBe(0);
    expect(s.connections).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.perTerm.mustContinue).toBe(false);
  });
});

describe("resetMongoosePerTerm", () => {
  it("clears every per-term flag", () => {
    const s = freshMongooseState();
    s.perTerm = {
      mustContinue: true,
      mustLeave: true,
      survived: true,
      commissionedThisTerm: true,
      advancedThisTerm: true,
      noEject: true,
      loseBenefitThisTerm: true,
      benefitKept: true,
    };
    resetMongoosePerTerm(s);
    expect(s.perTerm).toEqual({
      mustContinue: false,
      mustLeave: false,
      survived: false,
      commissionedThisTerm: false,
      advancedThisTerm: false,
      noEject: false,
      loseBenefitThisTerm: false,
      benefitKept: false,
    });
  });
});

describe("consumePendingDm", () => {
  it("sums all pending DMs and removes only the 'next'-scoped ones", () => {
    const dms = [
      { dm: 2, scope: "next" as const },
      { dm: 1, scope: "any" as const },
      { dm: -1, scope: "next" as const },
    ];
    const total = consumePendingDm(dms);
    expect(total).toBe(2); // 2 + 1 - 1
    // "any" persists; both "next" entries consumed.
    expect(dms).toEqual([{ dm: 1, scope: "any" }]);
    // A second drain re-applies the persistent modifier and keeps it.
    expect(consumePendingDm(dms)).toBe(1);
    expect(dms).toEqual([{ dm: 1, scope: "any" }]);
  });

  it("returns 0 for an empty bucket", () => {
    const dms: { dm: number; scope: "next" | "any" }[] = [];
    expect(consumePendingDm(dms)).toBe(0);
  });
});

describe("Character carries and deep-clones mongooseState", () => {
  it("defaults to null and is not shared across clones", () => {
    const ch = new Character({ attributes: { strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7 } });
    expect(ch.mongooseState).toBeNull();

    ch.mongooseState = freshMongooseState();
    ch.mongooseState.career = "agent";
    ch.mongooseState.connections.push({ relation: "ally", note: "seed" });

    const clone = cloneCharacter(ch);
    clone.mongooseState!.career = "navy";
    clone.mongooseState!.connections.push({ relation: "enemy", note: "clone-only" });

    // Original is untouched by clone mutations (structuredClone, not shared ref).
    expect(ch.mongooseState.career).toBe("agent");
    expect(ch.mongooseState.connections).toHaveLength(1);
    expect(clone.mongooseState!.career).toBe("navy");
    expect(clone.mongooseState!.connections).toHaveLength(2);
  });
});
