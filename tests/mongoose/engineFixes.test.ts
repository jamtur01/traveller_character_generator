import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { applyEffects } from "@/lib/traveller/engine/mongoose/effects";
import { resolveAdvancementPhase } from "@/lib/traveller/engine/mongoose/advancement";
import { promote, currentLadder } from "@/lib/traveller/engine/mongoose/ranks";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";
import { mongooseModel } from "@/lib/traveller/chargen/models/mongoose";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";

// A Math.random value that makes the next single die show face `v` (1-6): the
// engine's Rng draws Math.random directly for an unseeded Character.
const d6 = (v: number) => (v - 1) / 6 + 0.001;

const BASE: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

// The mongoose model ignores the ACG-only fields; only `verbose` is read.
const ENLIST: EnlistOptions = {
  verbose: false,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

function mkChar(over: Partial<Attributes> = {}): Character {
  const c = new Character({ attributes: { ...BASE, ...over } });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  return c;
}

// Install the mock AFTER construction (the constructor consumes real randomness);
// unpinned draws fall back to a face-3 die.
function mockRandom(seq: number[], fallback = d6(3)): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? fallback);
}

afterEach(() => vi.restoreAllMocks());

describe("rollDraft routing (H2, Core p.20)", () => {
  it("enters the career fixed by the 1D Draft table, not a player choice", () => {
    const c = mkChar();
    c.mongooseState!.careerCount = 1; // between careers -> skip background skills
    c.mongooseState!.mustDraft = true;
    mockRandom([d6(6)]); // 1D Draft roll = 6 -> Agent / Law Enforcement
    mongooseModel.execute(c, { kind: "enlist", opts: ENLIST });
    expect(c.mongooseState!.career).toBe("agent");
    expect(c.mongooseState!.assignment).toBe("lawEnforcement");
    expect(c.mongooseState!.mustDraft).toBe(false);
    expect(c.events.find((e) => e.kind === "drafted")).toMatchObject({ service: "Agent" });
  });
});

describe("offerCareer routing (H3)", () => {
  it("takes an offered career next term with no qualification roll (auto Accept)", () => {
    const c = mkChar({ dexterity: 4 }); // Rogue is DEX 6+: would fail if a roll happened
    c.mongooseState!.careerCount = 1;
    c.mongooseState!.offeredNextCareer = "rogue";
    mockRandom([d6(1), d6(1)]); // Accept (idx 0), then assignment pick (idx 0)
    mongooseModel.execute(c, { kind: "enlist", opts: ENLIST });
    expect(c.mongooseState!.career).toBe("rogue");
    expect(c.mongooseState!.assignment).toBe(getCareer(c, "rogue").assignments[0]!.id);
    expect(c.mongooseState!.offeredNextCareer).toBeNull();
    const qual = c.events.filter((e) => e.kind === "roll" && e.rollName.startsWith("Qualification"));
    expect(qual).toHaveLength(0);
  });
});

describe("forced-career effects & routing (H1, M1, Core p.52)", () => {
  it("forceCareer sets both forcedNextCareer and perTerm.mustLeave", () => {
    const c = mkChar();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    applyEffects(c, [{ kind: "forceCareer", career: "prisoner" }]);
    expect(c.mongooseState!.forcedNextCareer).toBe("prisoner");
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
  });

  it("rollForceCareer forces the career when the parsed 2D roll hits results", () => {
    const c = mkChar();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    mockRandom([d6(1), d6(1)]); // "2D" -> 2 dice -> 1+1 = 2, in results [2]
    applyEffects(c, [{ kind: "rollForceCareer", dice: "2D", results: [2], career: "prisoner" }]);
    expect(c.mongooseState!.forcedNextCareer).toBe("prisoner");
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
  });

  it("rollForceCareer leaves state untouched when the 2D roll misses results", () => {
    const c = mkChar();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    mockRandom([d6(4), d6(3)]); // 2D = 7, not in results [2]
    applyEffects(c, [{ kind: "rollForceCareer", dice: "2D", results: [2], career: "prisoner" }]);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();
    expect(c.mongooseState!.perTerm.mustLeave).toBe(false);
  });

  it("routes a forced career at the next entry, bypassing the forcedOnly exclusion", () => {
    const c = mkChar();
    c.mongooseState!.careerCount = 1; // between careers
    c.mongooseState!.forcedNextCareer = "prisoner"; // Prisoner is forcedOnly
    mockRandom([d6(1)]); // assignment pick (idx 0); parole + basic-skill use the fallback
    mongooseModel.execute(c, { kind: "enlist", opts: ENLIST });
    expect(c.mongooseState!.career).toBe("prisoner");
    expect(c.mongooseState!.assignment).toBe(getCareer(c, "prisoner").assignments[0]!.id);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();
  });
});

describe("ejection overrides must-continue in doRunTerm (M2)", () => {
  it("musters the character out when a term sets both mustLeave and mustContinue", () => {
    // Merchant/Merchant Marine: an event ejects (rollForceCareer -> Prisoner sets
    // mustLeave) while advancement rolls a natural 12 (sets mustContinue). Both
    // flags are true at the leave decision; ejection must win.
    const c = mkChar();
    c.mongooseState!.career = "merchant";
    c.mongooseState!.assignment = "merchantMarine";
    c.mongooseState!.termsInCareer = 1;
    c.terms = 0; // stays below ageing (term 4)
    mockRandom([
      d6(5), d6(5), // Survival 2D = 10 -> success (not natural 2)
      d6(4), d6(4), // Event 2D = 8 -> gainSkillChoice + rollForceCareer(Prisoner)
      d6(3),        // gainSkillChoice auto-pick
      d6(1), d6(1), // rollForceCareer "2D" = 2 -> mustLeave + forcedNextCareer
      d6(6), d6(6), // Advancement 2D = 12 -> natural 12 -> mustContinue (+ promote)
    ]);
    const result = mongooseModel.execute(c, { kind: "runTerm" });
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.perTerm.mustContinue).toBe(true);
    expect(result.snapshot.phase).toBe("career"); // left the career (pre-fix retained: "term")
    expect(c.mongooseState!.career).toBeNull();
    expect(c.mongooseState!.forcedNextCareer).toBe("prisoner");
  });
});

describe("immediate escape leaves the career, skipping advancement (doRunTerm, L2)", () => {
  it("skips advancement + skill training when an event sets mustLeave with no forced next career", () => {
    // Prisoner term, Inmate assignment (Survival END 7+). Event 3 is the escape:
    // pass the Stealth/Deception 10+ check and leaveCareer fires — mustLeave WITHOUT
    // a forcedNextCareer. That is an IMMEDIATE leave, so the term ends before the
    // advancement + skill step (Core p.57 "you leave this career"). Contrast: the
    // M2 arrest sets forcedNextCareer, so its term's advancement still runs.
    const c = mkChar();
    c.mongooseState!.career = "prisoner";
    c.mongooseState!.assignment = "inmate";
    c.mongooseState!.termsInCareer = 1;
    c.mongooseState!.paroleThreshold = 8; // in a parole career; escape bypasses parole
    c.terms = 0; // stays below ageing (term 4)
    mockRandom([
      d6(1),        // Prisoner re-picks this term's assignment (pool = [current])
      d6(4), d6(4), // Survival 2D = 8 vs END 7+ -> survives (not a natural 2)
      d6(1), d6(2), // Event 2D = 3 -> "you have the opportunity to escape"
      d6(1),        // chooseEffect: take the escape (Option 1)
      d6(6), d6(6), // escape check 2D = 12 vs Stealth/Deception 10+ -> success
    ]); // muster-out benefit rolls fall to the d6(3) fallback -> Cash column (no skill)
    const result = mongooseModel.execute(c, { kind: "runTerm" });

    // The escape fired and set an immediate leave, not a forced next-term transfer.
    expect(c.events.find((e) => e.kind === "mongooseEvent" && e.roll === 3)).toBeDefined();
    expect(c.mongooseState!.perTerm.mustLeave).toBe(true);
    expect(c.mongooseState!.forcedNextCareer).toBeNull();

    // (1) No advancement this term: a prisoner's advancement is the parole check,
    // which logs an "Advancement" roll; the skipped skill step trained nothing.
    // (If the guard drops the `forcedNextCareer === null` clause, advancement runs
    // on escape and this roll appears — the test reddens.)
    expect(c.events.filter((e) => e.kind === "roll" && e.rollName === "Advancement")).toHaveLength(0);
    expect(c.skills).toHaveLength(0);

    // (2) The character left the career this term.
    expect(result.snapshot.phase).toBe("career");
    expect(c.mongooseState!.career).toBeNull();
  });
});

describe("optional commission in resolveAdvancementPhase (M4, Core pp.18-19)", () => {
  it("auto mode attempts the preferred commission and can commission", () => {
    const c = mkChar({ social: 10 });
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    c.mongooseState!.termsInCareer = 1;
    mockRandom([d6(1), d6(6), d6(6)]); // pick "Attempt"; Commission 2D = 12 -> success
    resolveAdvancementPhase(c);
    expect(c.mongooseState!.commissioned).toBe(true);
    expect(c.mongooseState!.rank).toBe(1);
    expect(c.events.find((e) => e.kind === "mongooseRank")).toMatchObject({ commission: true, rank: 1 });
    expect(c.events.find((e) => e.kind === "roll" && e.rollName === "Commission"))
      .toMatchObject({ succeeded: true });
  });

  it("interactive mode surfaces a mongooseCommission choice at the frontier", () => {
    const c = mkChar({ social: 10 });
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    c.mongooseState!.termsInCareer = 1;
    c.choiceMode = "interactive";
    let paused = false;
    try {
      resolveAdvancementPhase(c);
    } catch (e) {
      if (!(e instanceof ChoicePendingError)) throw e;
      paused = true;
    }
    expect(paused).toBe(true);
    expect(c.pendingChoices).toHaveLength(1);
    expect(c.pendingChoices[0]).toMatchObject({
      kind: "mongooseCommission", label: "Attempt a commission?",
    });
  });

  it("declining the commission falls through to a normal advancement roll", () => {
    const c = mkChar({ education: 12 }); // Support advancement EDU 7+; EDU 12 -> DM +2
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    c.mongooseState!.termsInCareer = 1;
    c.choiceMode = "interactive";
    c.decisionCursor = { resolutions: [1], pos: 0 }; // option index 1 = "Decline"
    mockRandom([d6(3), d6(3)]); // Advancement 2D = 6 -> 6 + 2 = 8 >= 7 -> success
    resolveAdvancementPhase(c);
    expect(c.mongooseState!.commissioned).toBe(false);
    expect(c.mongooseState!.rank).toBe(1);
    expect(c.events.find((e) => e.kind === "roll" && e.rollName === "Advancement"))
      .toMatchObject({ succeeded: true });
    expect(c.events.some((e) => e.kind === "roll" && e.rollName === "Commission")).toBe(false);
    expect(c.events.find((e) => e.kind === "mongooseRank")).toMatchObject({ commission: false, rank: 1 });
  });

  it("a commission attempt no longer drains the advancement-scoped DM", () => {
    // SOC 5 (commission DM -1) fails the commission; EDU 7 (advancement DM 0).
    // The +2 advancement DM must survive the commission attempt and land on the
    // advancement roll (pre-fix the commission consumed it, leaving dm 0).
    const c = mkChar({ social: 5 });
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    c.mongooseState!.termsInCareer = 1;
    c.mongooseState!.pendingDms.advancement.push({ dm: 2, scope: "next" });
    mockRandom([d6(1), d6(2), d6(3), d6(3), d6(4)]);
    // pick "Attempt"; Commission 2D = 5 (-1 => 4 < 8, fail); Advancement 2D = 7
    resolveAdvancementPhase(c);
    expect(c.mongooseState!.commissioned).toBe(false);
    expect(c.events.find((e) => e.kind === "roll" && e.rollName === "Commission"))
      .toMatchObject({ succeeded: false });
    expect(c.events.find((e) => e.kind === "roll" && e.rollName === "Advancement"))
      .toMatchObject({ dm: 2, succeeded: true });
  });
});

describe("promote caps rank at the ladder maximum (L2)", () => {
  it("keeps a max-rank character at max rank instead of overshooting", () => {
    const c = mkChar();
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    c.mongooseState!.commissioned = true; // advance on the officer ladder
    const ladder = currentLadder(c);
    const maxRank = Math.max(...ladder.map((r) => r.rank));
    c.mongooseState!.rank = maxRank;
    promote(c);
    expect(c.mongooseState!.rank).toBe(maxRank); // pre-fix: maxRank + 1
    const topRow = ladder.find((r) => r.rank === maxRank);
    expect(topRow?.title).toBe("General");
    expect(topRow?.benefit).toBeTruthy(); // top-rank title/benefit band preserved
    expect(ladder.find((r) => r.rank === maxRank + 1)).toBeUndefined();
    expect(c.events.filter((e) => e.kind === "mongooseRank")).toHaveLength(0);
  });
});
