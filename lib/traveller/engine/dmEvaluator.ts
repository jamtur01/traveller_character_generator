// Interpret a JSON DM rule array against a Character. Each rule is one of:
//   { modifier: N, attribute: "intelligence", min: 8 }   → +N if attr >= 8
//   { modifier: N, attribute: "social", max: 7 }         → +N if attr <= 7
//   { modifier: "termNumber" }                           → +terms (Belter survival)
//
// Multiple rules sum.

import type { Character } from "../character";
import type { AttributeKey } from "../types";
import type { DMRule } from "../editions/types";

export function evaluateDM(rules: DMRule[] | undefined, ch: Character): number {
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
