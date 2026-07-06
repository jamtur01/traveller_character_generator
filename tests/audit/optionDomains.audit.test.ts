// Option-domain audit-lock — PILOT for "option-domain promotion".
//
// Re-architecture goal: every player decision domain in chargen becomes a
// first-class, $rule-cited enumerable JSON array, read through ONE accessor
//
//     optionDomain(editionId, decisionId) -> { field, values }
//
// where `decisionId` is a dotted key (e.g. "acg.navy.fleet"), `field` is the
// character property the choice writes into (e.g. "acgFleet"), and `values`
// is the declared, order-significant enumerable sourced from the edition JSON.
//
// THE LOCK PATTERN (copy this shape for the ~19 domains that follow):
//   A domain is only trustworthy if its DECLARED JSON list can never silently
//   drift from the AUTHORITATIVE CONSUMER KEYS the engine actually reads. So
//   each lock pins the declared `values` against every independent consumer of
//   that same set, each source read SEPARATELY (never re-derived from the
//   accessor under test):
//     1. exact `field` name — which character property this domain drives.
//     2. exact `values` in DECLARATION ORDER — the golden enumerable (UI order,
//        $rule ordering) as a literal, so a reorder or typo reddens the suite.
//     3. `values` set == an authoritative consumer's key set (order-insensitive)
//        — here `Object.keys(navy.rankCaps)`, read straight from the edition
//        JSON. Rename a fleet in one place but not the other -> RED.
//     4. every declared value is a present key in a second consumer — here the
//        `navy.enlistment` fleet entries. A declared fleet with no enlistment
//        row -> RED.
//   The two consumer sources (rankCaps, enlistment) are loaded from the raw
//   edition JSON, NOT from optionDomain(), so the two sides of the equality are
//   genuinely independent — that independence is what gives the lock its teeth.
//
// TEETH: mutate the declared list, the field name, a rankCaps key, or an
// enlistment fleet key in isolation and exactly one assertion here fails,
// naming the drift. Keep all four in sync and it stays green.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";

// Consumer side: read the authoritative consumer keys/values straight from the
// edition JSON, using the house audit pattern (see
// editions.structural.audit.test.ts). This deliberately does NOT go through
// optionDomain() — each lock compares two independent sources.
const MT_PATH = resolve(__dirname, "../../data/editions/mt-megatraveller.json");
const mt = JSON.parse(readFileSync(MT_PATH, "utf8")) as {
  advancedCharacterGeneration: {
    mercenary: {
      reenlistment: Record<string, unknown>;
      combatArmEligibility: Record<string, unknown>;
    };
    navy: {
      enlistment: Record<string, unknown>;
      rankCaps: Record<string, number>;
    };
    scout: {
      skillTables: Record<string, unknown>;
      officeAssignment: { columns: readonly string[] };
    };
    merchantPrince: { enlistment: { rows: ReadonlyArray<{ typeOfLine: string }> } };
  };
  homeworld: { techCodeOrder: readonly string[] };
};
const acg = mt.advancedCharacterGeneration;
const navy = acg.navy;

describe("option-domain audit-locks", () => {
  it("navy.fleets declared list === enlistment fleet keys === rankCaps keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.navy.fleet");

    // (1) field — the character property this decision writes into.
    expect(domain.field).toBe("acgFleet");

    // (2) declared enumerable, in declaration order (golden literal).
    expect(domain.values).toEqual([
      "imperialNavy",
      "reserveFleet",
      "systemSquadron",
    ]);

    // (3) same SET as the rankCaps consumer keys (order-insensitive).
    const rankCapKeys = Object.keys(navy.rankCaps);
    expect([...domain.values].sort()).toEqual([...rankCapKeys].sort());

    // (4) every declared fleet is a present key in the enlistment consumer.
    for (const fleet of domain.values) {
      expect(
        Object.prototype.hasOwnProperty.call(navy.enlistment, fleet),
        `navy.enlistment is missing declared fleet "${fleet}"`,
      ).toBe(true);
    }
  });

  // acg.mercenary.service — the two mercenary services chosen at enlistment.
  // Independent consumers (both raw JSON, never via the accessor):
  //   - PM pp. 50-51 — advancedCharacterGeneration.mercenary.reenlistment holds
  //     one per-service target block keyed EXACTLY by {army, marines}. (Its
  //     sibling `enlistment` adds a "draft" key and `combatArmEligibility` adds
  //     "$rule"/"armGates", so reenlistment is the only clean 2-key set.)
  //   - PM p. 50 — mercenary.combatArmEligibility gates each service's combat
  //     arms; every declared service must be a present whitelist key there.
  it("acg.mercenary.service declared list === mercenary.reenlistment per-service keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.mercenary.service");

    expect(domain.field).toBe("acgService");
    expect(domain.values).toEqual(["army", "marines"]);

    const reenlistKeys = Object.keys(acg.mercenary.reenlistment);
    expect([...domain.values].sort()).toEqual([...reenlistKeys].sort());

    for (const service of domain.values) {
      expect(
        Object.prototype.hasOwnProperty.call(acg.mercenary.combatArmEligibility, service),
        `combatArmEligibility is missing declared service "${service}"`,
      ).toBe(true);
    }
  });

  // acg.navy.subsectorTech — the subsector tech ceiling offered at navy
  // enlistment. The leading "" is the "use the homeworld tech code as-is"
  // sentinel (PM p. 52, navy.enlistment.$ruleSubsectorTechMinimum: "the
  // subsector tech code is the homeworld tech code, at minimum Early Stellar");
  // it has NO tech-order entry, so the lock pins ONLY the non-empty subset.
  // Independent consumers (both raw JSON):
  //   - PM p. 52 — homeworld.techCodeOrder, the full tech-code ladder.
  //   - PM p. 52 — navy.enlistment.subsectorTechMinimum ("Early Stellar"), the
  //     floor at which the offered contiguous top-slice begins.
  it("acg.navy.subsectorTech non-empty subset === techCodeOrder top-slice", () => {
    const domain = optionDomain("mt-megatraveller", "acg.navy.subsectorTech");

    expect(domain.field).toBe("acgSubsectorTech");
    expect(domain.values).toEqual([
      "",
      "Early Stellar",
      "Avg Stellar",
      "High Stellar",
    ]);

    // "" is the homeworld-default sentinel, not a tech-order code; lock only
    // the non-empty options against the ladder read from raw JSON.
    const nonEmpty = domain.values.filter((v) => v !== "");
    const techOrder = mt.homeworld.techCodeOrder;

    for (const tech of nonEmpty) {
      expect(techOrder, `techCodeOrder is missing offered tech "${tech}"`).toContain(tech);
    }
    // ...and they are the CONTIGUOUS TOP slice, in tech-order order.
    expect(nonEmpty).toEqual(techOrder.slice(techOrder.length - nonEmpty.length));
    // the slice begins exactly at the navy enlistment floor (PM p. 52).
    const floor = navy.enlistment.subsectorTechMinimum as string;
    expect(techOrder.indexOf(floor)).toBe(techOrder.length - nonEmpty.length);
  });

  // acg.scout.division — the two scout divisions (Field vs Bureaucracy).
  // Independent consumers (both raw JSON):
  //   - PM pp. 58-59 — advancedCharacterGeneration.scout.skillTables holds one
  //     skill table per division, keyed EXACTLY by {field, bureaucracy}.
  //   - PM p. 56 — scout.officeAssignment.columns minus the "die" roll column
  //     resolves to the same two divisions.
  it("acg.scout.division declared list === scout.skillTables keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.scout.division");

    expect(domain.field).toBe("acgDivision");
    expect(domain.values).toEqual(["field", "bureaucracy"]);

    const skillTableKeys = Object.keys(acg.scout.skillTables);
    expect([...domain.values].sort()).toEqual([...skillTableKeys].sort());

    const officeDivisions = acg.scout.officeAssignment.columns.filter((c) => c !== "die");
    expect([...domain.values].sort()).toEqual([...officeDivisions].sort());
  });

  // acg.merchant.lineType — the six merchant line types joined at enlistment.
  // Independent consumer: PM p. 60 — advancedCharacterGeneration.merchantPrince
  // .enlistment.rows[].typeOfLine, one enlistment row per line type, declared in
  // the same order as the offered enumerable (raw JSON, never via the accessor).
  it("acg.merchant.lineType declared list === enlistment typeOfLine set", () => {
    const domain = optionDomain("mt-megatraveller", "acg.merchant.lineType");

    expect(domain.field).toBe("acgLineType");
    expect(domain.values).toEqual([
      "Megacorp",
      "Sector-wide",
      "Subsector-wide",
      "Interface",
      "Fledgling",
      "Free Trader",
    ]);

    const rowLineTypes = acg.merchantPrince.enlistment.rows.map((r) => r.typeOfLine);
    expect([...domain.values].sort()).toEqual([...rowLineTypes].sort());
  });

  // acg.pathway — the four ACG pathways the character enlists into.
  // Independent consumer: PM pp. 48-63 — Object.keys(advancedCharacterGeneration)
  // minus the non-pathway meta keys {common, source, coverage, homeworld,
  // pathways}, exactly mirroring listAcgPathways() in
  // lib/traveller/engine/acg.ts:39-42. Read straight from raw JSON.
  it("acg.pathway declared list === advancedCharacterGeneration pathway keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.pathway");

    expect(domain.field).toBe("acgPathway");
    expect(domain.values).toEqual(["mercenary", "navy", "scout", "merchantPrince"]);

    const NON_PATHWAY_KEYS: Record<string, true> = {
      common: true,
      source: true,
      coverage: true,
      homeworld: true,
      pathways: true,
    };
    const pathwayKeys = Object.keys(acg).filter((k) => !NON_PATHWAY_KEYS[k]);
    expect([...domain.values].sort()).toEqual([...pathwayKeys].sort());
  });
});
