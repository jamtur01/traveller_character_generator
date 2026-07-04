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
import {
  buildPredicateContext, sumPredicateDms, type Predicate,
} from "@/lib/traveller/engine/predicate";

type MusterDm = Predicate & { dm: number };

interface MusterRules {
  cashTableDm?: MusterDm[];
  benefitTableDm?: MusterDm;
  maxCashTableRolls?: number;
}

function rules(ch: Character): MusterRules | undefined {
  return getEdition(ch.editionId).rules.musterOutRolls as MusterRules | undefined;
}

/** Cash-table DM for this character: sum every matching rule's dm. */
export function cashDmFor(ch: Character): number {
  return sumPredicateDms(rules(ch)?.cashTableDm, buildPredicateContext(ch));
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
  const base = r?.maxCashTableRolls ?? 3;
  if (!ch.anagathics.anagathicsEverTaken) return base;
  const cap = getEdition(ch.editionId).rules.anagathics?.cashRollCap ?? 2;
  return Math.min(cap, base);
}
