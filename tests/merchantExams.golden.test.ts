// Characterization ("golden") locks for the Merchant Prince examination code
// (engine/acg/pathways/merchantPrince.ts) that Phase 7 will genericize but the
// existing suite does NOT cover:
//
//   1. Officer PROMOTION exam PASS grants the ladder row's skill (the rank
//      advance itself is locked by tests/merchantRules.test.ts; the skill grant
//      parsed from the ladder row is not).
//   2. Officer PROMOTION exam FAIL: no advance, and a queued reprimand penalty
//      (nextPromotionPenalty) is consumed (reset to 0) whether or not it passes.
//   3. Enlisted-on-Route COMMISSION exam PASS: grants the ladder's entry
//      officer rank + commissioned flag.
//   4. Enlisted-on-Route COMMISSION exam FAIL: stays enlisted.
//
// Already locked (NOT re-tested): the Available-Position gate that bars the
// promotion exam, the Department Test exception, and the Free-Trader position
// throw — all in tests/merchantRules.test.ts.
//
// Determinism mirrors merchantRules.test.ts: the Character (gender/name) draws
// from real Math.random at construction, so the Math.random spy is installed
// AFTER construction and governs only the exam rolls. Attributes are all 7
// (below the Int/Edu 9 DM thresholds) so exam DMs are 0 and target arithmetic
// is exact. The department ladders used (deck) come straight from the JSON:
//   deck: O0 Apprentice 6+, O1 4th Officer 6+ Navigation-1, O2 3rd Officer 6+
//         Admin-1, O3 2nd Officer 7+ Ship's Boat-1, ...

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { assertPathway, freshAcgState } from "../lib/traveller/engine/acg/state";
import { merchantEndOfTerm } from "../lib/traveller/engine/acg/pathways/merchantPrince";

afterEach(() => {
  vi.restoreAllMocks();
});

const skillLevel = (c: Character, name: string): number =>
  c.skills.find(([n]) => n === name)?.[1] ?? -1;
const promotions = (c: Character) =>
  c.events.filter((e) => e.kind === "promoted");
const rollEvents = (c: Character, rollName: string) =>
  c.events.filter((e) => e.kind === "roll" && e.rollName === rollName);

/** A merchant character on a large (non-Free-Trader) line, in the given
 *  department, at the given rank. `officer` toggles enlisted vs officer. */
function merchant(opts: {
  department: string;
  rankCode: string;
  officer: boolean;
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
  c.chargenModelId = "acg";
  c.acgPathway = "merchantPrince";
  const acg = freshAcgState("merchantPrince");
  assertPathway(acg, "merchantPrince");
  acg.lineType = "Sector-wide"; // a Large line -> department ladders (not Free Trader)
  acg.department = opts.department;
  acg.rankCode = opts.rankCode;
  acg.isOfficer = opts.officer;
  c.acgState = acg;
  return c;
}

describe("Merchant officer promotion exam (PM p. 61) — skill grant + failure/penalty", () => {
  it("PASS advances the rank AND grants the destination ladder row's skill", () => {
    // Deck O1 -> O2 exam target 6+; the O2 row grants Admin-1. Every 2d6 = 12
    // passes. (merchantRules locks the O2->O3 rank advance; this locks the
    // skill grant parsed from the ladder row.)
    const c = merchant({ department: "Deck", rankCode: "O1", officer: true });
    vi.spyOn(Math, "random").mockReturnValue(0.999);

    merchantEndOfTerm(c);

    const acg = c.requireMerchantAcg();
    expect(acg.rankCode).toBe("O2");
    expect(skillLevel(c, "Admin")).toBe(1);
    expect(promotions(c)).toHaveLength(1);
  });

  it("FAIL does not advance and consumes the queued reprimand penalty", () => {
    // Deck O2 -> O3 exam target 7+. A -2 reprimand penalty is queued; every
    // 2d6 = 2 gives 2 + (-2) = 0 < 7 -> fail. The negative penalty is consumed
    // (reset to 0) even on failure.
    const c = merchant({ department: "Deck", rankCode: "O2", officer: true });
    const acg = c.requireMerchantAcg();
    acg.nextPromotionPenalty = -2;
    vi.spyOn(Math, "random").mockReturnValue(0);

    merchantEndOfTerm(c);

    expect(acg.rankCode).toBe("O2");            // no advance
    expect(acg.nextPromotionPenalty).toBe(0);   // penalty consumed
    expect(promotions(c)).toHaveLength(0);
    expect(rollEvents(c, "Promotion")).toHaveLength(1);  // the exam DID roll
  });
});

describe("Merchant enlisted-on-Route commission exam (PM p. 61)", () => {
  it("PASS grants the entry officer rank and commissions the character", () => {
    // Enlisted deck crew that served a Route assignment this term. The deck
    // entry-officer row is O1 (target 6+); every 2d6 = 12 passes.
    const c = merchant({ department: "Deck", rankCode: "E1", officer: false });
    const acg = c.requireMerchantAcg();
    acg.perTerm.routeAssignmentThisTerm = true;
    expect(c.commissioned).toBe(false);
    vi.spyOn(Math, "random").mockReturnValue(0.999);

    merchantEndOfTerm(c);

    expect(acg.isOfficer).toBe(true);
    expect(acg.rankCode).toBe("O1");
    expect(c.commissioned).toBe(true);
    expect(
      c.events.some(
        (e) => e.kind === "promoted"
          && e.rank === "O1" && e.source === "Route-assignment promotion exam",
      ),
    ).toBe(true);
  });

  it("FAIL leaves the character enlisted and uncommissioned", () => {
    // Same setup; every 2d6 = 2 < 6 -> fail.
    const c = merchant({ department: "Deck", rankCode: "E1", officer: false });
    const acg = c.requireMerchantAcg();
    acg.perTerm.routeAssignmentThisTerm = true;
    vi.spyOn(Math, "random").mockReturnValue(0);

    merchantEndOfTerm(c);

    expect(acg.isOfficer).toBe(false);
    expect(acg.rankCode).toBe("E1");
    expect(c.commissioned).toBe(false);
    expect(promotions(c)).toHaveLength(0);
    expect(rollEvents(c, "Commission")).toHaveLength(1); // the exam DID roll
  });
});
