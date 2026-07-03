// Step infrastructure for the term-phase lifecycle. Each edition's JSON
// declares an ordered list of steps under lifecycle.terms; the runner walks
// that list and dispatches each id through the registry below.
//
// Adding a new mechanic = drop a step function in this directory, register
// it in index.ts, and reference its id from the edition's JSON. The Character
// and ServiceDef stay the same.

import type { Character } from "@/lib/traveller/character";
import type { ServiceDef } from "@/lib/traveller/types";
import type { Edition } from "@/lib/traveller/editions/types";

export interface StepContext {
  character: Character;
  edition: Edition;
  /** The runtime ServiceDef for the character's current career. */
  service: ServiceDef;
  /** Step-specific config copied from lifecycle.terms[i].config. */
  config: Record<string, unknown>;
}

export type StepFn = (ctx: StepContext) => void;

export type StepRegistry = Record<string, StepFn>;
