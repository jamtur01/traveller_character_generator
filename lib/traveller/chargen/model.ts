// The single seam the session drives character generation through.
//
// A ChargenModel owns one edition-style flow (classic / acg / mongoose): the
// per-action state transitions and the phase routing. The session owns the
// GENERIC, shared re-execution protocol (runAction: clone the pre-action base,
// arm the decision cursor, run straight through, catch the frontier pause) and
// the public action wrappers. So a model never re-implements pausing, and the
// session contains no edition names and no `if (useAcg)` — it dispatches to
// getChargenModel(ch.chargenModelId).
//
// Shared, edition-agnostic step mechanics (muster rolls, term-end, cascade/
// cell resolution) live in core/ and chargen/flow, called by the models.
//
// Runtime dependency direction: session -> modelRegistry -> models -> core.
// This module imports session/character types with `import type` only, so it
// is erased at runtime (no import cycle).

import type { Character } from "@/lib/traveller/character";
import type {
  ChargenPhase,
  ChargenResult,
  FrontierAction,
} from "@/lib/traveller/chargen/session";

/** One stage in the model's stepper: a labeled group of phases. The UI renders
 *  the stages in order and highlights the one holding the current phase, so
 *  each model owns its progression display (no per-edition switch in the
 *  Stepper). */
export interface FlowStage {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly phases: readonly ChargenPhase[];
}

/** One edition-style chargen flow. */
export interface ChargenModel {
  /** Registry key: "classic" | "acg" | "mongoose". */
  readonly id: string;
  /** Player-facing label (model selector UI). */
  readonly label: string;
  /** Phase to show immediately after the model is selected at startCareer. */
  entryPhase(ch: Character): ChargenPhase;
  /** Optional one-time per-character setup, run by startCareer right after the
   *  model id is assigned and before entryPhase. A model allocates its own
   *  state here (the mongoose flow creates mongooseState); models needing none
   *  omit it. */
  init?(ch: Character): void;
  /** Execute one action on the already-cloned, decision-cursor-armed working
   *  character. Mutates `ch` and returns the routing (+ optional UI hints).
   *  May throw ChoicePendingError — caught by the session's runAction
   *  boundary, never by the model. */
  execute(ch: Character, action: FrontierAction): ChargenResult;
  /** Phase to render if `action` pauses on a frontier choice (the base is the
   *  pristine pre-action character, for pre-increment accounting). */
  pausedPhase(action: FrontierAction, ch: Character, base: Character): ChargenPhase;
  /** Ordered stepper stages for this model (labels + member phases). */
  flowStages(): readonly FlowStage[];
}
