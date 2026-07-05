import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { enterCareer } from "@/lib/traveller/engine/mongoose/enlist";
import { skillLevel } from "@/lib/traveller/engine/mongoose/skills";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";
import { musterOut } from "@/lib/traveller/engine/mongoose/muster";

// Math.random value that makes the next single die show face `v` (1-6).
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

describe("F1: rank-0 ladder benefit granted on career entry (Core p.19)", () => {
  it("Army entry grants Gun Combat 1 immediately", () => {
    const c = mkChar();
    enterCareer(c, "army", "infantry");
    expect(skillLevel(c, "Gun Combat")).toBe(1);
  });

  it("Prisoner entry grants Melee (unarmed) 1 immediately", () => {
    const c = mkChar();
    mockRandom([d6(3)]); // parole-threshold roll only; the rank benefit is dice-free
    enterCareer(c, "prisoner", "inmate");
    expect(skillLevel(c, "Melee (unarmed)")).toBe(1);
  });

  it("Marine entry resolves the rank-0 'Gun Combat (any) 1 or Melee (blade) 1' choice", () => {
    const c = mkChar();
    mockRandom([d6(1)]); // rank-0 choice runs first: rng.pick index 0 -> Gun Combat (any) 1
    enterCareer(c, "marine", "starMarine");
    expect(skillLevel(c, "Gun Combat (any)")).toBe(1);
    expect(skillLevel(c, "Melee (blade)")).toBe(-1); // the other branch was NOT granted
  });

  it("a career with a null rank-0 benefit (Agent) grants no rank benefit on entry", () => {
    const c = mkChar();
    const before = c.skills.length;
    enterCareer(c, "agent", "lawEnforcement");
    // Only the first-career basic-training service skills (all at 0); rank 0 is null.
    const svc = new Set(
      getCareer(c, "agent").skillTables.serviceSkills.filter((x): x is string => typeof x === "string"),
    );
    expect(c.skills.length).toBe(before + svc.size);
    expect(c.skills.every(([, l]) => l === 0)).toBe(true);
  });
});

describe("H1: pending benefit DM consumed on one muster roll (Core p.46)", () => {
  it("raises exactly the first Benefit roll, then is consumed", () => {
    const c = mkChar();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    c.mongooseState!.termsInCareer = 2; // rank 0 -> no bonus rolls/DM: exactly 2 rolls
    c.mongooseState!.pendingDms.benefit.push({ dm: 1, scope: "next" });
    // per roll: draw1 = column pick (Cash, index 0); draw2 = 1D face 3.
    mockRandom([d6(1), d6(3), d6(1), d6(3)]);
    musterOut(c);
    const cash: string[] = [];
    for (const e of c.events) {
      if (e.kind === "raw" && /Muster benefit \(Cash\)/.test(e.text)) cash.push(e.text);
    }
    expect(cash).toHaveLength(2);
    expect(cash[0]!).toMatch(/roll 4\)/); // 3 + benefit DM 1
    expect(cash[1]!).toMatch(/roll 3\)/); // 3 + 0 (DM already consumed)
    expect(c.credits).toBe(7500 + 5000); // row 4 + row 3
    expect(c.mongooseState!.pendingDms.benefit).toEqual([]);
  });

  it("a persistent (scope 'any') benefit DM survives after a roll", () => {
    const c = mkChar();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    c.mongooseState!.termsInCareer = 1;
    c.mongooseState!.pendingDms.benefit.push({ dm: 1, scope: "any" });
    mockRandom([d6(1), d6(3)]);
    musterOut(c);
    expect(c.mongooseState!.pendingDms.benefit).toEqual([{ dm: 1, scope: "any" }]);
  });
});
