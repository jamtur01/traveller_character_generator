// Term-phase runner. Reads the active edition's lifecycle.terms declaration
// and walks each step in order through the step registry.
//
// Unknown step ids throw — that's a misconfiguration we want to catch at
// import/test time, not silently skip. Steps may set ch.deceased; subsequent
// steps no-op via their own guards rather than the runner short-circuiting,
// which makes step composition predictable.

import type { Character } from "../character";
import { getEdition } from "../editions";
import type { Edition } from "../editions/types";
import { s } from "../services";
import { STEP_REGISTRY } from "./steps";

export function runTermSteps(
  character: Character,
  editionId?: string,
): void {
  const edition: Edition = getEdition(editionId);
  const lifecycle = edition.data.lifecycle;
  if (!lifecycle?.terms) {
    throw new Error(
      `Edition ${edition.meta.id} has no lifecycle.terms — cannot run term steps`,
    );
  }
  const service = s[character.service];
  for (const step of lifecycle.terms) {
    const fn = STEP_REGISTRY[step.id];
    if (!fn) {
      throw new Error(
        `Edition ${edition.meta.id}: unknown lifecycle step "${step.id}"`,
      );
    }
    fn({
      character,
      edition,
      service,
      config: step.config ?? {},
    });
  }
}
