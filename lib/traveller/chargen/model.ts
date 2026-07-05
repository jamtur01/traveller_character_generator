// The single seam the session and UI drive character generation through.
//
// A ChargenModel owns one edition-style flow (classic / acg / mongoose). The
// session is a thin dispatcher over the registered model for the character's
// editionId + chosen model; it contains no edition names and no `if (useAcg)`.
// Edition-specific behaviour lives in (a) the edition JSON and (b) that
// edition's model — never in shared code.
//
// Runtime dependency direction is session -> modelRegistry -> models -> core.
// This module only depends on session/character types, imported with
// `import type` so they are erased at runtime (no import cycle).

import type { Character } from "@/lib/traveller/character";
import type {
  ChargenSnapshot,
  EnlistOptions,
  PreCareerOption,
  UiHints,
} from "@/lib/traveller/chargen/session";

/** A phase id is opaque to the session/UI; each model owns its own phase
 *  vocabulary. Existing models reuse the ChargenPhase strings; new models
 *  (Mongoose) introduce their own. */
export type PhaseId = string;

/** UI descriptor for a phase: which panel component to render + stepper label.
 *  Lets `app/page.tsx` map phase -> component without a hard-coded switch. */
export interface PhaseDescriptor {
  panel: string;
  stepperLabel: string;
}

/** The superset of player actions the session can dispatch. Each model handles
 *  the subset valid in its phases and throws on the rest (the session only
 *  dispatches actions valid for the current phase). */
export type ModelAction =
  | { kind: "chooseCareerOrService"; value: string }
  | { kind: "enlist"; opts: EnlistOptions }
  | { kind: "runTerm" }
  | { kind: "pickSkillTable"; table: number | string }
  | { kind: "musterChoice"; choice: "cash" | "benefit" }
  | { kind: "resolvePending"; choiceId: string; optionIdx: number }
  | { kind: "preCareer"; option: PreCareerOption };

export interface ModelActionResult {
  snapshot: ChargenSnapshot;
  hints?: UiHints;
}

/** One edition-style chargen flow. */
export interface ChargenModel {
  /** Registry key: "classic" | "acg" | "mongoose". */
  readonly id: string;
  /** Player-facing label (model selector UI). */
  readonly label: string;
  /** Phase to show immediately after the model is selected / attributes rolled. */
  entryPhase(ch: Character): PhaseId;
  /** Advance the flow: apply `action` in `snap.phase`, return the next snapshot
   *  (possibly paused on a frontier choice). */
  advance(snap: ChargenSnapshot, action: ModelAction): ModelActionResult;
  /** UI descriptor for a phase. */
  describePhase(phase: PhaseId, ch: Character): PhaseDescriptor;
}
