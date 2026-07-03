// Basic-chargen DM evaluator. Sums the DM rules on a service check
// (enlistment / survival / commission / promotion) that apply to the
// character. Each rule is a Predicate (its condition — an attribute band)
// plus a value: `dm` (added when the predicate holds) or `dmPerTerm` (added
// per completed term when the predicate holds — Belter survival, PM p. 16).
// Delegates matching to the one interpreter in engine/predicate so basic
// chargen and ACG share a single condition DSL.

import type { Attributes } from "@/lib/traveller/types";
import type { DMRule } from "@/lib/traveller/editions/types";
import { evaluatePredicate, type PredicateContext } from "@/lib/traveller/engine/predicate";

/** Narrow context evaluateDM needs. Enlistment builds this from bare
 *  attributes (pre-term, terms=0) without a full Character. */
export interface DmContext {
  attributes: Attributes;
  terms: number;
}

export function evaluateDM(rules: DMRule[] | undefined, ctx: DmContext): number {
  if (!rules) return 0;
  const pctx: PredicateContext = { attributes: ctx.attributes, terms: ctx.terms };
  let total = 0;
  for (const r of rules) {
    if (r.dm === undefined && r.dmPerTerm === undefined) {
      throw new Error(`DMRule has neither dm nor dmPerTerm: ${JSON.stringify(r)}`);
    }
    if (!evaluatePredicate(r, pctx)) continue;
    if (r.dmPerTerm !== undefined) total += ctx.terms * r.dmPerTerm;
    else if (r.dm !== undefined) total += r.dm;
  }
  return total;
}
