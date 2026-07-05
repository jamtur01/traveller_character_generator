import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { enterCareer } from "@/lib/traveller/engine/mongoose/enlist";
import { rollAdvancement } from "@/lib/traveller/engine/mongoose/advancement";
import { applyEffects, resolveMishap } from "@/lib/traveller/engine/mongoose/effects";
import { getMongooseData } from "@/lib/traveller/engine/mongoose/core";

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

describe("enterCareer parole initialisation (Core p.52)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sets the initial Parole Threshold to the 1D roll + 2 on entering the Prisoner career", () => {
    // Build the characters first (construction seeds each RNG from real
    // Math.random); then mock so the first career's only die draw IS the parole
    // roll — basic training grants skills but consumes no dice for a first career.
    const low = mchar({}, "prisoner", "inmate");
    const high = mchar({}, "prisoner", "inmate");
    const seq = [d6(1), d6(6)];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));

    enterCareer(low, "prisoner", "inmate");
    expect(low.mongooseState!.paroleThreshold).toBe(3); // 1 + 2

    enterCareer(high, "prisoner", "inmate");
    expect(high.mongooseState!.paroleThreshold).toBe(8); // 6 + 2
  });

  it("leaves the Parole Threshold null for a non-parole career", () => {
    const c = mchar({}, "agent", "lawEnforcement");
    const seq: number[] = [];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));

    enterCareer(c, "agent", "lawEnforcement");
    expect(c.mongooseState!.paroleThreshold).toBeNull();
  });
});

describe("rollAdvancement parole branch (Core p.52)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("releases the prisoner when the advancement total exceeds the Parole Threshold", () => {
    const c = mchar({ strength: 7 }, "prisoner", "inmate"); // advancement STR 7 -> DM 0
    c.mongooseState!.paroleThreshold = 3;
    const seq = [d6(6), d6(6)]; // 2D = 12; total 12 + 0 > 3
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));

    rollAdvancement(c);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.mustContinue).toBe(false);
  });

  it("keeps the prisoner when the total does not exceed the threshold (normal leave rule bypassed)", () => {
    const c = mchar({ strength: 7 }, "prisoner", "inmate"); // advancement STR 7 -> DM 0
    c.mongooseState!.termsInCareer = 1;
    c.mongooseState!.paroleThreshold = 10;
    const seq = [d6(2), d6(2)]; // 2D = 4; total 4 + 0 <= 10
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));

    rollAdvancement(c);
    // A raw roll of 4 can never set mustContinue via the normal branch (only a
    // natural 12 does), so mustContinue===true proves the parole branch fired.
    expect(c.mongooseState!.perTerm.mustContinue).toBe(true);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(false);
  });
});

describe("resolveMishap never ejects a prisoner (Core p.52)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("applies the mishap effect but does not eject while the no-eject gate is set", () => {
    const c = mchar({}, "prisoner", "inmate");
    c.mongooseState!.paroleThreshold = 5;
    c.mongooseState!.perTerm.noEject = true; // set by the model at the start of every prisoner term
    const seq = [d6(2)]; // mishap 2: "Parole Threshold increases by 2"
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));

    resolveMishap(c, true);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(false);
    expect(c.mongooseState!.perTerm.loseBenefitThisTerm).toBe(false);
    expect(c.mongooseState!.paroleThreshold).toBe(7); // effect still applied: 5 + 2
  });

  it("ejects on the same mishap once the no-eject gate is cleared", () => {
    const c = mchar({}, "prisoner", "inmate");
    c.mongooseState!.paroleThreshold = 5;
    c.mongooseState!.perTerm.noEject = false; // the only difference from the case above
    const seq = [d6(2)];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));

    resolveMishap(c, true);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.loseBenefitThisTerm).toBe(true);
  });
});

describe("forcedOnly career filtering (Core p.52)", () => {
  it("excludes the Prisoner career from the normal career-choice list but keeps normal careers", () => {
    const c = mchar({}, "prisoner", "inmate");
    const data = getMongooseData(c);
    const choosable = Object.keys(data.careers).filter((id) => !data.careers[id]!.forcedOnly);

    expect(choosable).not.toContain("prisoner");
    expect(choosable).toContain("agent");
    expect(data.careers.prisoner?.forcedOnly).toBe(true);
  });
});

describe("modifyParoleThreshold clamping (Core p.52)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("clamps at the career parole max (12), allows going low, and is a no-op when null", () => {
    const c = mchar({}, "prisoner", "inmate");
    c.mongooseState!.paroleThreshold = 10;

    applyEffects(c, [{ kind: "modifyParoleThreshold", delta: 5 }]);
    expect(c.mongooseState!.paroleThreshold).toBe(12); // min(12, 15)

    applyEffects(c, [{ kind: "modifyParoleThreshold", delta: 1 }]);
    expect(c.mongooseState!.paroleThreshold).toBe(12); // stays clamped

    applyEffects(c, [{ kind: "modifyParoleThreshold", delta: -4 }]);
    expect(c.mongooseState!.paroleThreshold).toBe(8); // no lower floor

    const nonParole = mchar({}, "agent", "lawEnforcement"); // paroleThreshold null
    applyEffects(nonParole, [{ kind: "modifyParoleThreshold", delta: 5 }]);
    expect(nonParole.mongooseState!.paroleThreshold).toBeNull();
  });
});
