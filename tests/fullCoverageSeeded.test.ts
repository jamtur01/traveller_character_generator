// Seeded, all-outcome correctness oracle — the varied-terminal companion to
// fullCoverage.test.ts.
//
// fullCoverage.test.ts drives every registry-enumerated combo down the all-6s
// happy path (pinD6(6)): those characters always survive, always reenlist, and
// never wash out — a single terminal shape per combo. This file drives the
// SAME coverageMatrix() combos through the SEEDED walkers across a fixed seed
// list, so a real dice stream produces the full spread of terminal states —
// deaths, short-term musters, denied reenlistments, and ACG enlistment
// washouts — and asserts the SAME whole-character invariants
// (assertCharacterConsistent) hold over every one of them.
//
// Core assertion: assertCharacterConsistent over all combos × all seeds. It is
// the oracle — a flipped survival roll, a mis-aged washout, or a muster table
// that leaks a benefit into a deceased character reddens the invariant test.
//
// Teeth on the coverage itself: the walk classifies each terminal and asserts
// the matrix actually reaches the death and enlistment-failure paths above
// measured floors (a regression that quietly stops killing characters, or
// stops ever failing an enlistment, drops a count below its floor and reddens).
//
// Determinism: the seeded walkers run the character's own mulberry32 rng (no
// Math.random), the same re-execution-deterministic path the UI and the replay
// harness use. The whole distribution is therefore exactly reproducible, so the
// floors below are exact measured counts, never statistical guesses.

import { beforeAll, describe, expect, it } from "vitest";
import { coverageMatrix, type CoverageCombo } from "@/tests/_coverageMatrix";
import { walkAcg, walkBasic, walkMongoose, type WalkResult } from "@/tests/_walker";
import { assertCharacterConsistent } from "@/tests/_characterInvariants";
import type { Character } from "@/lib/traveller/character";
import type { HistoryEvent } from "@/lib/traveller/history";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

const matrix = coverageMatrix();

// Seeds 1..N per combo. N = 20 mirrors tests/equivalence.property.test.ts's
// SEEDS_PER_CONFIG: enough distinct dice streams to reach every terminal the
// engine can produce (death, short-term muster, denied reenlistment, ACG
// enlistment washout) across the 76 combos, while keeping the run to
// ~1,520 walks (a few seconds). The stream is deterministic, so the outcome
// distribution and the floors below are exact.
const SEED_COUNT = 20;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

// Registry picks arrive as Readonly<Record<string,string>>; the option-domain
// audit-locks + coverageMatrix self-check prove those values ARE the declared
// union members, so narrowing them to the walker's literal-union params is a
// sound unchecked cast (the compiler cannot narrow a Record read). Mirrors the
// same casts in fullCoverage.test.ts's driveCombo.
type WalkBasicOpts = Parameters<typeof walkBasic>[0];
type WalkAcgOpts = Parameters<typeof walkAcg>[0];

/** Dispatch one combo to its seeded chargen-model walker. */
function driveComboSeeded(combo: CoverageCombo, seed: number): WalkResult {
  switch (combo.model) {
    case "classic":
      return walkBasic({
        edition: combo.edition as WalkBasicOpts["edition"],
        service: combo.service,
        seed,
      });
    case "acg": {
      // exactOptionalPropertyTypes forbids an explicit `undefined`, and a
      // pathway's picks only carry the sub-domains it crosses, so assign each
      // optional field only when present (the walker fills the rest).
      const p = combo.picks;
      const opts: WalkAcgOpts = { pathway: combo.pathway as WalkAcgOpts["pathway"], seed };
      if (p.acgService !== undefined) opts.service = p.acgService as EnlistOptions["acgService"];
      if (p.acgCombatArm !== undefined) opts.combatArm = p.acgCombatArm;
      if (p.acgFleet !== undefined) opts.fleet = p.acgFleet as EnlistOptions["acgFleet"];
      if (p.acgDivision !== undefined) opts.division = p.acgDivision as EnlistOptions["acgDivision"];
      if (p.acgLineType !== undefined) opts.lineType = p.acgLineType;
      if (p.acgSubsectorTech !== undefined) opts.subsectorTech = p.acgSubsectorTech;
      return walkAcg(opts);
    }
    case "mongoose":
      return walkMongoose({ career: combo.career, seed });
  }
}

/** Human-readable label naming the exact combo a failure came from. */
function comboLabel(combo: CoverageCombo): string {
  switch (combo.model) {
    case "classic":
      return `${combo.edition} · classic · service=${combo.service}`;
    case "acg": {
      const picks = Object.entries(combo.picks)
        .map(([field, value]) => `${field}=${value}`)
        .join(", ");
      return `${combo.edition} · acg · ${combo.pathway}${picks ? ` · ${picks}` : ""}`;
    }
    case "mongoose":
      return `${combo.edition} · mongoose · career=${combo.career}`;
  }
}

const OUTCOMES = [
  "deceased", "mustered-out", "discharged-retired", "enlistment-washout", "bounded",
] as const;
type Outcome = (typeof OUTCOMES)[number];

type EndEvent = Extract<HistoryEvent, { kind: "endGeneration" }>;

/** The definitive terminal reason. It lives in the (single) endGeneration
 *  event, which SURVIVES the enterMuster status overwrite: a denied-reenlist
 *  character's chargenStatus gets stamped "mustered" by enterMuster, but its
 *  endGeneration event still reads "retired". Absent only for a bounded run
 *  that hit its term budget while still actively serving (no endGeneration
 *  event was ever logged). */
function endReason(ch: Character): EndEvent["reason"] | undefined {
  const end = ch.events.find((e): e is EndEvent => e.kind === "endGeneration");
  return end?.reason;
}

/** Classify a finished character's terminal state from observable state:
 *  - deceased: killed by survival / aging / mishap (chargenStatus "deceased").
 *  - enlistment-washout: the acg model logs endGeneration("retired") at enlist,
 *    before any term ran, so the character never served (terms === 0).
 *  - discharged-retired: denied reenlistment / mandatory retirement / disability
 *    (endGeneration "retired" after serving ≥ 1 term).
 *  - mustered-out: left service via a short term or a completed set of careers
 *    (endGeneration "mustered").
 *  - bounded: still actively serving at the walk's term budget (no terminal). */
function classifyOutcome(ch: Character): Outcome {
  const reason = endReason(ch);
  if (reason === "deceased" || ch.deceased) return "deceased";
  if (reason === "retired") return ch.terms === 0 ? "enlistment-washout" : "discharged-retired";
  if (reason === "mustered") return "mustered-out";
  return "bounded";
}

function emptyCounts(): Record<Outcome, number> {
  return {
    "deceased": 0,
    "mustered-out": 0,
    "discharged-retired": 0,
    "enlistment-washout": 0,
    "bounded": 0,
  };
}

interface DriveSummary {
  /** Combos × seeds driven to a character AND validated clean. */
  driven: number;
  /** One entry per (combo, seed) whose walk threw or whose character violated
   *  an invariant — the message names the combo, the seed, and the finding. */
  failures: string[];
  totals: Record<Outcome, number>;
  byModel: Record<string, Record<Outcome, number>>;
  /** Runs that washed out at enlistment (terms 0) OR served a survival-failure
   *  short term (shortTermsCount > 0) — the failure paths the death floor does
   *  not cover. A short term can also end in death; this counts the failure
   *  event, independent of the final terminal class. */
  washoutOrShort: number;
}

/** Drive every combo across every seed once, validating and tallying. */
function driveAll(): DriveSummary {
  const s: DriveSummary = {
    driven: 0, failures: [], totals: emptyCounts(), byModel: {}, washoutOrShort: 0,
  };
  for (const combo of matrix) {
    const model = combo.model;
    s.byModel[model] ??= emptyCounts();
    const modelCounts = s.byModel[model]!;
    for (const seed of SEEDS) {
      try {
        const { character } = driveComboSeeded(combo, seed);
        // The oracle: throws naming the violated invariant + JSON path on any
        // inconsistency. Calling it IS the assertion.
        assertCharacterConsistent(character);
        s.driven += 1;
        const outcome = classifyOutcome(character);
        s.totals[outcome] += 1;
        modelCounts[outcome] += 1;
        if (outcome === "enlistment-washout" || character.shortTermsCount > 0) {
          s.washoutOrShort += 1;
        }
      } catch (err) {
        s.failures.push(`${comboLabel(combo)} · seed=${seed}: ${(err as Error).message}`);
      }
    }
  }
  return s;
}

// Measured floors — the equivalence harness's minPendingSeeds convention. Each
// value is the count MEASURED on the deterministic seed list 1..20; a drop
// below one means a real failure path silently stopped firing (a regression),
// so investigate — never lower a floor casually. `>=` keeps the ratchet: adding
// more failure paths only raises the count.
//
// Structural zeros in the per-model distribution (documented, not gaps):
//  - classic enlistment-washout = 0: a failed CT/MT enlistment drafts the
//    character into a random service (they always serve) — only ACG can wash
//    out at enlistment. So the 184 washouts are all ACG, and the death floor is
//    carried entirely by classic (ACG/mongoose survival failures below injure
//    or retire; a kill is possible but did not fall in seeds 1..20).
//  - acg mustered-out = 0: the ACG flow ends every departure through
//    endChargenRetired (endGeneration reason "retired"), so an ACG leaver
//    classifies as discharged-retired, never "mustered".
//  - mongoose bounded/discharged-retired/enlistment-washout = 0: walkMongoose
//    always drives to phase "end", the model logs only "mustered"/"deceased",
//    and it drafts on a qualification miss (terms >= 1) — so a mongoose
//    character can only muster out or die.
const DECEASED_FLOOR = 96;            // measured 96/1520 (CT classic survival/aging deaths)
const ENLISTMENT_WASHOUT_FLOOR = 184; // measured 184/1520 (ACG enlist fail + off-table draft)
const WASHOUT_OR_SHORT_FLOOR = 319;   // measured 319/1520 (184 washout + 135 survival-failure short terms)

let summary: DriveSummary;

describe("full coverage (seeded) — every combo yields a consistent character across varied terminals", () => {
  beforeAll(() => {
    summary = driveAll();
    // Compact per-model outcome distribution (coverage visibility).
    const line = (label: string, c: Record<Outcome, number>): string =>
      `  ${label.padEnd(9)} ` + OUTCOMES.map((o) => `${o}=${c[o]}`).join("  ");
    console.log(
      [
        `seeded coverage: ${matrix.length} combos × ${SEED_COUNT} seeds ` +
          `= ${matrix.length * SEED_COUNT} walks`,
        line("TOTAL", summary.totals),
        ...Object.entries(summary.byModel).map(([m, c]) => line(m, c)),
        `  washout-or-short runs: ${summary.washoutOrShort}`,
      ].join("\n"),
    );
  }, 120_000);

  it("holds every whole-character invariant across all combos × seeds", () => {
    expect(summary.failures).toEqual([]);
  });

  it("drives every combo × seed to a validated character (exhaustive)", () => {
    expect(summary.driven).toBe(matrix.length * SEED_COUNT);
  });

  it("exercises the death path above the measured floor", () => {
    expect(
      summary.totals.deceased,
      `deceased outcomes across the matrix fell below the measured floor ${DECEASED_FLOOR}`,
    ).toBeGreaterThanOrEqual(DECEASED_FLOOR);
  });

  it("exercises the ACG enlistment-washout path above the measured floor", () => {
    expect(
      summary.totals["enlistment-washout"],
      `enlistment washouts across the matrix fell below the measured floor ${ENLISTMENT_WASHOUT_FLOOR}`,
    ).toBeGreaterThanOrEqual(ENLISTMENT_WASHOUT_FLOOR);
  });

  it("exercises the enlistment-washout / short-term failure path above the measured floor", () => {
    expect(
      summary.washoutOrShort,
      `washout + short-term runs fell below the measured floor ${WASHOUT_OR_SHORT_FLOOR}`,
    ).toBeGreaterThanOrEqual(WASHOUT_OR_SHORT_FLOOR);
  });
});
