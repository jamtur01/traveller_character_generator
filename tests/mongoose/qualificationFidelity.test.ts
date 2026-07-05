import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { qualifyForCareer } from "@/lib/traveller/engine/mongoose/enlist";

// Math.random value that makes the next single die show face `v` (1-6).
const d6 = (v: number) => (v - 1) / 6 + 0.001;

const BASE: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function mkChar(over: Partial<Attributes> = {}, age = 18): Character {
  const c = new Character({ attributes: { ...BASE, ...over } });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.age = age;
  return c;
}

// Install the mock AFTER construction (the constructor consumes real randomness).
function mockRandom(seq: number[], fallback = d6(3)): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? fallback);
}

afterEach(() => vi.restoreAllMocks());

describe("b#8: qualification age DM (Core p.24/32/36)", () => {
  // Army: END 5+ (BASE END 7 -> characteristic DM +0), no prior careers.
  // 2D = 5 lands exactly on target 5; the DM-2 at age 30+ pushes it to a fail.
  it("Army: DM-2 kicks in at age 30, not at 29", () => {
    const at29 = mkChar({}, 29);
    mockRandom([d6(2), d6(3)]); // 2D = 5, total 5 >= 5
    expect(qualifyForCareer(at29, "army")).toBe(true);

    const at30 = mkChar({}, 30);
    mockRandom([d6(2), d6(3)]); // 2D = 5, total 5 - 2 = 3 < 5
    expect(qualifyForCareer(at30, "army")).toBe(false);
  });

  it("Marine: DM-2 applies at age 30 (Core p.32)", () => {
    // Marine END 6+ (DM +0). 2D = 6 hits target 6; DM-2 fails it.
    const at30 = mkChar({}, 30);
    mockRandom([d6(3), d6(3)]); // 2D = 6, total 6 - 2 = 4 < 6
    expect(qualifyForCareer(at30, "marine")).toBe(false);
  });

  it("Navy: threshold is 34, so age 30 is unaffected but 34 takes DM-2", () => {
    // Navy INT 6+ (DM +0). 2D = 6 hits target 6.
    const at30 = mkChar({}, 30);
    mockRandom([d6(3), d6(3)]); // 2D = 6, no age DM below 34 -> 6 >= 6
    expect(qualifyForCareer(at30, "navy")).toBe(true);

    const at33 = mkChar({}, 33);
    mockRandom([d6(3), d6(3)]); // still below 34 -> pass
    expect(qualifyForCareer(at33, "navy")).toBe(true);

    const at34 = mkChar({}, 34);
    mockRandom([d6(3), d6(3)]); // 2D = 6, total 6 - 2 = 4 < 6
    expect(qualifyForCareer(at34, "navy")).toBe(false);
  });
});

describe("b#9: Noble automatic qualification at SOC 10+ (Core p.38)", () => {
  it("SOC 10 qualifies with no dice rolled", () => {
    const c = mkChar({ social: 10 });
    // A guaranteed-failing 2D (=2) would fail the roll; auto-qualify never rolls.
    mockRandom([d6(1), d6(1)]);
    expect(qualifyForCareer(c, "noble")).toBe(true);
    expect(vi.mocked(Math.random).mock.calls.length).toBe(0);
  });

  it("SOC 9 does NOT auto-qualify: it rolls and can fail", () => {
    // SOC 9 -> characteristic DM +1, target 10, no prior careers.
    const failing = mkChar({ social: 9 });
    mockRandom([d6(4), d6(4)]); // 2D = 8, total 8 + 1 = 9 < 10
    expect(qualifyForCareer(failing, "noble")).toBe(false);
    expect(vi.mocked(Math.random).mock.calls.length).toBe(2);

    const passing = mkChar({ social: 9 });
    mockRandom([d6(4), d6(5)]); // 2D = 9, total 9 + 1 = 10 >= 10
    expect(qualifyForCareer(passing, "noble")).toBe(true);
  });
});
