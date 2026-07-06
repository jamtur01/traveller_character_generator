// Option-domain accessor — the single entry point for reading a player
// decision's declared, $rule-cited enumerable out of the edition JSON.
//
//     optionDomain(editionId, decisionId) -> { field, values }
//
// `decisionId` is a dotted key (e.g. "acg.navy.fleet"); `field` names the
// character property the choice writes into (e.g. "acgFleet"); `values` is
// the declared, order-significant enumerable sourced from the edition JSON.
//
// `field` is the `EnlistOptions` field the Phase-2 exhaustive driver writes
// into (the canonical chargen layer) — distinct from any UI form-state field.
// Its type-level binding to `keyof EnlistOptions` is enforced by a
// chargen-layer test added in Phase 2.
//
// REGISTERING THE NEXT DOMAIN (this is the pattern for the ~18 that follow):
//   Add one entry to the DOMAINS table below, keyed by its dotted decisionId:
//     "<pathway>.<thing>": {
//       field: "<enlistOptionsField>",
//       read: (editionId) => /* fail-loud editionId -> readonly string[] */,
//     },
//   `read` is ANY reader that maps an editionId to the declared enumerable and
//   fails loud (via requireRule) when the cited JSON key is absent — never a
//   `?? literal` fallback. The source varies per engine: MT-ACG domains read a
//   pathway block via getAcgPathway (readAcgPathwayStringArray helper) or, for
//   enumerables at the advancedCharacterGeneration ROOT, via readAcgRootStringArray;
//   Mongoose-2e and CT-basic domains supply their own readers and will NOT use
//   getAcgPathway. Citation rule: the declared JSON array normally carries a
//   sibling `$rule…` key — EXCEPT arrays at the advancedCharacterGeneration root
//   (e.g. `pathways`), which cite in-code in the requireRule call instead, because
//   the structural/architecture audits treat any non-meta root key (a `$rule…`
//   sibling included) as a service pathway and would misclassify it.

import { getAcgPathway, getEdition } from "@/lib/traveller/editions";
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

/** MT-ACG source pattern: read a declared, order-significant `readonly
 *  string[]` from a named ACG pathway's JSON block, failing loud via
 *  requireRule when the key is absent. The thrown path is edition-scoped
 *  (`<editionId>: <what>`) so a missing key names the offending edition file;
 *  `jsonKey` indexes the pathway block and `rule` is the printed citation. */
function readAcgPathwayStringArray(
  editionId: string,
  pathway: string,
  jsonKey: string,
  what: string,
  rule: string,
): readonly string[] {
  return requireRule(
    getAcgPathway(editionId, pathway)?.[jsonKey] as
      | readonly string[]
      | undefined,
    `${editionId}: ${what}`,
    rule,
  );
}

/** ACG-root source pattern: read a declared, order-significant `readonly
 *  string[]` from the advancedCharacterGeneration root (NOT a pathway
 *  block — e.g. the pathway enumerable itself), failing loud via
 *  requireRule when the key is absent. Edition-scoped throw path names
 *  the offending edition file; `rule` is the printed citation. */
function readAcgRootStringArray(
  editionId: string,
  jsonKey: string,
  what: string,
  rule: string,
): readonly string[] {
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
  return requireRule(
    acg?.[jsonKey] as readonly string[] | undefined,
    `${editionId}: ${what}`,
    rule,
  );
}

const DOMAINS: Record<string, DomainSource> = {
  "acg.mercenary.service": {
    field: "acgService",
    read: (editionId) =>
      readAcgPathwayStringArray(
        editionId,
        "mercenary",
        "services",
        "advancedCharacterGeneration.mercenary.services",
        "PM p. 50",
      ),
  },
  "acg.navy.fleet": {
    field: "acgFleet",
    read: (editionId) =>
      readAcgPathwayStringArray(
        editionId,
        "navy",
        "fleets",
        "advancedCharacterGeneration.navy.fleets",
        "PM p. 52",
      ),
  },
  "acg.navy.subsectorTech": {
    field: "acgSubsectorTech",
    read: (editionId) =>
      readAcgPathwayStringArray(
        editionId,
        "navy",
        "subsectorTechOptions",
        "advancedCharacterGeneration.navy.subsectorTechOptions",
        "PM p. 52",
      ),
  },
  "acg.scout.division": {
    field: "acgDivision",
    read: (editionId) =>
      readAcgPathwayStringArray(
        editionId,
        "scout",
        "divisions",
        "advancedCharacterGeneration.scout.divisions",
        "PM p. 56",
      ),
  },
  "acg.merchant.lineType": {
    field: "acgLineType",
    read: (editionId) =>
      readAcgPathwayStringArray(
        editionId,
        "merchantPrince",
        "lineTypes",
        "advancedCharacterGeneration.merchantPrince.lineTypes",
        "PM p. 60",
      ),
  },
  "acg.pathway": {
    field: "acgPathway",
    read: (editionId) =>
      readAcgRootStringArray(
        editionId,
        "pathways",
        "advancedCharacterGeneration.pathways",
        "PM p. 44/64",
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
      `optionDomain(edition "${editionId}"): unknown decisionId ` +
        `"${decisionId}". Register it in the DOMAINS table in ` +
        "lib/traveller/editions/optionDomains.ts.",
    );
  }
  return { field: source.field, values: source.read(editionId) };
}
