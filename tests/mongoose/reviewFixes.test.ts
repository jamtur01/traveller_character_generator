import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { enterCareer } from "@/lib/traveller/engine/mongoose/enlist";
import { skillLevel } from "@/lib/traveller/engine/mongoose/skills";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";
import { musterOut } from "@/lib/traveller/engine/mongoose/muster";
import { applyEffects, resolveMishap } from "@/lib/traveller/engine/mongoose/effects";
import { mongooseModel } from "@/lib/traveller/chargen/models/mongoose";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

// Math.random value that makes the next single die show face `v` (1-6).
const d6 = (v: number) => (v - 1) / 6 + 0.001;

const BASE: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

const ENLIST: EnlistOptions = {
  verbose: false, preferredService: "random", acgService: "army", acgCombatArm: "",
  acgFleet: "imperialNavy", acgDivision: "field", acgLineType: "", acgSubsectorTech: "",
  acgMerchantAcademy: false,
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

describe("H2: compound muster benefit routes skills vs equipment (Core p.46)", () => {
  function inCareer(career: string, assignment: string): Character {
    const c = mkChar();
    c.mongooseState!.career = career;
    c.mongooseState!.assignment = assignment;
    c.mongooseState!.termsInCareer = 1; // rank 0 -> exactly one benefit roll
    return c;
  }

  it("Navy 'Personal Vehicle or Ship Share' records equipment, not a skill", () => {
    const c = inCareer("navy", "lineCrew");
    // column pick -> Material (idx 1); 1D=1 -> muster row 1; " or " pick -> idx 0
    mockRandom([d6(4), d6(1), d6(1)]);
    musterOut(c);
    expect(c.benefits).toContain("Personal Vehicle");
    expect(skillLevel(c, "Personal Vehicle")).toBe(-1); // never recorded as a skill
    expect(skillLevel(c, "Ship Share")).toBe(-1);
  });

  it("Prisoner 'Deception, Persuade or Stealth' grants the chosen skill", () => {
    const c = inCareer("prisoner", "inmate");
    // column -> Material; 1D=3 -> muster row 3; " or " pick -> idx 0 (Deception)
    mockRandom([d6(4), d6(3), d6(1)]);
    musterOut(c);
    expect(skillLevel(c, "Deception")).toBe(1);
    expect(c.benefits).not.toContain("Deception");
  });

  it("Prisoner 'Deception, Persuade and Stealth' grants every listed skill", () => {
    const c = inCareer("prisoner", "inmate");
    c.mongooseState!.pendingDms.benefit.push({ dm: 1, scope: "next" }); // 6 + 1 -> row 7
    // column -> Material; 1D=6 (+1 DM) -> muster row 7 (the " and " row)
    mockRandom([d6(4), d6(6)]);
    musterOut(c);
    expect(skillLevel(c, "Deception")).toBe(1);
    expect(skillLevel(c, "Persuade")).toBe(1);
    expect(skillLevel(c, "Stealth")).toBe(1);
  });
});

describe("b#11: mishap keep-benefit branch survives forced ejection (Core p.18)", () => {
  function inCareer(career: string, assignment: string): Character {
    const c = mkChar();
    c.mongooseState!.career = career;
    c.mongooseState!.assignment = assignment;
    return c;
  }

  it("Agent mishap 3 with a successful Advocate check keeps the benefit roll", () => {
    const c = inCareer("agent", "lawEnforcement");
    // 1D mishap = 3; then the Advocate 8+ check rolls 2D = 12 (success).
    mockRandom([d6(3), d6(6), d6(6)]);
    resolveMishap(c, true);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.benefitKept).toBe(true);
    expect(c.mongooseState!.perTerm.loseBenefitThisTerm).toBe(false);
  });

  it("Agent mishap 3 with a failed Advocate check loses the benefit as usual", () => {
    const c = inCareer("agent", "lawEnforcement");
    // 1D mishap = 3; Advocate check 2D = 2 (fail); onFailure rollForceCareer 2D = 8 (misses).
    mockRandom([d6(3), d6(1), d6(1), d6(4), d6(4)]);
    resolveMishap(c, true);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.benefitKept).toBe(false);
    expect(c.mongooseState!.perTerm.loseBenefitThisTerm).toBe(true);
  });

  it("Army mishap 4 choosing the whitewash (keep-benefit) branch keeps the benefit", () => {
    const c = inCareer("army", "infantry");
    // 1D mishap = 4; chooseEffect auto-picks Option 2 (leaveCareer keepBenefit).
    mockRandom([d6(4), d6(4)]);
    resolveMishap(c, true);
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.benefitKept).toBe(true);
    expect(c.mongooseState!.perTerm.loseBenefitThisTerm).toBe(false);
  });
});

describe("M1: check-option EDU DM + typo guard (Core p.61)", () => {
  it("an 'EDU' option contributes the EDU characteristic DM", () => {
    const c = mkChar({ education: 12 }); // EDU 12 -> DM +2
    mockRandom([d6(3), d6(3)]); // 2D = 6; 6 + 2 = 8 >= target 8 -> success
    applyEffects(c, [{
      kind: "check", options: ["EDU"], target: 8,
      onSuccess: [{ kind: "gainSkill", skill: "Investigate", level: 2 }],
      onFailure: [],
    }]);
    const roll = c.events.find((e) => e.kind === "roll");
    expect(roll).toMatchObject({ dm: 2, succeeded: true });
    expect(skillLevel(c, "Investigate")).toBe(2);
  });

  it("the same roll fails at EDU 7 (DM 0), proving the DM was really applied", () => {
    const c = mkChar({ education: 7 }); // EDU 7 -> DM 0
    mockRandom([d6(3), d6(3)]); // 2D = 6; 6 + 0 = 6 < target 8 -> failure
    applyEffects(c, [{
      kind: "check", options: ["EDU"], target: 8,
      onSuccess: [{ kind: "gainSkill", skill: "Investigate", level: 2 }],
      onFailure: [],
    }]);
    expect(skillLevel(c, "Investigate")).toBe(-1);
  });

  it("a full characteristic-name option ('education') throws", () => {
    const c = mkChar();
    mockRandom([d6(3), d6(3)]);
    expect(() => applyEffects(c, [{
      kind: "check", options: ["education"], target: 8, onSuccess: [], onFailure: [],
    }])).toThrow(/not a valid characteristic abbreviation/);
  });

  it("an abbreviation-shaped unknown option ('PSI') throws", () => {
    const c = mkChar();
    mockRandom([d6(3), d6(3)]);
    expect(() => applyEffects(c, [{
      kind: "check", options: ["PSI"], target: 8, onSuccess: [], onFailure: [],
    }])).toThrow(/not a valid characteristic abbreviation/);
  });

  it("a genuine skill option ('Advocate') still scores by level, no throw", () => {
    const c = mkChar();
    c.addSkill("Advocate", 3, "test");
    mockRandom([d6(3), d6(3)]); // 2D = 6; 6 + 3 = 9 >= target 8 -> success
    applyEffects(c, [{
      kind: "check", options: ["Advocate"], target: 8,
      onSuccess: [{ kind: "gainSkill", skill: "Streetwise", level: 1 }],
      onFailure: [],
    }]);
    const roll = c.events.find((e) => e.kind === "roll");
    expect(roll).toMatchObject({ dm: 3, succeeded: true });
    expect(skillLevel(c, "Streetwise")).toBe(1);
  });
});

describe("M2: pending DMs reset on career entry (Core p.52)", () => {
  it("a career-scoped ('any') survival DM does not leak into the next career", () => {
    const c = mkChar();
    c.mongooseState!.careerCount = 1; // subsequent career
    c.mongooseState!.pendingDms.survival.push({ dm: 1, scope: "any" });
    c.mongooseState!.pendingDms.advancement.push({ dm: 2, scope: "any" });
    mockRandom([d6(3)]); // subsequent-career basic-training skill pick
    enterCareer(c, "agent", "lawEnforcement");
    expect(c.mongooseState!.pendingDms).toEqual({
      qualification: [], survival: [], advancement: [], benefit: [],
    });
  });
});

describe("any-assignment prompt on draft/forced/offered entry (Core p.20)", () => {
  it("a drafted 'any' row prompts for the assignment (auto picks a non-default index)", () => {
    const c = mkChar();
    c.mongooseState!.careerCount = 1; // between careers -> skip background skills
    c.mongooseState!.mustDraft = true;
    // draft 1D = 2 -> Army/any; assignment pick idx 2 -> "cavalry" (proves a real prompt)
    mockRandom([d6(2), d6(6)]);
    mongooseModel.execute(c, { kind: "enlist", opts: ENLIST });
    expect(c.mongooseState!.career).toBe("army");
    expect(c.mongooseState!.assignment).toBe("cavalry"); // not assignments[0] ("support")
  });

  it("a forced career prompts for the assignment (auto picks a non-default index)", () => {
    const c = mkChar();
    c.mongooseState!.careerCount = 1;
    c.mongooseState!.forcedNextCareer = "prisoner";
    mockRandom([d6(6)]); // assignment pick idx 2 -> "fixer"
    mongooseModel.execute(c, { kind: "enlist", opts: ENLIST });
    expect(c.mongooseState!.career).toBe("prisoner");
    expect(c.mongooseState!.assignment).toBe("fixer"); // not assignments[0] ("inmate")
  });
});
