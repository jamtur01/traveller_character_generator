// Brownie-point spending tests. Verify BPs auto-spend to save lives on
// survival failures and that they don't waste themselves on minor
// outcomes.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  spendBrowniePoints, tryMitigate, runCourtMartial,
} from "../lib/traveller/engine/acg/awards";
afterEach(() => { vi.restoreAllMocks(); });

function freshAcgChar(bp = 5): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  c.acgState = {
    pathway: "mercenary",
    combatArm: "",
    branch: "",
    mos: "",
    rankCode: "E1",
    isOfficer: false,
    year: 1,
    currentAssignment: null,
    inCommand: false,
    justRetained: false,
    retainedAssignment: null,
    perTerm: { promotedThisTerm: false },
    injuredThisYear: false,
    assignmentHistory: [],
    combatRibbons: 0,
    commandClusters: 0,
    schoolsAttended: [],
    decorations: [],
    browniePoints: bp,
    browniePointsSpent: 0,
    decorationDmStrategy: 0,
  };
  return c;
}

describe("tryMitigate (auto mode)", () => {
  it("does nothing when no acgState", () => {
    const c = new Character();
    const out = tryMitigate(c, {
      rollName: "survival", rollValue: 4, dm: 0, target: 6, margin: -2,
      consequence: "test",
    });
    expect(out.spent).toBe(0);
  });

  it("does nothing for a passed roll", () => {
    const c = freshAcgChar(5);
    const out = tryMitigate(c, {
      rollName: "survival", rollValue: 8, dm: 0, target: 6, margin: 2,
      consequence: "test",
    });
    expect(out.spent).toBe(0);
    expect(c.browniePoints).toBe(5);
  });

  it("spends BP to save a failed survival (margin -2 → margin 0)", () => {
    const c = freshAcgChar(5);
    const out = tryMitigate(c, {
      rollName: "survival", rollValue: 4, dm: 0, target: 6, margin: -2,
      consequence: "invalided out",
    });
    expect(out.spent).toBe(2);
    expect(out.newMargin).toBe(0);
    expect(c.browniePoints).toBe(3);
    expect(c.acgState!.browniePointsSpent).toBe(2);
  });

  it("does not spend if not enough BPs to fully save", () => {
    const c = freshAcgChar(1);
    const out = tryMitigate(c, {
      rollName: "survival", rollValue: 2, dm: 0, target: 6, margin: -4,
      consequence: "invalided out",
    });
    expect(out.spent).toBe(0);
    expect(out.newMargin).toBe(-4);
    expect(c.browniePoints).toBe(1);
  });

  it("does NOT spend on decoration / promotion / skills failures", () => {
    const c = freshAcgChar(5);
    const out1 = tryMitigate(c, {
      rollName: "decoration", rollValue: 5, dm: 0, target: 10, margin: -5,
      consequence: "no medal",
    });
    const out2 = tryMitigate(c, {
      rollName: "promotion", rollValue: 5, dm: 0, target: 8, margin: -3,
      consequence: "no promotion",
    });
    const out3 = tryMitigate(c, {
      rollName: "skills", rollValue: 5, dm: 0, target: 7, margin: -2,
      consequence: "no skill",
    });
    expect(out1.spent).toBe(0);
    expect(out2.spent).toBe(0);
    expect(out3.spent).toBe(0);
    expect(c.browniePoints).toBe(5);
  });

  it("does spend on court martial failures (mitigation)", () => {
    const c = freshAcgChar(5);
    const out = tryMitigate(c, {
      rollName: "courtMartial", rollValue: 0, dm: 0, target: 3, margin: -3,
      consequence: "Dishonorable Discharge",
    });
    expect(out.spent).toBe(3);
  });
});

describe("spendBrowniePoints (explicit player spending)", () => {
  it("spends the requested amount and adjusts margin", () => {
    const c = freshAcgChar(4);
    const newMargin = spendBrowniePoints(c, 2, -3);
    expect(newMargin).toBe(-1);
    expect(c.browniePoints).toBe(2);
    expect(c.acgState!.browniePointsSpent).toBe(2);
  });

  it("clamps spend to available BPs", () => {
    const c = freshAcgChar(1);
    const newMargin = spendBrowniePoints(c, 5, -3);
    // Only 1 BP available → spends 1, new margin -2.
    expect(newMargin).toBe(-2);
    expect(c.browniePoints).toBe(0);
  });

  it("0 spending is a no-op", () => {
    const c = freshAcgChar(5);
    const newMargin = spendBrowniePoints(c, 0, -3);
    expect(newMargin).toBe(-3);
    expect(c.browniePoints).toBe(5);
  });
});

describe("End-to-end: BP saves a character's life", () => {
  it("Mercenary fails Raid survival by 4, spends 4 BP to survive (margin → 0)", async () => {
    // Mercenary "Raid" assignment has survival target 6+ on the
    // infantryCavalryArtillery table. Force every d6=1 (Math.random=0)
    // so the 2d6 survival roll is 2 → margin -4. The character has 10
    // BPs; auto-policy spends 4 (life-or-death) to push margin to 0.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { mercenaryResolveAssignment } = await import(
      "../lib/traveller/engine/acg/pathways/mercenary"
    );
    const c = freshAcgChar(0);
    c.acgState!.browniePoints = 10;
    c.requireMercenaryAcg().combatArm = "Infantry";
    c.requireMercenaryAcg().branch = "Army";
    c.resumeActive();
    mercenaryResolveAssignment(c, "Raid");
    // BP spent: margin was -4, auto-mitigate brings it to 0.
    expect(c.acgState!.browniePoints).toBe(6); // 10 - 4 spent
    expect(c.acgState!.browniePointsSpent).toBe(4);
    // Character survives (not invalided).
    expect(c.activeDuty).toBe(true);
  });

  it("Mercenary with only 2 BPs cannot afford to fully save margin -4 → invalided out", async () => {
    // Same scenario but only 2 BPs available. Auto-mitigate sees it
    // can't bring margin to 0 (needs 4, has 2) → spends 0, leaves character
    // to be invalided out by the pathway.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { mercenaryResolveAssignment } = await import(
      "../lib/traveller/engine/acg/pathways/mercenary"
    );
    const c = freshAcgChar(2);
    c.requireMercenaryAcg().combatArm = "Infantry";
    c.requireMercenaryAcg().branch = "Army";
    c.resumeActive();
    mercenaryResolveAssignment(c, "Raid");
    expect(c.acgState!.browniePoints).toBe(2); // BPs untouched
    expect(c.activeDuty).toBe(false);          // invalided
  });
});

// H5 regression — court-martial BP mitigation could never reach the two
// best outcomes.
//
// Bug: the mitigation loop was `while (r > 1)`, so spending BPs could push
// the result down to roll 1 ("Reprimand; -3") at best — roll 0 ("Reprimand;
// -1") and roll -1 ("Case dismissed") were unreachable no matter how many
// BPs were available. The fix drives to `Math.min(dieResults.roll)` (= -1),
// spending one BP per step within the pool.
//
// Determinism: enlisted characters skip the officer guilt-avoid step, so the
// only die roll is the 1D result roll. Math.random pinned to d6 = 6 makes
// that raw result 6 (no situational DMs at rank E4, no assignment passed).
// "Case dismissed" / "Reprimand" apply no further rolls.
//
// Teeth: under the old cap the outcome stopped at roll 1 ("Reprimand; -3"),
// spending 5 BP (test 1) or leaving 1 BP (test 2). Both the outcome string
// and the exact BP accounting below fail against that behavior.
describe("H5: court-martial BP mitigation reaches the lowest defined outcome", () => {
  it("ample BP drives the result to 'Case dismissed' (roll -1)", () => {
    const c = freshAcgChar(20);
    c.acgState!.rankCode = "E4"; // enlisted → auto-guilty, no guilt-avoid roll
    c.acgState!.bpAutoPolicy = "conservative";
    vi.spyOn(Math, "random").mockReturnValue(5 / 6 + 0.001); // d6 = 6 → raw r = 6
    runCourtMartial(c);
    const cm = c.events.find((e) => e.kind === "courtMartial");
    expect(cm).toMatchObject({ kind: "courtMartial", result: "Case dismissed" });
    // 6 → -1 is 7 steps down: 7 BP spent from 20, leaving 13.
    expect(c.acgState!.browniePoints).toBe(13);
    expect(c.acgState!.browniePointsSpent).toBe(7);
  });

  it("exactly 6 BP reaches 'Reprimand; -1 to next promotion' (roll 0)", () => {
    const c = freshAcgChar(6);
    c.acgState!.rankCode = "E4";
    c.acgState!.bpAutoPolicy = "aggressive";
    vi.spyOn(Math, "random").mockReturnValue(5 / 6 + 0.001); // d6 = 6 → raw r = 6
    runCourtMartial(c);
    const cm = c.events.find((e) => e.kind === "courtMartial");
    expect(cm).toMatchObject({
      kind: "courtMartial",
      result: "Reprimand; -1 to next promotion",
    });
    // 6 → 0 is 6 steps down: all 6 BP spent (loop stops when the pool empties).
    expect(c.acgState!.browniePoints).toBe(0);
    expect(c.acgState!.browniePointsSpent).toBe(6);
    // Roll-0 reprimand applies a -1 penalty to the next promotion roll.
    expect(c.acgState!.nextPromotionPenalty).toBe(-1);
  });
});
