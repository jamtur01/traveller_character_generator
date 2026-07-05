import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";
import { applyEffects } from "@/lib/traveller/engine/mongoose/effects";
import type { MongooseEffect } from "@/lib/traveller/engine/mongoose/types";

// Math.random value that makes the next single die show face `v` (1-6).
const d6 = (v: number) => (v - 1) / 6 + 0.001;
// Auto-mode pickOrDefer uses rng.pick: floor(next()*len). For a 2-option
// choice, PICK1 lands on index 0, PICK2 on index 1.
const PICK1 = 0.001;
const PICK2 = 0.501;

const BASE: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function mkChar(): Character {
  const c = new Character({ attributes: { ...BASE } });
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

function drifterEvent9(c: Character): readonly MongooseEffect[] {
  const row = getCareer(c, "drifter").events.find((e) => e.roll === 9);
  if (!row) throw new Error("drifter event 9 missing");
  return row.effects;
}

describe("M3: Drifter event 9 risky adventure (Core p.29)", () => {
  it("accept + sub-roll 5 grants DM+4 to the next Benefit roll", () => {
    const c = mkChar();
    mockRandom([PICK1 /* accept */, d6(5) /* sub-table roll 5 */]);
    applyEffects(c, drifterEvent9(c));
    expect(c.mongooseState!.pendingDms.benefit).toEqual([{ dm: 4, scope: "next" }]);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();
  });

  it("accept + sub-roll 1 + choosing prison forces the Prisoner career", () => {
    const c = mkChar();
    mockRandom([PICK1 /* accept */, d6(1) /* sub-table roll 1 */, PICK2 /* prison, not injury */]);
    applyEffects(c, drifterEvent9(c));
    expect(c.mongooseState!.forcedNextCareer).toBe("prisoner");
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    // No benefit DM on the injured/arrested branch.
    expect(c.mongooseState!.pendingDms.benefit).toEqual([]);
  });

  it("accept + sub-roll 1 + choosing injury rolls on the Injury table", () => {
    const c = mkChar();
    // accept, sub-table roll 1, pick injury (index 0), then Injury 1D = 5
    // (row 5 "reduce any physical characteristic by 1").
    mockRandom([PICK1, d6(1), PICK1, d6(5)]);
    const before = c.attributes.strength + c.attributes.dexterity + c.attributes.endurance;
    applyEffects(c, drifterEvent9(c));
    const after = c.attributes.strength + c.attributes.dexterity + c.attributes.endurance;
    expect(after).toBe(before - 1);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();
  });

  it("accept + sub-roll 3 yields nothing (survive, gain nothing)", () => {
    const c = mkChar();
    mockRandom([PICK1 /* accept */, d6(3) /* sub-table roll 3 */]);
    applyEffects(c, drifterEvent9(c));
    expect(c.mongooseState!.pendingDms.benefit).toEqual([]);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();
  });

  it("declining the adventure changes nothing", () => {
    const c = mkChar();
    mockRandom([PICK2 /* decline */]);
    applyEffects(c, drifterEvent9(c));
    expect(c.mongooseState!.pendingDms.benefit).toEqual([]);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();
    expect(vi.mocked(Math.random).mock.calls.length).toBe(1); // no sub-table roll
  });
});
