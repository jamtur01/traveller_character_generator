// Registry of chargen models. Each model file registers itself at module load
// via registerModel(); the session resolves the model for a character through
// getChargenModel(ch.chargenModelId). Runtime dependency direction:
// session -> modelRegistry -> models -> core (no cycle back to session).

import type { ChargenModel } from "@/lib/traveller/chargen/model";

const REGISTRY: Record<string, ChargenModel> = {};

/** Register a chargen model. Called once per model at module load. */
export function registerModel(model: ChargenModel): void {
  REGISTRY[model.id] = model;
}

/** Resolve a model id to its implementation. Throws (listing the available
 *  ids) on an unknown id so misconfiguration surfaces loudly at run, not as a
 *  silent no-op. */
export function getChargenModel(id: string): ChargenModel {
  const model = REGISTRY[id];
  if (!model) {
    throw new Error(
      `unknown chargen model "${id}"; available: ` +
        `${Object.keys(REGISTRY).join(", ") || "(none registered)"}`,
    );
  }
  return model;
}

/** Registered model ids (encapsulates the module-private registry; used for
 *  edition-load validation and diagnostics). */
export function listChargenModels(): string[] {
  return Object.keys(REGISTRY);
}
