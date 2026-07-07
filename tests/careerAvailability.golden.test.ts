// Characterization ("golden") lock for availableServicesForHomeworld's
// careerAvailability gating. Phase-9c will (a) delete the DEAD legacy
// denyIf* schema+code branches and (b) add a fail-loud guard for an
// unknown gate key. Both must be behavior-preserving, so this file pins
// the EXACT denied-service set the current engine produces across a set
// of representative homeworlds that exercise each of the 9 gate rules
// both triggered and not triggered.
//
// Engine facts (mt-megatraveller.json homeworld block, HEAD 99b6440):
//   techCodeOrder    = [Pre-Industrial, Industrial, Pre-Stellar,
//                       Early Stellar, Avg Stellar, High Stellar]
//   populationOrder  = [Low Pop, Mod Pop, High Pop]
//   lawOrder         = [No Law, Low Law, Mod Law, High Law, Ext Law]
//   atmosphereOrder  = [Vacuum, Thin, Standard, Dense, Exotic]
//   hydrosphereOrder = [Desert, Dry, Wet World, Water World]
// A service is DENIED when a rule's condition FAILS (meetsOrder: value's
// index in the order array must be >= the threshold's index).
//
// JSON↔PM citation locks for the rollTable/starportXRoll/defaultSkills
// live in tests/audit/mt.json.audit.test.ts; engine behaviour for the
// rest of homeworld.ts lives in tests/homeworld.test.ts. This file adds
// ONLY the full-universe exact-set careerAvailability characterization
// (the three availableServicesForHomeworld cases already in
// tests/homeworld.test.ts are partial subset checks via toContain /
// not.toContain over a hand-picked service subset; the rows below
// supersede them with exact denied-set assertions over the full MT
// service universe, so they are not duplicated here).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  availableServicesForHomeworld, type Homeworld,
} from "../lib/traveller/engine/homeworld";
import type { ServiceKey } from "../lib/traveller/types";

// The full MT service universe (mt-megatraveller.json serviceOrder), used
// as the enlistable input so the denied set is deterministic and every
// gate rule has a target. Includes nobles (auto-enrolled in the real
// pool) precisely so the requiresSocialAtLeast/requiresTechAtLeast gates
// on nobles are exercised.
const UNIVERSE: ServiceKey[] = [
  "navy", "marines", "army", "scouts", "merchants", "pirates", "belters",
  "sailors", "diplomats", "doctors", "flyers", "barbarians", "bureaucrats",
  "rogues", "scientists", "hunters", "lawenforcers", "nobles",
];

function available(social: number, hw: Homeworld): ServiceKey[] {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.attributes.social = social;
  return availableServicesForHomeworld(c, hw, [...UNIVERSE]);
}

interface Scenario {
  name: string;
  social: number;
  hw: Homeworld;
  /** Exact set of services the current engine denies for this UWP. */
  denied: ServiceKey[];
}

const SCENARIOS: Scenario[] = [
  {
    // Baseline: everything at/above threshold; tech well past every tier;
    // Soc exactly 10 (nobles boundary, just inside). Only barbarians
    // (requiresTechExactly Pre-Industrial) are denied.
    name: "core world (High Stellar/High Pop/Ext Law/Exotic/Water World, Soc 10)",
    social: 10,
    hw: {
      starport: "A", size: "Large", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "High Pop", law: "Ext Law",
      tech: "High Stellar",
    },
    denied: ["barbarians"],
  },
  {
    // Every requires* gate fails EXCEPT requiresTechExactly Pre-Industrial:
    // only barbarians survive. Exercises the trigger side of all 9 rules
    // at once and the non-trigger side of rule 4 (barbarians).
    name: "primitive world (Pre-Industrial/Low Pop/No Law/Vacuum/Desert, Soc 5)",
    social: 5,
    hw: {
      starport: "X", size: "Small", atmosphere: "Vacuum",
      hydrosphere: "Desert", population: "Low Pop", law: "No Law",
      tech: "Pre-Industrial",
    },
    denied: [
      "navy", "marines", "army", "scouts", "merchants", "pirates", "belters",
      "sailors", "diplomats", "doctors", "flyers", "bureaucrats", "rogues",
      "scientists", "hunters", "lawenforcers", "nobles",
    ],
  },
  {
    // Tech = Industrial: requiresTechAtLeast Industrial passes (just
    // inside → lawenforcers/doctors/diplomats/rogues/flyers survive),
    // but Pre-Stellar and Early Stellar tiers still deny.
    name: "industrial world (Industrial tech, all non-tech gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "C", size: "Medium", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "High Pop", law: "Ext Law",
      tech: "Industrial",
    },
    denied: [
      "navy", "marines", "army", "scouts", "merchants", "pirates", "belters",
      "barbarians", "scientists", "nobles",
    ],
  },
  {
    // Tech = Pre-Stellar (exactly the requiresTechAtLeast Pre-Stellar
    // threshold, just inside): army/marines/navy/scientists/nobles
    // survive; Early Stellar tier still denies scouts/merchants/belters/
    // pirates.
    name: "pre-stellar world (Pre-Stellar tech, non-tech gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "C", size: "Medium", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "High Pop", law: "Ext Law",
      tech: "Pre-Stellar",
    },
    denied: ["scouts", "merchants", "pirates", "belters", "barbarians"],
  },
  {
    // Tech = Early Stellar (exactly the highest tech threshold, just
    // inside): every requiresTechAtLeast rule passes → only barbarians
    // denied. Boundary partner to the pre-stellar world above.
    name: "early-stellar world (Early Stellar tech, non-tech gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "B", size: "Medium", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "High Pop", law: "Ext Law",
      tech: "Early Stellar",
    },
    denied: ["barbarians"],
  },
  {
    // Isolates requiresPopulationAtLeast Mod Pop: Low Pop (just outside)
    // denies bureaucrats + flyers; all other gates pass.
    name: "low-pop world (Low Pop, all other gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "A", size: "Large", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "Low Pop", law: "Ext Law",
      tech: "High Stellar",
    },
    denied: ["flyers", "bureaucrats", "barbarians"],
  },
  {
    // Isolates requiresLawAtLeast Low Law: No Law (just outside) denies
    // bureaucrats + diplomats; all other gates pass.
    name: "anarchic world (No Law, all other gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "A", size: "Large", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "High Pop", law: "No Law",
      tech: "High Stellar",
    },
    denied: ["diplomats", "bureaucrats", "barbarians"],
  },
  {
    // Isolates requiresAtmosphereAtLeast Thin: Vacuum (just outside)
    // denies flyers + hunters; all other gates pass.
    name: "vacuum world (Vacuum atmosphere, all other gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "A", size: "Large", atmosphere: "Vacuum",
      hydrosphere: "Water World", population: "High Pop", law: "Ext Law",
      tech: "High Stellar",
    },
    denied: ["flyers", "hunters", "barbarians"],
  },
  {
    // Isolates requiresHydrosphereAtLeast Wet World: Dry (just outside)
    // denies sailors; all other gates pass.
    name: "dry world (Dry hydrosphere, all other gates passing, Soc 10)",
    social: 10,
    hw: {
      starport: "A", size: "Large", atmosphere: "Exotic",
      hydrosphere: "Dry", population: "High Pop", law: "Ext Law",
      tech: "High Stellar",
    },
    denied: ["sailors", "barbarians"],
  },
  {
    // Isolates requiresSocialAtLeast 10: Soc 9 (just outside) denies
    // nobles even though tech is High Stellar; all other gates pass.
    // Boundary partner to the Soc-10 core world above.
    name: "commoner world (Soc 9, all UWP gates passing)",
    social: 9,
    hw: {
      starport: "A", size: "Large", atmosphere: "Exotic",
      hydrosphere: "Water World", population: "High Pop", law: "Ext Law",
      tech: "High Stellar",
    },
    denied: ["nobles", "barbarians"],
  },
  {
    // Exact-inside boundary for the four *AtLeast non-tech gates at once:
    // Mod Pop / Low Law / Thin / Wet World are each the minimum passing
    // value → none of bureaucrats/flyers/diplomats/hunters/sailors are
    // denied. Only barbarians (tech != Pre-Industrial) is denied.
    name: "threshold-exact world (Mod Pop/Low Law/Thin/Wet World, Soc 10)",
    social: 10,
    hw: {
      starport: "A", size: "Medium", atmosphere: "Thin",
      hydrosphere: "Wet World", population: "Mod Pop", law: "Low Law",
      tech: "High Stellar",
    },
    denied: ["barbarians"],
  },
];

describe("availableServicesForHomeworld — careerAvailability golden lock", () => {
  for (const s of SCENARIOS) {
    it(`denies exactly [${s.denied.join(", ")}] — ${s.name}`, () => {
      // Guard against typos in the golden data itself.
      for (const d of s.denied) expect(UNIVERSE).toContain(d);

      const out = available(s.social, s.hw);
      const deniedSet = new Set<ServiceKey>(s.denied);
      const actualDenied = UNIVERSE.filter((svc) => !out.includes(svc));

      // Denied set exactly (the characterized contract), in universe order.
      expect(actualDenied).toEqual(UNIVERSE.filter((svc) => deniedSet.has(svc)));
      // …and therefore the available list exactly.
      expect(out).toEqual(UNIVERSE.filter((svc) => !deniedSet.has(svc)));
    });
  }
});

// ---------------------------------------------------------------------------
// Dead-legacy-deletion safety: the raw JSON's careerAvailability rules use
// ONLY the requires* gate keys the engine handles — never the legacy
// denyIf* form. This is the teeth for both the DEAD-code deletion (the
// denyIfTechIn/denyIfTechNotIn/denyIfSocialBelow branches + schema fields)
// and the upcoming fail-loud unknown-gate-key guard: if a rule ever grows
// an unhandled key, this lock (like the guard) fails.
// ---------------------------------------------------------------------------

interface RawMt {
  homeworld: { careerAvailability: Array<Record<string, unknown>> };
}

const RAW = JSON.parse(
  readFileSync(
    resolve(__dirname, "../data/editions/mt-megatraveller.json"),
    "utf8",
  ),
) as RawMt;

const CA_RULES = RAW.homeworld.careerAvailability;

// The seven gate keys availableServicesForHomeworld actually enforces
// (homeworld.ts:184-210), plus the services target.
const HANDLED_GATE_KEYS = [
  "requiresTechAtLeast", "requiresTechExactly", "requiresPopulationAtLeast",
  "requiresLawAtLeast", "requiresAtmosphereAtLeast",
  "requiresHydrosphereAtLeast", "requiresSocialAtLeast",
];
const LEGACY_KEYS = ["denyIfTechIn", "denyIfTechNotIn", "denyIfSocialBelow"];

describe("careerAvailability JSON gate-key contract", () => {
  it("declares exactly 9 rules", () => {
    expect(CA_RULES.length).toBe(9);
  });

  it("uses only the engine-handled requires* gate keys (no unknown key)", () => {
    const used = new Set<string>();
    for (const rule of CA_RULES) {
      for (const key of Object.keys(rule)) {
        if (key !== "services") used.add(key);
      }
    }
    expect([...used].sort()).toEqual([...HANDLED_GATE_KEYS].sort());
  });

  it("uses no legacy denyIf* key (its schema+code deletion is safe)", () => {
    for (const rule of CA_RULES) {
      for (const legacy of LEGACY_KEYS) {
        expect(rule).not.toHaveProperty(legacy);
      }
    }
  });

  it("every rule targets a non-empty services array", () => {
    for (const rule of CA_RULES) {
      expect(Array.isArray(rule.services)).toBe(true);
      expect((rule.services as unknown[]).length).toBeGreaterThan(0);
    }
  });
});
