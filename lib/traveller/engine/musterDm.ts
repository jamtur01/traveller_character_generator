// Edition-aware muster-out DM computation. The cash / benefit DMs are
// declared in JSON under rules.musterOutRolls as unified Predicate rules
// (see engine/predicate): the cash table sums every matching rule's dm; the
// benefit table is a single rule.
//
// CT conditions: Gambling-1 → cash +1; rank ≥ 5 → benefit +1.
// MT conditions: as CT, plus Retired → cash +1 and Prospecting-1 → cash +1
//   (Prospecting only for merchants/belters/pirates/rogues/hunters/barbarians,
//   expressed as the rule's serviceIn atom).

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import {
  buildPredicateContext, evaluatePredicate, sumPredicateDms, type Predicate,
} from "@/lib/traveller/engine/predicate";

type MusterDm = Predicate & { dm: number };

interface MusterRules {
  cashTableDm?: MusterDm[];
  // CotI (CT) 'not cumulative' footnote: when false, cashDmFor takes the single
  // largest matching rule's dm instead of summing. Absent = additive (MT).
  cashTableDmCumulative?: boolean;
  benefitTableDm?: MusterDm;
  maxCashTableRolls?: number;
}

function rules(ch: Character): MusterRules | undefined {
  return getEdition(ch.editionId).rules.musterOutRolls as MusterRules | undefined;
}

/** Cash-table DM for this character. Sums every matching rule's dm, unless the
 *  edition marks the cash DM non-cumulative (CotI p. 6/8: "+1 if Gambling-1+ OR
 *  retired — not cumulative"), in which case only the single largest matching
 *  dm applies. MT omits the flag and keeps the additive default. */
export function cashDmFor(ch: Character): number {
  const r = rules(ch);
  const ctx = buildPredicateContext(ch);
  if (r?.cashTableDmCumulative === false) {
    let best = 0;
    for (const rule of r.cashTableDm ?? []) {
      if (evaluatePredicate(rule, ctx) && rule.dm > best) best = rule.dm;
    }
    return best;
  }
  return sumPredicateDms(r?.cashTableDm, ctx);
}

/** Benefit-table DM for this character: the single rule's dm if it matches. */
export function benefitDmFor(ch: Character): number {
  const b = rules(ch)?.benefitTableDm;
  return b ? sumPredicateDms([b], buildPredicateContext(ch)) : 0;
}

/** Max cash rolls allowed per character (CT and MT: 3). Anagathics users
 *  are permanently capped per the edition's rules.anagathics.cashRollCap
 *  (MT PM p. 15). */
export function maxCashRolls(ch: Character): number {
  const r = rules(ch);
  const base = requireRule(
    r?.maxCashTableRolls, "rules.musterOutRolls.maxCashTableRolls", "TTB p. 18 / PM p. 17",
  );
  if (!ch.anagathics.anagathicsEverTaken) return base;
  const cap = requireRule(
    getEdition(ch.editionId).rules.anagathics?.cashRollCap,
    "rules.anagathics.cashRollCap", "PM p. 16",
  );
  return Math.min(cap, base);
}
