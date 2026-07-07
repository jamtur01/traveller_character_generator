// Chargen session — pure flow logic extracted from the React layer, built on
// event-sourced re-execution.
//
// Model: every session action (enlist, runTerm, pickSkill, ...) captures a
// pristine pre-action BASE (cloneCharacter before anything mutates — RNG
// position included) and runs the flow STRAIGHT THROUGH on a working copy.
// Player decisions flow through Character.decisionCursor: previously-recorded
// option indices are consumed synchronously inline (pickOrDefer runs
// onResolve immediately and execution continues); only the FRONTIER choice —
// the first one past the recorded indices — queues on pendingChoices and
// throws ChoicePendingError, unwinding to the single pauseGuard boundary in
// runAction. The partial snapshot renders; when the player picks,
// resolvePending appends the index to the frontier's resolutions and RE-RUNS
// the same action from a clone of the base. The whole prefix re-executes
// identically, previously-answered choices consume from the cursor, and
// execution reaches the next frontier (or completes). No mid-flight resume
// state and no idempotence caches exist: every re-run starts from a virgin
// base.
//
// DETERMINISM INVARIANT: re-execution reproduces the prefix exactly iff the
// character's RNG is deterministic across re-runs — i.e. the rng is seeded
// (StartCareerOptions.seed; the replay harness and the UI always seed) or
// Math.random is fully pinned (walker / session tests pin a constant). The
// same cloned seeded rng yields the same draws, so the re-run is bit-for-bit
// identical up to the frontier (proven by tests/equivalence.property.test.ts).

import { Character, cloneCharacter } from "@/lib/traveller/character";
import { pauseGuard } from "@/lib/traveller/engine/choices";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import { editionHasAcg } from "@/lib/traveller/engine/acg";
import { getChargenModel } from "@/lib/traveller/chargen/modelRegistry";
// Register the built-in chargen models (they self-register at module load).
import "@/lib/traveller/chargen/models/classic";
import "@/lib/traveller/chargen/models/acg";
import "@/lib/traveller/chargen/models/mongoose";

export type ChargenPhase =
  | "start"
  | "pre_career"
  | "career"
  | "acg_enlist"
  | "term"
  | "skill_basic"
  | "skill_adv"
  | "muster"
  | "muster_no_cash"
  | "end";

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool" | "skip";

export interface EnlistOptions {
  verbose: boolean;
  /** Basic chargen only — preferred service, or "random". */
  preferredService: string;
  /** ACG only. */
  acgService: "army" | "marines";
  acgCombatArm: string;
  acgFleet: "imperialNavy" | "reserveFleet" | "systemSquadron";
  acgDivision: "field" | "bureaucracy";
  acgLineType: string;
  acgSubsectorTech: string;
  acgMerchantAcademy: boolean;
}

/** One session action, as a plain re-dispatchable record (no closures — the
 *  frontier must survive in React state / snapshots without live references). */
export type FrontierAction =
  | { kind: "runTerm" }
  | { kind: "enlist"; opts: EnlistOptions }
  | { kind: "preCareer"; opt: PreCareerOption }
  | { kind: "pickSkill"; table: number }
  | { kind: "attemptMusterOut" }
  | { kind: "musterChoice"; choice: "cash" | "benefit" };

/** A paused action: the pre-action base to re-execute from, the action to
 *  re-dispatch, and the option indices already picked (in prompt order). */
export interface Frontier {
  action: FrontierAction;
  base: Character;
  resolutions: number[];
}

export interface ChargenSnapshot {
  character: Character;
  phase: ChargenPhase;
  /** Present iff the character has a pending frontier choice. resolvePending
   *  re-runs `action` from `base` with the picked index appended. */
  frontier?: Frontier;
}

/** Hints back to the React layer when a flow action wants to update the
 *  separately-tracked UI config state (e.g., a pre-career outcome pre-
 *  populates the ACG enlistment form). All fields optional. */
export interface UiHints {
  acgPathway?: string;
  acgService?: "army" | "marines";
  acgFleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
}

export interface ChargenResult {
  snapshot: ChargenSnapshot;
  /** Soft hints for the UI's config state (separate from character). */
  hints?: UiHints;
}

export interface StartCareerOptions {
  edition: string;
  verbose: boolean;
  interactiveMode: boolean;
  supportsInteractive: boolean;
  useAcg: boolean;
  acgPathway: string;
  /** Seed the character's RNG for a reproducible run (see chargen/replay).
   *  Interactive-mode determinism requires this OR a fully pinned
   *  Math.random (the walker-test pattern): resolvePending re-executes the
   *  paused action from its base, and an unseeded, unpinned rng re-rolls
   *  fresh values on every re-run, silently diverging from the displayed
   *  prefix. The UI always seeds. No runtime guard — the engine cannot
   *  detect a pinned Math.random. */
  seed?: number;
}

/** Begin a new character. Decides whether to enter pre-career (ACG) or
 *  jump straight to basic enlistment. */
export function startCareer(opts: StartCareerOptions): ChargenSnapshot {
  const ch = new Character(opts.seed !== undefined ? { seed: opts.seed } : {});
  ch.editionId = opts.edition;
  ch.showHistory = opts.verbose ? "verbose" : "simple";
  // Set choiceMode before generateHomeworld so that any homeworld
  // generation step that consults choiceMode (e.g., future interactive
  // homeworld picks) sees the configured mode rather than the default.
  ch.choiceMode = (opts.interactiveMode && opts.supportsInteractive)
    ? "interactive"
    : "auto";
  ch.generateHomeworld();
  if (opts.useAcg && editionHasAcg(opts.edition) && opts.acgPathway) {
    ch.chargenModelId = "acg";
    ch.acgPathway = opts.acgPathway;
    // PM p. 44: ACG characters (and pre-career at 18) begin at age 18 —
    // declared in acg.common.startAge rather than inherited from the
    // constructor literal. Basic flow applies per-service startAge at enlist.
    ch.age = requireRule(
      getEdition(opts.edition).data.advancedCharacterGeneration?.common?.startAge,
      "advancedCharacterGeneration.common.startAge", "PM p. 44",
    );
  } else {
    // Non-ACG: enter the edition's declared default model. No hardcoded
    // "mongoose"/"classic" precedence — the id comes from edition JSON, and
    // each model does its own per-character setup in init (below).
    ch.chargenModelId = getEdition(opts.edition).meta.defaultChargenModel;
  }
  const model = getChargenModel(ch.chargenModelId);
  model.init?.(ch);
  return { character: ch, phase: model.entryPhase(ch) };
}

// ---------------------------------------------------------------------------
// Action dispatch. One boundary owns the whole pause protocol: runAction
// clones the base, arms the decision cursor, runs the action straight
// through, and either returns the completed routing or a paused snapshot
// carrying the frontier.
// ---------------------------------------------------------------------------

/** Run one action from `prev` with the given recorded decisions. The ONLY
 *  ChoicePendingError boundary in the session: a pause here means the
 *  working copy holds the partial (renderable) state and the returned
 *  frontier can re-execute the action once the player picks. */
function runAction(
  prev: Character, action: FrontierAction, resolutions: number[],
): ChargenResult {
  if (prev.pendingChoices.length > 0) {
    throw new Error(
      `session: cannot dispatch "${action.kind}" while a choice is pending — ` +
      "the paused action must be resolved first (resolvePending); building " +
      "on the partial mid-action state would abandon the frontier",
    );
  }
  const base = cloneCharacter(prev);
  const ch = cloneCharacter(prev);
  ch.decisionCursor = { resolutions, pos: 0 };
  let result: ChargenResult | undefined;
  const outcome = pauseGuard(() => {
    result = getChargenModel(ch.chargenModelId).execute(ch, action);
  });
  ch.decisionCursor = null;
  if (outcome === "paused") {
    return {
      snapshot: {
        character: ch,
        phase: getChargenModel(ch.chargenModelId).pausedPhase(action, ch, base),
        frontier: { action, base, resolutions },
      },
    };
  }
  return result!;
}

/** Resolve a pending player choice: append the picked option index to the
 *  frontier's resolutions and re-run the paused action from its base. The
 *  re-executed prefix consumes the recorded indices inline; execution then
 *  reaches the next frontier or completes (phase routing happens naturally
 *  inside the re-run — no post-drain special cases). Returns the full
 *  ChargenResult: when the re-run completes a pre-career action, `hints`
 *  carries the enlistment-form pre-population that would otherwise be
 *  lost (in interactive mode the OTC / medical-school outcomes are always
 *  delivered through this path). */
export function resolvePending(
  snap: ChargenSnapshot,
  choiceId: string,
  optionIdx: number,
): ChargenResult {
  const frontier = snap.frontier;
  if (!frontier) {
    throw new Error(
      "resolvePending: snapshot has no frontier — a pending choice must come " +
      "from a paused session action (stale snapshot or corrupted state)",
    );
  }
  const pending = snap.character.pendingChoices.find((p) => p.id === choiceId);
  if (!pending) {
    throw new Error(
      `resolvePending: no pending choice with id "${choiceId}" ` +
      `(pending: ${snap.character.pendingChoices.map((p) => p.id).join(", ") || "none"})`,
    );
  }
  if (pending.options[optionIdx] === undefined) {
    throw new Error(
      `resolvePending: optionIdx ${optionIdx} out of range for choice ` +
      `${choiceId} (${pending.options.length} options)`,
    );
  }
  return runAction(
    frontier.base, frontier.action, [...frontier.resolutions, optionIdx],
  );
}

// ---------------------------------------------------------------------------
// Public actions — thin wrappers that package a FrontierAction. Guards that
// must not consume an action (pending choice, mandatory reenlistment) stay
// out here so the no-op case returns the snapshot identity-equal.
// ---------------------------------------------------------------------------

/** Apply a pre-career option. Honors a chained-academic-progression: an
 *  honors college grad may chain into medical/flight school; an academy
 *  honors grad may try medical/flight. Returns hints for the UI's
 *  enlistment-form config (e.g., naval academy honors → navy/imperialNavy). */
export function applyPreCareer(
  snap: ChargenSnapshot,
  opt: PreCareerOption,
): ChargenResult {
  return runAction(snap.character, { kind: "preCareer", opt }, []);
}

export function enlist(snap: ChargenSnapshot, opts: EnlistOptions): ChargenSnapshot {
  return runAction(snap.character, { kind: "enlist", opts }, []).snapshot;
}

/** Run one service term. ACG dispatches into runAcgTerm; basic chargen
 *  runs the per-term step + skill picks. Routes phase based on the
 *  term's outcome (skill picks pending, deceased, mustered out, etc.). */
export function runTerm(snap: ChargenSnapshot): ChargenSnapshot {
  // If a player choice is still pending, refuse to advance — the term
  // action is paused on its frontier and must be resolved first (the UI
  // shows only the PendingChoicesPanel while paused). Soft identity
  // return: the panel's resolve action is the only way forward.
  if (snap.character.pendingChoices.length > 0) return snap;
  return runAction(snap.character, { kind: "runTerm" }, []).snapshot;
}

/** Pick a skill table (or pass 0 for the service's default). Advances
 *  to the next skill-pick phase, the cascade-resolution flow, or
 *  end-of-term. */
export function pickSkill(snap: ChargenSnapshot, table: number): ChargenSnapshot {
  return runAction(snap.character, { kind: "pickSkill", table }, []).snapshot;
}

/** Voluntary muster-out — player chose to leave service when they were
 *  eligible to stay. */
export function attemptMusterOut(snap: ChargenSnapshot): ChargenSnapshot {
  if (snap.character.mandatoryReenlistment) return snap;
  return runAction(snap.character, { kind: "attemptMusterOut" }, []).snapshot;
}

/** Apply one muster-out cash or benefit roll. */
export function musterChoice(
  snap: ChargenSnapshot,
  kind: "cash" | "benefit",
): ChargenSnapshot {
  return runAction(snap.character, { kind: "musterChoice", choice: kind }, []).snapshot;
}

/** Update the showHistory level on a snapshot's character. Also patches the
 *  frontier base (when paused) so a re-execution keeps the new level. */
export function setVerbose(snap: ChargenSnapshot, verbose: boolean): ChargenSnapshot {
  const ch = cloneCharacter(snap.character);
  ch.showHistory = verbose ? "verbose" : "simple";
  if (!snap.frontier) return { character: ch, phase: snap.phase };
  const base = cloneCharacter(snap.frontier.base);
  base.showHistory = ch.showHistory;
  return {
    character: ch,
    phase: snap.phase,
    frontier: { ...snap.frontier, base },
  };
}
