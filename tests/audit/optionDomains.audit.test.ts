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
import { getEnlistableServices } from "@/lib/traveller/services";
import { listEditions } from "@/lib/traveller/editions";

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

// ---------------------------------------------------------------------------
// classic.service — the CT (Classic Traveller) / MT (MegaTraveller, non-ACG)
// BASIC service-selection domain, and the biggest branch domain (CT registers
// 18 services). Unlike the MT-ACG domains above, its enumerable does not live
// in a pathway block: `serviceOrder` is a NEW top-level JSON array giving the
// presentation/enlistment order of ALL of an edition's services (CT: the
// service-selection table, TTB p. 18), and `optionDomain("classic.service")`
// returns the ENLISTABLE subset — serviceOrder minus every service whose
// checks.enlistment.automaticIf gate is set. In CT that drops the nobles:
// per Citizens of the Imperium a Soc 10+ character is auto-enrolled as a noble
// rather than voluntarily enlisting, so nobles never appear in the enlistment
// pool. The enlistable subset is therefore exactly getEnlistableServices(ed),
// today's authoritative runtime list (lib/traveller/services.ts).
//
// Parameterized over every ACTIVE edition carrying the "classic" chargen model,
// mirroring data.validation.test.ts's ACTIVE_EDITIONS filter, so a new classic
// edition is locked automatically.
//
// Independent sources (each read SEPARATELY, never re-derived from the accessor
// under test — that independence is the lock's teeth):
//   - `serviceOrder`, read raw from the edition JSON.
//   - Object.keys(services), read raw from the edition JSON.
//   - getEnlistableServices(ed), the current authoritative runtime enlistable
//     list computed in lib/traveller/services.ts.
//   - the automaticIf-gated service set, read raw from each service's
//     checks.enlistment.automaticIf.
//
// TEETH: rename/reorder a service key, add or drop a serviceOrder entry, flip a
// service's automaticIf gate, or change getEnlistableServices, and exactly one
// assertion below reddens, naming the drift.
const CLASSIC_EDITIONS = listEditions().filter(
  (e) => e.status === "active" && e.chargenModels.includes("classic"),
);
if (CLASSIC_EDITIONS.length === 0) {
  throw new Error(
    "No active classic editions registered — classic.service lock cannot run",
  );
}

describe("option-domain audit-locks — classic.service", () => {
  for (const meta of CLASSIC_EDITIONS) {
    const ed = meta.id;
    it(`${ed}: serviceOrder covers all services && optionDomain(classic.service)===getEnlistableServices`, () => {
      // Consumer side: the edition JSON, read raw (never via the accessor).
      const raw = JSON.parse(
        readFileSync(
          resolve(__dirname, `../../data/editions/${ed}.json`),
          "utf8",
        ),
      ) as {
        serviceOrder: readonly string[];
        services: Record<
          string,
          { checks: { enlistment: { automaticIf?: unknown } } }
        >;
      };

      const domain = optionDomain(ed, "classic.service");

      // (a) field — the character property this decision writes into.
      expect(domain.field).toBe("preferredService");

      // (b) declared serviceOrder SET === services key SET: the order lists
      // every service (none missing) and names no phantom (none extra).
      const serviceKeys = Object.keys(raw.services);
      expect([...raw.serviceOrder].sort()).toEqual([...serviceKeys].sort());

      // (c) enlistable subset, in order === the authoritative runtime list.
      expect(domain.values).toEqual(getEnlistableServices(ed));

      // (d) teeth: the services serviceOrder drops from the enlistable subset
      // are EXACTLY those carrying an enlistment automaticIf gate (CT nobles,
      // auto-enrolled per Citizens of the Imperium). serviceOrder and the
      // automaticIf set come from raw JSON; the enlistable list from the
      // runtime — three independent sources reconciled here.
      const enlistable = new Set<string>(getEnlistableServices(ed));
      const excluded = raw.serviceOrder.filter((k) => !enlistable.has(k));
      const automaticIf = serviceKeys.filter(
        (k) => raw.services[k]?.checks.enlistment.automaticIf != null,
      );
      expect([...excluded].sort()).toEqual([...automaticIf].sort());
    });
  }
});
