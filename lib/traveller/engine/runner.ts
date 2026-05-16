// Term-phase runner. Reads the active edition's lifecycle.terms declaration
// and walks each step in order through the step registry.
//
// Unknown step ids throw — that's a misconfiguration we want to catch at
// import/test time, not silently skip. Steps may set ch.deceased; subsequent
// steps no-op via their own guards rather than the runner short-circuiting,
// which makes step composition predictable.

import type { Character } from "../character";
import { getEdition } from "../editions";
import { STEP_REGISTRY } from "./steps";

export function runTermSteps(character: Character): void {
  // The character's editionId is authoritative — we don't accept an override
  // here. If callers need a specific edition, they construct a Character
  // with that editionId.
  const edition = getEdition(character.editionId);
  const lifecycle = edition.data.lifecycle;
  if (!lifecycle?.terms) {
    throw new Error(
      `Edition ${edition.meta.id} has no lifecycle.terms — cannot run term steps`,
    );
  }
  // ACG characters use lifecycle.acgTerms if the edition declares it; the
  // basic sequence is the fallback for plain characters.
  const sequence = character.useAcg && lifecycle.acgTerms
    ? lifecycle.acgTerms
    : lifecycle.terms;
  const service = character.serviceDef();
  for (const step of sequence) {
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
