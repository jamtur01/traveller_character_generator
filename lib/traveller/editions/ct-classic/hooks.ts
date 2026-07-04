// Classic Traveller edition-specific hooks. Any genuinely ad-hoc mechanic
// that doesn't fit the JSON data schema lives here, referenced by name from
// data/editions/ct-classic.json. Adding a hook = add a function and
// reference it in the JSON; that's the whole extension surface.

import type { Character } from "@/lib/traveller/character";
import type { EditionHooks } from "@/lib/traveller/editions/types";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";

/**
 * Nobles: after promotion, social standing is at least rank - rankOffset
 * (CotI p. 8: rank + 10 — Knight = 11, Baron = 12, …, Duke = 15), capped
 * at the edition's attribute maximum. The +1 Social per rank is encoded
 * as automaticSkills entries; this hook enforces the rank-keyed floor in
 * case the character's social was already lower than expected. Both the
 * mapping and the cap are strict-read from the edition JSON
 * (services.nobles.rankBySocial, rules.attributeCaps.max).
 */
function noblesSocialByRank(ch: Character): void {
  const edition = getEdition(ch.editionId);
  const rankRule = requireRule(
    edition.data.services.nobles?.rankBySocial,
    "services.nobles.rankBySocial", "CotI p. 8",
  );
  const max = requireRule(
    edition.rules.attributeCaps?.max, "rules.attributeCaps.max", "TTB p. 17",
  );
  const floor = ch.rank - rankRule.rankOffset;
  if (ch.attributes.social < floor) {
    ch.attributes.social = Math.min(floor, max);
  }
}

export const ctClassicHooks: EditionHooks = {
  doPromotion: {
    noblesSocialByRank,
  },
};
