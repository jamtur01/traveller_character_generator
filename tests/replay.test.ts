// Replay determinism: a chargen RunLog (seed + ordered actions) is a pure
// function of its inputs, so replaying it deterministically reconstructs the
// identical character. This is the payoff of the seeded Character.rng
// (see tests/rngDeterminism.test.ts) lifted to the session-action layer:
// every engine draw flows through the seeded stream, so startCareer(seed) +
// the recorded action fold reproduces the run bit-for-bit.
//
// The runs here are DRIVEN programmatically: a small state machine inspects
// each snapshot's phase (and any pending choice) and records the appropriate
// next action into a RunLog, rather than hand-guessing a fixed script. The
// RunLog is then replayed via replayRun and compared on observable state.

import { describe, expect, it } from "vitest";
import type { Character } from "../lib/traveller/character";
import {
  applyChargenAction, replayRun,
  type ChargenAction, type RunLog,
} from "../lib/traveller/chargen/replay";
import {
  startCareer,
  type ChargenSnapshot, type EnlistOptions, type StartCareerOptions,
} from "../lib/traveller/chargen/session";

const CT_AUTO: StartCareerOptions = {
  edition: "ct-classic",
  verbose: false,
  interactiveMode: false,
  supportsInteractive: false,
  useAcg: false,
  acgPathway: "",
};

const CT_INTERACTIVE: StartCareerOptions = {
  ...CT_AUTO,
  interactiveMode: true,
  supportsInteractive: true,
};

// Basic CT chargen only consults verbose + preferredService; the acg* fields
// are required by the EnlistOptions contract but unused when useAcg is false.
const ENLIST: EnlistOptions = {
  verbose: false,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "Infantry",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "Free Trader",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

/** Term-phase decision: keep serving, or voluntarily muster out once the
 *  character has served the target number of terms (and isn't force-held by
 *  a mandatory reenlistment). Exercises the attemptMusterOut action while
 *  still producing a genuine multi-term character. */
function termAction(c: Character, musterAfterTerms: number): ChargenAction {
  if (!c.mandatoryReenlistment && c.terms >= musterAfterTerms) {
    return { type: "attemptMusterOut" };
  }
  return { type: "runTerm" };
}

/** Pick the next action for the current snapshot. A pending player choice
 *  always wins (resolve by option index 0); otherwise the phase dictates the
 *  action. Throws on any phase it doesn't expect so a flow regression surfaces
 *  loudly instead of silently recording garbage. */
function nextAction(
  snap: ChargenSnapshot,
  musterKind: "cash" | "benefit",
  musterAfterTerms: number,
): ChargenAction {
  if (snap.character.pendingChoices.length > 0) return { type: "resolve", optionIdx: 0 };
  switch (snap.phase) {
    case "career": return { type: "enlist", opts: ENLIST };
    case "term": return termAction(snap.character, musterAfterTerms);
    case "skill_basic":
    case "skill_adv": return { type: "pickSkill", table: 0 };
    case "muster": return { type: "musterChoice", kind: musterKind };
    // Past the cash-roll cap: only benefit rolls remain legal.
    case "muster_no_cash": return { type: "musterChoice", kind: "benefit" };
    default: throw new Error(`replay driver: unexpected phase "${snap.phase}"`);
  }
}

interface Driven {
  /** Final snapshot of the driven run. */
  snapshot: ChargenSnapshot;
  /** The replayable record of exactly the actions that were applied. */
  log: RunLog;
  /** True if at least one pending choice was hit (and thus a resolve recorded)
   *  while driving — proves the interactive resolve path was exercised. */
  sawPending: boolean;
}

/** Drive a full basic-chargen run to a terminal phase, mirroring exactly what
 *  replayRun does (startCareer(seed) then fold actions) while recording each
 *  action. The iteration cap is a safety net against a flow bug that never
 *  reaches "end"; a healthy run terminates well under it. */
function driveChargen(
  start: StartCareerOptions,
  seed: number,
  musterKind: "cash" | "benefit",
  musterAfterTerms = 3,
): Driven {
  const actions: ChargenAction[] = [];
  let snap = startCareer({ ...start, seed });
  let sawPending = false;
  for (let step = 0; step < 200 && snap.phase !== "end"; step++) {
    const action = nextAction(snap, musterKind, musterAfterTerms);
    if (action.type === "resolve") sawPending = true;
    actions.push(action);
    snap = applyChargenAction(snap, action);
  }
  return { snapshot: snap, log: { seed, start, actions }, sawPending };
}

/** The externally observable state a faithful replay must reproduce. RNG
 *  internals and pendingChoices closures are non-serializable and excluded;
 *  skills are sorted so set-equality doesn't hinge on insertion order. */
function observableState(c: Character) {
  return {
    attributes: c.attributes,
    skills: [...c.skills].sort((a, b) => a[0].localeCompare(b[0])),
    service: c.service,
    rank: c.rank,
    terms: c.terms,
    credits: c.credits,
    benefits: c.benefits,
    chargenStatus: c.chargenStatus,
    history: c.renderHistory(),
  };
}

describe("chargen RunLog replay determinism", () => {
  it("reconstructs an identical character from a driven auto CT run", () => {
    // seed 42 drives a real 3-term Merchant-service run: multiple skill picks,
    // a voluntary muster-out, and cash rolls to a terminal phase.
    const driven = driveChargen(CT_AUTO, 42, "cash");
    expect(driven.snapshot.phase).toBe("end");
    expect(driven.snapshot.character.terms).toBeGreaterThan(1);
    // The script genuinely exercised the full action surface, not just enlist.
    expect(driven.log.actions.some((a) => a.type === "attemptMusterOut")).toBe(true);
    expect(driven.log.actions.some((a) => a.type === "pickSkill")).toBe(true);
    expect(driven.log.actions.some((a) => a.type === "musterChoice")).toBe(true);

    const replay = replayRun(driven.log);
    expect(replay.phase).toBe("end");
    // The core contract: seed + actions rebuild the same character. This can
    // only hold if every draw stayed inside the seeded stream and each action
    // re-applied identically — an off-by-one or mis-applied action diverges it.
    expect(observableState(replay.character))
      .toEqual(observableState(driven.snapshot.character));

    // Replaying the same log twice is idempotent (no hidden global state leaks
    // between replays).
    const replayAgain = replayRun(driven.log);
    expect(observableState(replayAgain.character))
      .toEqual(observableState(replay.character));
  });

  it("diverges under a different seed with the identical action script", () => {
    // Take one fixed action script (from the seed-42 drive) and replay it under
    // two seeds. Everything but the seed is held constant, so the seed is the
    // sole variable. If replay ever ignored the seed (dropped or hardcoded),
    // both characters would be identical and this assertion would fail — that
    // regression is exactly what this guards.
    const { log } = driveChargen(CT_AUTO, 42, "cash");
    const fromSeed42 = replayRun({ ...log, seed: 42 });
    const fromSeed1000 = replayRun({ ...log, seed: 1000 });

    expect(observableState(fromSeed42.character))
      .not.toEqual(observableState(fromSeed1000.character));
    // Not a vacuous divergence: seed 42 completed a real multi-term run.
    expect(fromSeed42.character.terms).toBeGreaterThan(1);
  });

  it("replays interactive choices faithfully by recorded option index", () => {
    // Interactive CT chargen queues cascade choices (skill picks like Blade/Gun
    // Combat, weapon-benefit cascades at muster). Choice ids are minted from a
    // global counter and regenerate on every run, so the RunLog records only
    // the chosen option INDEX; replay re-applies it against whatever choice is
    // pending at that (deterministic) point.
    const driven = driveChargen(CT_INTERACTIVE, 2, "benefit");
    // Prove the resolve path was actually exercised — otherwise this test would
    // be indistinguishable from the auto case.
    expect(driven.sawPending).toBe(true);
    expect(driven.log.actions.some((a) => a.type === "resolve")).toBe(true);
    expect(driven.snapshot.phase).toBe("end");
    expect(driven.snapshot.character.terms).toBeGreaterThan(1);

    const replay = replayRun(driven.log);
    // Even though the pending choices carry different ids on this fresh replay,
    // index-based resolution rebuilds the identical character.
    expect(observableState(replay.character))
      .toEqual(observableState(driven.snapshot.character));
  });
});
