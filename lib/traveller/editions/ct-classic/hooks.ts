// Classic Traveller edition-specific hooks. Any genuinely ad-hoc mechanic
// that doesn't fit the JSON data schema lives here, referenced by name from
// data/editions/ct-classic.json. Adding a hook = add a function and
// reference it in the JSON; that's the whole extension surface.

import type { Character } from "../../character";
import type { EditionHooks } from "../types";

/**
 * Nobles: after promotion, social standing is at least rank + 10
 * (Knight = 11, Baron = 12, …, Duke = 15). The +1 Social per rank is
 * encoded as automaticSkills entries; this hook enforces the rank-keyed
 * floor in case the character's social was already lower than expected.
 */
function noblesSocialByRank(ch: Character): void {
  const floor = ch.rank + 10;
  if (ch.attributes.social < floor && ch.attributes.social < 15) {
    ch.attributes.social = Math.min(floor, 15);
  }
}

export const ctClassicHooks: EditionHooks = {
  doPromotion: {
    noblesSocialByRank,
  },
};
