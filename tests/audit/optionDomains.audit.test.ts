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

// Consumer side: read the authoritative fleet keys straight from the edition
// JSON, using the house audit pattern (see editions.structural.audit.test.ts).
// This deliberately does NOT go through optionDomain() — the lock compares two
// independent sources.
const MT_PATH = resolve(__dirname, "../../data/editions/mt-megatraveller.json");
const mt = JSON.parse(readFileSync(MT_PATH, "utf8")) as {
  advancedCharacterGeneration: {
    navy: {
      enlistment: Record<string, unknown>;
      rankCaps: Record<string, number>;
    };
  };
};
const navy = mt.advancedCharacterGeneration.navy;

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
});
