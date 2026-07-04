// Term-phase runner. Reads the active edition's lifecycle.terms declaration
// and walks each step in order through the step registry.
//
// Unknown step ids throw — that's a misconfiguration we want to catch at
// import/test time, not silently skip. Steps may set ch.deceased; subsequent
// steps no-op via their own guards rather than the runner short-circuiting,
// which makes step composition predictable.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { STEP_REGISTRY } from "@/lib/traveller/engine/steps";
import { requireHook } from "@/lib/traveller/engine/registry";

/** Validate that every lifecycle.terms[i].id in this edition resolves
 *  against STEP_REGISTRY. Throws on any unknown id so JSON↔code drift
 *  surfaces at edition load, not at first runTermSteps call. No-op if
 *  the edition omits a lifecycle block (e.g., ACG-only editions). */
export function validateLifecycleSteps(editionId: string): void {
  const lifecycle = getEdition(editionId).data.lifecycle;
  if (!lifecycle?.terms) return;
  const unknown: string[] = [];
  for (const step of lifecycle.terms) {
    if (!STEP_REGISTRY[step.id]) unknown.push(step.id);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Edition "${editionId}" lifecycle.terms references unknown step id` +
      `${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. ` +
      `Available: ${Object.keys(STEP_REGISTRY).join(", ")}.`,
    );
  }
}

export function runTermSteps(ch: Character): void {
  // The character's editionId is authoritative — we don't accept an override
  // here. If callers need a specific edition, they construct a Character
  // with that editionId.
  const edition = getEdition(ch.editionId);
  const lifecycle = edition.data.lifecycle;
  if (!lifecycle?.terms) {
    throw new Error(
      `Edition ${edition.meta.id} has no lifecycle.terms — cannot run term steps`,
    );
  }
  if (ch.useAcg) {
    throw new Error(
      "runTermSteps is for basic chargen only; ACG characters use runAcgYear",
    );
  }
  const sequence = lifecycle.terms;
  const service = ch.serviceDef();
  for (const step of sequence) {
    // Halt the term early if chargen has formally ended for this character
    // — deceased / retired / mustered. Short-term status remains "active"-
    // ish so special-duty + skill steps still fire per PM p. 16.
    if (ch.isChargenEnded) return;
    const fn = requireHook(STEP_REGISTRY, step.id, () =>
      `Edition ${edition.meta.id}: unknown lifecycle step "${step.id}"`);
    fn({
      ch: ch,
      edition,
      service,
      config: step.config ?? {},
    });
  }
}
