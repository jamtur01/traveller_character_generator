// Merchant Prince ACG rule regressions — locks the newly-consolidated
// available-position / promotion-exam behaviours against PM p. 63-65.
//
//   Rule 1 (PM p. 63): a Merchant OFFICER who fails the Available Position
//     throw serves one rank lower this year (effectiveRankCode) AND is barred
//     from that term's promotion exam (attemptMerchantPromotionExam returns
//     early logging a "promotionSkipped" statusChange). Passing the throw
//     clears effectiveRankCode and the exam runs normally.
//   Rule 2 (PM p. 65): a "Department Test" (canTakeDeptTest) overrides the bar
//     — the exam runs even while serving below rank — and consumes the flag.
//   Rule 3 (PM p. 64): a Free Trader officer throws 8+; failing it serves one
//     rank lower (O1 -> O0), passing it does not demote.
//
// Determinism: Character construction (gender/name) draws from the real
// Math.random; the Math.random spy is installed AFTER construction so it
// governs only the merchant rolls under test. Attributes are passed to the
// constructor (all 7, below the Int/Edu 9 DM thresholds) so every position
// DM is 0 and the target arithmetic is exact.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { assertPathway, freshAcgState } from "../lib/traveller/engine/acg/state";
import {
  merchantResolveAssignment,
  merchantEndOfTerm,
} from "../lib/traveller/engine/acg/pathways/merchantPrince";

afterEach(() => {
  vi.restoreAllMocks();
});

// One d6 face -> the Math.random value that produces it (roll = floor(x*6+1)).
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

// A Math.random implementation that returns the given faces in order, then
// falls through to a max roll (keeps later phases — survival etc. — passing).
function facesThenMax(...faces: number[]): () => number {
  let i = 0;
  return () => (i < faces.length ? d6(faces[i++]!) : d6(6));
}

function merchantOfficer(opts: {
  lineType: string;
  department: string;
  rankCode: string;
}): Character {
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7,
    },
  });
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.useAcg = true;
  c.acgPathway = "merchantPrince";
  const acg = freshAcgState("merchantPrince");
  assertPathway(acg, "merchantPrince");
  acg.lineType = opts.lineType;
  acg.department = opts.department;
  acg.rankCode = opts.rankCode;
  acg.isOfficer = true;
  c.acgState = acg;
  return c;
}

const statusChanges = (c: Character, kind_: string) =>
  c.events.filter((e) => e.kind === "statusChange" && e.kind_ === kind_);
const rollEvents = (c: Character, rollName: string) =>
  c.events.filter((e) => e.kind === "roll" && e.rollName === rollName);
const promotions = (c: Character) => c.events.filter((e) => e.kind === "promoted");

describe("Merchant available-position demotion + promotion-exam gate (PM p. 63)", () => {
  // CORE regression + teeth anchor. Deck/large-line target is 9+; every 2d6
  // lands on 2 (min), so the position throw fails and the exam is barred.
  it("failed available-position throw demotes for the year and bars the promotion exam", () => {
    const c = merchantOfficer({ lineType: "Sector-wide", department: "Deck", rankCode: "O2" });
    vi.spyOn(Math, "random").mockReturnValue(0); // every 2d6 = 2

    merchantResolveAssignment(c, "Route");
    const acg = c.requireMerchantAcg();
    // Deck largeLine 9+: 2 < 9 -> serve one rank lower (O2 -> O1) this year.
    expect(acg.effectiveRankCode).toBe("O1");

    merchantEndOfTerm(c);
    // Permanent rank never changes; the exam is skipped (not rolled).
    expect(acg.rankCode).toBe("O2");
    expect(statusChanges(c, "promotionSkipped")).toHaveLength(1);
    expect(rollEvents(c, "Promotion")).toHaveLength(0);
    expect(promotions(c)).toHaveLength(0);
  });

  // Passing branch: every 2d6 = 12 clears the demotion, so the exam runs and
  // (O2 -> O3, target 7+) passes.
  it("passed available-position throw clears the demotion and lets the exam run", () => {
    const c = merchantOfficer({ lineType: "Sector-wide", department: "Deck", rankCode: "O2" });
    vi.spyOn(Math, "random").mockReturnValue(0.999); // every 2d6 = 12

    merchantResolveAssignment(c, "Route");
    const acg = c.requireMerchantAcg();
    expect(acg.effectiveRankCode).toBeNull();

    merchantEndOfTerm(c);
    expect(statusChanges(c, "promotionSkipped")).toHaveLength(0);
    expect(rollEvents(c, "Promotion")).toHaveLength(1);
    expect(acg.rankCode).toBe("O3");
    expect(promotions(c)).toHaveLength(1);
  });
});

describe("Merchant Department Test exception (PM p. 65)", () => {
  // Serving below rank (effectiveRankCode set) would normally bar the exam,
  // but a Department Test lets it run regardless of position — and is a
  // one-shot flag consumed by the attempt.
  it("Department Test runs the exam while below rank and consumes the flag", () => {
    const c = merchantOfficer({ lineType: "Sector-wide", department: "Deck", rankCode: "O2" });
    const acg = c.requireMerchantAcg();
    acg.effectiveRankCode = "O1"; // failed available-position check this year
    acg.perTerm.canTakeDeptTest = true; // PM p. 65 special-duty "Department Test" result
    vi.spyOn(Math, "random").mockReturnValue(0.999); // exam (O2 -> O3, 7+) passes

    merchantEndOfTerm(c);

    expect(statusChanges(c, "promotionSkipped")).toHaveLength(0);
    expect(rollEvents(c, "Promotion")).toHaveLength(1);
    expect(acg.rankCode).toBe("O3");
    expect(promotions(c)).toHaveLength(1);
    expect(acg.perTerm.canTakeDeptTest).toBe(false); // consumed
  });
});

describe("Free Trader available-position throw (PM p. 64)", () => {
  // Free Trader officers throw 8+ (freeTrader.target). Force the position 2d6
  // to 2 (fail) but let later phases pass so the character survives the year.
  it("failed 8+ throw serves one rank lower (O1 -> O0)", () => {
    const c = merchantOfficer({ lineType: "Free Trader", department: "Free Trader", rankCode: "O1" });
    vi.spyOn(Math, "random").mockImplementation(facesThenMax(1, 1)); // position 2d6 = 2

    merchantResolveAssignment(c, "Route");

    expect(c.requireMerchantAcg().effectiveRankCode).toBe("O0");
  });

  it("passed 8+ throw is not demoted", () => {
    const c = merchantOfficer({ lineType: "Free Trader", department: "Free Trader", rankCode: "O1" });
    vi.spyOn(Math, "random").mockReturnValue(0.999); // position 2d6 = 12 >= 8

    merchantResolveAssignment(c, "Route");

    expect(c.requireMerchantAcg().effectiveRankCode).toBeNull();
  });
});
