// Court-martial behavior GOLDEN LOCK. Characterizes the EXACT end-state of
// every one of the 12 common.courtMartial.dieResults rows (-1..10, PM p. 47)
// against the CURRENT prose-regex applier (awards.ts applyCourtMartialResult
// et al.). Phase 3 of the pathway-as-JSON rewrite replaces that regex
// interpreter with structured effects[] + a generic applier; this file must
// stay GREEN across that refactor, so it pins every observable consequence:
// rank ladder movement, promotion/muster penalties, pension forfeit, bounty,
// guards killed, jail-years aging (age + imprisonmentAgeYears summand),
// jail-months (year consumed, no aging) and the terminal disposition
// (active / discharged / escaped-retired). If the effects[] rewrite changes
// any of these, a row fails — that is the point.
//
// Determinism. The character's Rng is UNSEEDED, so every draw flows through
// Math.random; we spy on it AFTER construction (name/gender generation draws
// harmlessly from real randomness first) and queue one value per draw with
// d6(v): the value that makes Rng.roll(1) yield die v. It works out of range
// too — d6(7)..d6(10) and d6(0)/d6(-1) force die 7..10 / 0 / -1 — so a single
// 1D result roll can land on any dieResults index without leaning on
// situational DMs. Enlisted characters are auto-guilty (PM p. 47), so the
// officer guilt-avoid roll is skipped and the first draw IS the result roll;
// browniePoints = 0 disables BP mitigation, so the forced die IS the result.
// Draw order is therefore [resultDie, ...subDice] where subDice feed the
// jail-months (2D), jail-years (1D/2D) and guards (1D) rolls in turn.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import { runCourtMartial } from "../lib/traveller/engine/acg/awards";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Math.random value that makes Rng.roll(1) return die `v`:
 *  floor(d6(v) * 6 + 1) === v. Valid for out-of-range v (e.g. 7..10, 0, -1)
 *  too, letting one 1D roll force any court-martial result index. */
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

// E1..E9 mercenary (army) enlisted ladder; E5 is mid-ladder so both
// reduce-rank -1 and -2 land inside the ladder without clamping at the floor.
const MID_RANK = "E5";
const START_AGE = 30;

/** Enlisted mercenary at a mid-ladder rank with no brownie points: a
 *  court-martial resolves through the result roll alone, no guilt roll, no
 *  mitigation. Mirrors the acgChar setup used by the ACG regression suite. */
function courtMartialChar(rankCode: string): Character {
  const c = new Character({
    attributes: {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    },
  });
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.service = "army";
  c.acgState = freshAcgState("mercenary");
  c.acgState.rankCode = rankCode;
  c.acgState.isOfficer = false; // enlisted => auto-guilty; no guilt-avoid roll
  c.acgState.browniePoints = 0; // no BP mitigation; the forced die IS the result
  c.age = START_AGE;
  return c;
}

/** Force a court-martial onto a chosen result index with pinned sub-dice and
 *  return the resolved character. The Math.random spy is installed AFTER
 *  construction so its queued sequence starts exactly at the 1D result roll. */
function driveCourtMartial(
  rankCode: string, resultDie: number, subDice: number[],
): Character {
  const c = courtMartialChar(rankCode);
  const spy = vi.spyOn(Math, "random");
  for (const v of [resultDie, ...subDice]) spy.mockReturnValueOnce(d6(v));
  spy.mockReturnValue(d6(1)); // any unmodeled extra draw stays deterministic
  runCourtMartial(c);
  return c;
}

const courtMartialResult = (c: Character): string | undefined => {
  const e = c.events.find((ev) => ev.kind === "courtMartial");
  return e && e.kind === "courtMartial" ? e.result : undefined;
};

/** The `note` of the first statusChange event with the given `kind_`, or
 *  undefined if none was logged. */
function statusNote(c: Character, kind_: string): string | undefined {
  for (const e of c.events) {
    if (e.kind === "statusChange" && e.kind_ === kind_) return e.note;
  }
  return undefined;
}

const hasStatusChange = (c: Character, kind_: string): boolean =>
  c.events.some((e) => e.kind === "statusChange" && e.kind_ === kind_);

/** Assert (loudly) that chargen ended in the `retired` state and return its
 *  discriminating fields. Both a dishonorable discharge (reason "discharged")
 *  and a death-sentence escape (reason "death sentence; escaped…") land here
 *  with withPension false; the reason is the only structural discriminator. */
function retiredStatus(c: Character): { reason: string | undefined; withPension: boolean } {
  const s = c.chargenStatus;
  if (s.kind !== "retired") {
    throw new Error(`expected retired chargenStatus, got "${s.kind}"`);
  }
  return { reason: s.reason, withPension: s.withPension };
}

interface Row {
  roll: number;
  rank: string;
  resultDie: number;
  subDice: number[];
  /** dieResults[roll].result — confirms the forced roll selected this row. */
  result: string;
  check: (c: Character) => void;
}

const rows: Row[] = [
  {
    roll: -1, rank: MID_RANK, resultDie: -1, subDice: [],
    result: "Case dismissed",
    check: (c) => {
      // No-op: no field touched, chargen continues.
      expect(c.acgState!.rankCode).toBe(MID_RANK);
      expect(c.acgState!.nextPromotionPenalty).toBeUndefined();
      expect(c.acgState!.musterRollPenalty).toBeUndefined();
      expect(c.acgState!.pensionForfeit).toBeUndefined();
      expect(c.acgState!.bountyOnHeadKCr).toBeUndefined();
      expect(c.acgState!.guardsKilledInEscape).toBeUndefined();
      expect(c.acgState!.imprisonmentAgeYears).toBe(0);
      expect(c.age).toBe(START_AGE);
      expect(hasStatusChange(c, "jailed")).toBe(false);
      expect(c.chargenStatus.kind).toBe("active");
      expect(c.activeDuty).toBe(true);
      expect(c.isChargenEnded).toBe(false);
    },
  },
  {
    roll: 0, rank: MID_RANK, resultDie: 0, subDice: [],
    result: "Reprimand; -1 to next promotion",
    check: (c) => {
      expect(c.acgState!.nextPromotionPenalty).toBe(-1);
      expect(c.acgState!.rankCode).toBe(MID_RANK); // rank untouched
      expect(c.age).toBe(START_AGE);
      expect(c.chargenStatus.kind).toBe("active");
      expect(c.isChargenEnded).toBe(false);
    },
  },
  {
    roll: 1, rank: MID_RANK, resultDie: 1, subDice: [],
    result: "Reprimand; -3 to next promotion",
    check: (c) => {
      expect(c.acgState!.nextPromotionPenalty).toBe(-3);
      expect(c.acgState!.rankCode).toBe(MID_RANK);
      expect(c.chargenStatus.kind).toBe("active");
      expect(c.isChargenEnded).toBe(false);
    },
  },
  {
    roll: 2, rank: MID_RANK, resultDie: 2, subDice: [],
    result: "Reduce rank -1",
    check: (c) => {
      expect(c.acgState!.rankCode).toBe("E4"); // E5 -> E4
      expect(c.acgState!.nextPromotionPenalty).toBeUndefined();
      expect(c.chargenStatus.kind).toBe("active");
      expect(c.isChargenEnded).toBe(false);
    },
  },
  {
    roll: 3, rank: MID_RANK, resultDie: 3, subDice: [],
    result: "Reduce rank -2",
    check: (c) => {
      expect(c.acgState!.rankCode).toBe("E3"); // E5 -> E3
      expect(c.chargenStatus.kind).toBe("active");
      expect(c.isChargenEnded).toBe(false);
    },
  },
  {
    // Composability: BOTH a rank reduction AND a jail-months sentence.
    roll: 4, rank: MID_RANK, resultDie: 4, subDice: [3, 4],
    result: "Jail 2D months; reduce rank -2",
    check: (c) => {
      expect(c.acgState!.rankCode).toBe("E3"); // reduce rank -2: E5 -> E3
      expect(statusNote(c, "jailed")).toContain("7 months"); // 2D = 3 + 4
      // Jail-months consumes the year in place of aging/muster-out.
      expect(c.age).toBe(START_AGE);
      expect(c.acgState!.imprisonmentAgeYears).toBe(0);
      expect(c.acgState!.pensionForfeit ?? false).toBe(false);
      expect(c.acgState!.musterRollPenalty).toBeUndefined();
      expect(c.chargenStatus.kind).toBe("active");
      expect(c.activeDuty).toBe(true);
      expect(c.isChargenEnded).toBe(false);
    },
  },
  {
    // Composability: jail-years aging AND dishonorable flags AND discharge.
    roll: 5, rank: MID_RANK, resultDie: 5, subDice: [4],
    result: "Jail 1D years; dishonorable discharge",
    check: (c) => {
      expect(c.age).toBe(START_AGE + 4); // 1D years = 4
      expect(c.acgState!.imprisonmentAgeYears).toBe(4);
      expect(statusNote(c, "jailed")).toContain("imprisoned 4 years");
      expect(c.acgState!.musterRollPenalty).toBe(-3);
      expect(c.acgState!.pensionForfeit).toBe(true);
      expect(hasStatusChange(c, "dishonorablyDischarged")).toBe(true);
      expect(c.acgState!.rankCode).toBe(MID_RANK); // no rank reduction here
      expect(retiredStatus(c)).toEqual({ reason: "discharged", withPension: false });
      expect(c.isChargenEnded).toBe(true);
      expect(c.retired).toBe(false); // discharged != pensioned retirement
      expect(c.deceased).toBe(false);
      expect(c.activeDuty).toBe(false);
    },
  },
  {
    roll: 6, rank: MID_RANK, resultDie: 6, subDice: [3, 5],
    result: "Jail 2D years; dishonorable discharge",
    check: (c) => {
      expect(c.age).toBe(START_AGE + 8); // 2D years = 3 + 5
      expect(c.acgState!.imprisonmentAgeYears).toBe(8);
      expect(statusNote(c, "jailed")).toContain("imprisoned 8 years");
      expect(c.acgState!.musterRollPenalty).toBe(-3);
      expect(c.acgState!.pensionForfeit).toBe(true);
      expect(hasStatusChange(c, "dishonorablyDischarged")).toBe(true);
      expect(retiredStatus(c)).toEqual({ reason: "discharged", withPension: false });
      expect(c.isChargenEnded).toBe(true);
      expect(c.retired).toBe(false);
      expect(c.deceased).toBe(false);
    },
  },
  {
    roll: 7, rank: MID_RANK, resultDie: 7, subDice: [4, 6],
    result: "Jail 2D years; dishonorable discharge",
    check: (c) => {
      expect(c.age).toBe(START_AGE + 10); // 2D years = 4 + 6
      expect(c.acgState!.imprisonmentAgeYears).toBe(10);
      expect(statusNote(c, "jailed")).toContain("imprisoned 10 years");
      expect(c.acgState!.musterRollPenalty).toBe(-3);
      expect(c.acgState!.pensionForfeit).toBe(true);
      expect(hasStatusChange(c, "dishonorablyDischarged")).toBe(true);
      expect(retiredStatus(c)).toEqual({ reason: "discharged", withPension: false });
      expect(c.isChargenEnded).toBe(true);
      expect(c.retired).toBe(false);
      expect(c.deceased).toBe(false);
    },
  },
  {
    roll: 8, rank: MID_RANK, resultDie: 8, subDice: [],
    result: "Death; escape; KCr10 reward",
    check: (c) => {
      // Death/escape zeroes benefits and forfeits the pension.
      expect(c.acgState!.musterRollPenalty).toBe(-99);
      expect(c.acgState!.pensionForfeit).toBe(true);
      expect(c.acgState!.bountyOnHeadKCr).toBe(10);
      expect(c.acgState!.guardsKilledInEscape).toBeUndefined(); // no guards clause
      expect(c.age).toBe(START_AGE); // escape does not age
      expect(c.acgState!.rankCode).toBe(MID_RANK);
      const s = retiredStatus(c);
      expect(s.withPension).toBe(false);
      expect(s.reason).toContain("escaped"); // escaped-retired, not deceased
      expect(c.isChargenEnded).toBe(true);
      expect(c.retired).toBe(false);
      expect(c.deceased).toBe(false);
      expect(c.activeDuty).toBe(false);
    },
  },
  {
    roll: 9, rank: MID_RANK, resultDie: 9, subDice: [],
    result: "Death; escape; KCr10 reward",
    check: (c) => {
      expect(c.acgState!.musterRollPenalty).toBe(-99);
      expect(c.acgState!.pensionForfeit).toBe(true);
      expect(c.acgState!.bountyOnHeadKCr).toBe(10);
      expect(c.acgState!.guardsKilledInEscape).toBeUndefined();
      expect(c.age).toBe(START_AGE);
      const s = retiredStatus(c);
      expect(s.withPension).toBe(false);
      expect(s.reason).toContain("escaped");
      expect(c.isChargenEnded).toBe(true);
      expect(c.retired).toBe(false);
      expect(c.deceased).toBe(false);
    },
  },
  {
    roll: 10, rank: MID_RANK, resultDie: 10, subDice: [3],
    result: "Death; escape, killing 1D guards; KCr100 reward",
    check: (c) => {
      expect(c.acgState!.musterRollPenalty).toBe(-99);
      expect(c.acgState!.pensionForfeit).toBe(true);
      expect(c.acgState!.bountyOnHeadKCr).toBe(100);
      expect(c.acgState!.guardsKilledInEscape).toBe(3); // 1D guards = 3
      expect(c.age).toBe(START_AGE);
      const s = retiredStatus(c);
      expect(s.withPension).toBe(false);
      expect(s.reason).toContain("escaped");
      expect(c.isChargenEnded).toBe(true);
      expect(c.retired).toBe(false);
      expect(c.deceased).toBe(false);
    },
  },
];

describe("court-martial dieResults golden lock (PM p. 47, MT ACG)", () => {
  it.each(rows)("roll $roll: $result", (row) => {
    const c = driveCourtMartial(row.rank, row.resultDie, row.subDice);
    // The forced 1D result roll landed on the intended dieResults row.
    expect(courtMartialResult(c)).toBe(row.result);
    row.check(c);
  });
});
