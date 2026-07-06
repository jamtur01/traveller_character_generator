// Coverage matrix — the exhaustive-by-construction enumeration of every
// {edition, chargen model, service | pathway+picks | career} combination the
// Phase-2 correctness-oracle driver walks. It is registry-driven: every
// enumerable VALUE (services, pathways, fleets, subsector-tech options,
// divisions, line types, careers) is sourced at call time from the option-
// domain accessor + the edition/service registries, never from a hardcoded
// list. Add a service / fleet / line type / career to the edition JSON and a
// new combo appears here automatically; the tests/coverageMatrix.test.ts self-
// check proves that coverage stays total.
//
// The only string literals below are (a) decisionId KEYS passed to
// optionDomain (its API — e.g. "acg.navy.fleet"), (b) chargen-model registry
// ids read back from EditionMeta.chargenModels, (c) EnlistOptions FIELD names
// (the picks are keyed by the field each domain drives), and (d) the "random"
// enlistment sentinel. None of those is a service / pathway / fleet / career
// VALUE — those are all read through optionDomain / getEnlistableServices /
// getAcgPathway / listEditions.

import { listEditions, getAcgPathway } from "@/lib/traveller/editions";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";

// --- Chargen-model registry ids (EditionMeta.chargenModels), not domain values.
const CLASSIC_MODEL = "classic";
const ACG_MODEL = "acg";
const MONGOOSE_MODEL = "mongoose";

// --- optionDomain decisionId keys (the accessor's API — a dotted key names the
//     domain to read; the VALUES come back from the accessor, never inlined).
const CLASSIC_SERVICE = "classic.service";
const ACG_PATHWAY = "acg.pathway";
const MERCENARY_SERVICE = "acg.mercenary.service";
const NAVY_FLEET = "acg.navy.fleet";
const NAVY_SUBSECTOR_TECH = "acg.navy.subsectorTech";
const SCOUT_DIVISION = "acg.scout.division";
const MERCHANT_LINE_TYPE = "acg.merchant.lineType";
const MONGOOSE_CAREER = "mongoose.career";

/** The "pick a random service" sentinel (EnlistOptions.preferredService); the
 *  engine rolls enlistment when it sees this, so it is not a service value. */
const RANDOM_SERVICE = "random";

/** EnlistOptions field the mercenary combat-arm choice drives. The combat arm
 *  is the one ACG sub-decision with no optionDomain (its enumerable is read
 *  from getAcgPathway per PM p. 50, an allowed registry source), so its field
 *  name is named here rather than returned by optionDomain. */
const COMBAT_ARM_FIELD = "acgCombatArm";

/** One combo the exhaustive driver consumes. Discriminated on chargen model:
 *  - classic: a single preferred `service` (a getEnlistableServices key, or the
 *    "random" sentinel) fed to walkBasic / session.enlist.
 *  - acg: a `pathway` plus `picks` keyed by the EnlistOptions field each ACG
 *    sub-domain drives (acgService, acgCombatArm, acgFleet, acgSubsectorTech,
 *    acgDivision, acgLineType).
 *  - mongoose: the in-flow `career` id to attempt (a mongoose.career value). */
export type CoverageCombo =
  | { readonly edition: string; readonly model: "classic"; readonly service: string }
  | {
      readonly edition: string;
      readonly model: "acg";
      readonly pathway: string;
      readonly picks: Readonly<Record<string, string>>;
    }
  | { readonly edition: string; readonly model: "mongoose"; readonly career: string };

/** One cross-product axis: the EnlistOptions field it drives and its values. */
interface Dimension {
  readonly field: string;
  readonly values: readonly string[];
}

/** ACG pathway groups: the sub-domain decisionIds whose optionDomain values are
 *  crossed to form each pathway's combos. The pathway itself is NOT named here
 *  — it is matched from optionDomain(ACG_PATHWAY) by the decisionId's pathway
 *  segment (`"acg.navy.fleet"` -> `"navy"`, which prefixes the pathway value
 *  "navy"; `"acg.merchant.lineType"` -> `"merchant"`, which prefixes
 *  "merchantPrince"), so a pathway rename in JSON flows through without edits
 *  here. `combatArm` marks the group that also crosses the (domain-less)
 *  combat-arm enumerable. */
const ACG_GROUPS: readonly { readonly cross: readonly string[]; readonly combatArm: boolean }[] = [
  { cross: [MERCENARY_SERVICE], combatArm: true },
  { cross: [NAVY_FLEET, NAVY_SUBSECTOR_TECH], combatArm: false },
  { cross: [SCOUT_DIVISION], combatArm: false },
  { cross: [MERCHANT_LINE_TYPE], combatArm: false },
];

/** Cartesian product of the dimensions into pick records keyed by field. An
 *  empty dimension is skipped so a missing optional sub-choice never collapses
 *  the whole product to zero combos. */
function crossDimensions(dims: readonly Dimension[]): Array<Record<string, string>> {
  let acc: Array<Record<string, string>> = [{}];
  for (const dim of dims) {
    if (dim.values.length === 0) continue;
    const next: Array<Record<string, string>> = [];
    for (const partial of acc) {
      for (const value of dim.values) next.push({ ...partial, [dim.field]: value });
    }
    acc = next;
  }
  return acc;
}

/** Selectable combat arms for a mercenary-family pathway: the declared arms
 *  minus the per-arm gated ones (PM p. 50 — Commando needs a Military Academy
 *  honors grad). Read from getAcgPathway (an allowed registry source; there is
 *  no combat-arm optionDomain), mirroring the equivalence-harness driver. */
function combatArmsFor(edition: string, pathway: string): readonly string[] {
  const data = getAcgPathway(edition, pathway) as
    | { combatArms?: readonly string[]; combatArmEligibility?: { armGates?: Record<string, unknown> } }
    | undefined;
  const gated = new Set(Object.keys(data?.combatArmEligibility?.armGates ?? {}));
  return (data?.combatArms ?? []).filter((arm) => !gated.has(arm));
}

/** classic: one combo per enlistable service plus the "random" sentinel. The
 *  service enumerable is read from optionDomain(CLASSIC_SERVICE), whose values
 *  the audit-lock proves identical to getEnlistableServices. */
function classicCombos(edition: string): CoverageCombo[] {
  const services = optionDomain(edition, CLASSIC_SERVICE).values;
  return [RANDOM_SERVICE, ...services].map(
    (service): CoverageCombo => ({ edition, model: "classic", service }),
  );
}

/** acg: for each declared pathway, the cross-product of its sub-domains. */
function acgCombos(edition: string): CoverageCombo[] {
  const pathways = optionDomain(edition, ACG_PATHWAY).values;
  const combos: CoverageCombo[] = [];
  for (const group of ACG_GROUPS) {
    const segment = group.cross[0]!.split(".")[1]!;
    const pathway = pathways.find((p) => p.startsWith(segment));
    if (pathway === undefined) continue; // pathway not offered by this edition
    const dims: Dimension[] = group.cross.map((decision) => {
      const domain = optionDomain(edition, decision);
      if (domain.field === undefined) {
        throw new Error(
          `coverageMatrix: ACG sub-domain "${decision}" has no enlist field to key its picks`,
        );
      }
      return { field: domain.field, values: domain.values };
    });
    if (group.combatArm) {
      dims.push({ field: COMBAT_ARM_FIELD, values: combatArmsFor(edition, pathway) });
    }
    for (const picks of crossDimensions(dims)) {
      combos.push({ edition, model: "acg", pathway, picks });
    }
  }
  return combos;
}

/** mongoose: one combo per voluntary career (forcedOnly careers excluded by the
 *  domain). The career is an in-flow pickOrDefer choice, so it rides on the
 *  combo directly rather than an EnlistOptions field. */
function mongooseCombos(edition: string): CoverageCombo[] {
  return optionDomain(edition, MONGOOSE_CAREER).values.map(
    (career): CoverageCombo => ({ edition, model: "mongoose", career }),
  );
}

/** Enumerate every {active edition, chargen model, decision picks} combo the
 *  exhaustive driver must walk. Sourced entirely from listEditions +
 *  optionDomain + getAcgPathway, so the enumeration is total by construction:
 *  the self-check test proves no active edition/model, service, pathway, or
 *  career is omitted. Throws (fail-loud) on an unknown chargen model so a newly
 *  registered model can never silently escape coverage. */
export function coverageMatrix(): CoverageCombo[] {
  const combos: CoverageCombo[] = [];
  for (const meta of listEditions()) {
    if (meta.status !== "active") continue;
    for (const model of meta.chargenModels) {
      switch (model) {
        case CLASSIC_MODEL:
          combos.push(...classicCombos(meta.id));
          break;
        case ACG_MODEL:
          combos.push(...acgCombos(meta.id));
          break;
        case MONGOOSE_MODEL:
          combos.push(...mongooseCombos(meta.id));
          break;
        default:
          throw new Error(
            `coverageMatrix: edition "${meta.id}" declares unknown chargen model ` +
              `"${model}" — extend the matrix to enumerate its combos.`,
          );
      }
    }
  }
  return combos;
}
