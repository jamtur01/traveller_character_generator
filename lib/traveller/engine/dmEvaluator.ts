// Interpret a JSON DM rule array against a Character. Each rule is one of:
//   { modifier: N, attribute: "intelligence", min: 8 }   → +N if attr >= 8
//   { modifier: N, attribute: "social", max: 7 }         → +N if attr <= 7
//   { modifier: "termNumber" }                           → +terms (Belter survival)
//
// Multiple rules sum.

import type { Attributes, AttributeKey } from "../types";
import type { DMRule } from "../editions/types";

/** Narrow context that evaluateDM actually needs. Accepting this instead
 *  of the full Character lets serviceLoader's enlistment-DM helper pass
 *  in a {attributes, terms} bag without an unsafe cast — and ensures we
 *  can't accidentally widen the evaluator to read other Character state
 *  without an explicit interface change. */
export interface DmContext {
  attributes: Attributes;
  terms: number;
}

export function evaluateDM(rules: DMRule[] | undefined, ch: DmContext): number {
  if (!rules) return 0;
  let total = 0;
  for (const r of rules) {
    if (r.modifier === "termNumber") {
      total += ch.terms;
      continue;
    }
    if (typeof r.modifier !== "number") continue;
    if (!r.attribute) {
      total += r.modifier;
      continue;
    }
    const v = ch.attributes[r.attribute as AttributeKey];
    if (v === undefined) continue;
    if (r.min !== undefined && v < r.min) continue;
    if (r.max !== undefined && v > r.max) continue;
    total += r.modifier;
  }
  return total;
}
