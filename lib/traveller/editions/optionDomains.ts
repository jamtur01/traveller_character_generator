// Option-domain accessor — the single entry point for reading a player
// decision's declared, $rule-cited enumerable out of the edition JSON.
//
//     optionDomain(editionId, decisionId) -> { field, values }
//
// `decisionId` is a dotted key (e.g. "acg.navy.fleet"); `field` names the
// character property the choice writes into (e.g. "acgFleet"); `values` is
// the declared, order-significant enumerable sourced from the edition JSON.
//
// REGISTERING THE NEXT DOMAIN (this is the pattern for the ~18 that follow):
//   Add one entry to the DOMAINS table below, keyed by its dotted decisionId:
//     "<pathway>.<thing>": {
//       field: "<characterProperty>",
//       read: (editionId) =>
//         requireRule(
//           getAcgPathway(editionId, "<pathway>")?.<jsonKey> as
//             readonly string[] | undefined,
//           "advancedCharacterGeneration.<pathway>.<jsonKey>",
//           "<rulebook p. N citation>",
//         ),
//     },
//   The declared JSON array MUST carry a sibling `$rule…` citation and is
//   read fail-loud via requireRule — never a `?? literal` fallback.

import { getAcgPathway } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";

export interface OptionDomain {
  field: string;
  values: readonly string[];
}

/** Registry entry: the character `field` a domain drives, plus a fail-loud
 *  `read` that sources its declared enumerable from cited edition JSON. */
interface DomainSource {
  field: string;
  read: (editionId: string) => readonly string[];
}

const DOMAINS: Record<string, DomainSource> = {
  "acg.navy.fleet": {
    field: "acgFleet",
    read: (editionId) =>
      requireRule(
        getAcgPathway(editionId, "navy")?.fleets as
          | readonly string[]
          | undefined,
        "advancedCharacterGeneration.navy.fleets",
        "PM p. 52",
      ),
  },
};

/** Resolve an option domain to its target field and declared enumerable.
 *  Throws on an unregistered `decisionId` (fail-loud) and on missing JSON
 *  data (via requireRule) so drift surfaces immediately rather than as a
 *  silently empty dropdown. */
export function optionDomain(
  editionId: string,
  decisionId: string,
): OptionDomain {
  const source = DOMAINS[decisionId];
  if (!source) {
    throw new Error(
      `optionDomain: unknown decisionId "${decisionId}". Register it in ` +
        "the DOMAINS table in lib/traveller/editions/optionDomains.ts.",
    );
  }
  return { field: source.field, values: source.read(editionId) };
}
