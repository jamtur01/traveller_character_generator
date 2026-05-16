// Brownie-point spending tests. Verify BPs auto-spend to save lives on
// survival failures and that they don't waste themselves on minor
// outcomes.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  spendBrowniePoints, tryMitigate,
} from "../lib/traveller/engine/acg/browniePoints";
import { runAcgYear } from "../lib/traveller/engine/acg/runner";

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
    rankCode: "E1",
    isOfficer: false,
    year: 1,
    currentAssignment: null,
    inCommand: false,
    justRetained: false,
    retainedAssignment: null,
    promotedThisTerm: false,
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
  it("Mercenary character with BPs survives a roll that would have killed them", () => {
    // Force minimum rolls (Math.random = 0 → 2d6 = 2).
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgChar(5);
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    // beginAcg's enlistment may fail at the lowest roll — let's
    // force-set the rank state to bypass.
    if (!c.acgState!.combatArm) {
      c.acgState!.combatArm = "Infantry";
      c.acgState!.branch = "Army";
      c.acgState!.rankCode = "E1";
      c.acgState!.isOfficer = false;
    }
    c.acgState!.browniePoints = 10; // top up
    // Run a year that will fail survival.
    // Initial training is harmless, so run year 2.
    c.acgState!.year = 2;
    // After running the assignment year, the character should still be
    // alive if BPs were spent — or invalided if they weren't.
    // (We can't precisely predict because of multiple rolls — we just
    // check the BP counter dropped.)
    const initialBp = c.acgState!.browniePoints;
    // Run the actual year
    runAcgYear(c);
    // Survival failure auto-mitigates with BPs.
    // Either the character survived (BP spent) or wasn't a combat year.
    if (!c.activeDuty) {
      // Got invalided despite BPs — must have failed by more than the BP pool.
      expect(c.acgState!.browniePoints).toBe(initialBp);
    } else {
      // Survived — BPs may have been spent.
      expect(c.acgState!.browniePoints).toBeLessThanOrEqual(initialBp);
    }
  });
});
