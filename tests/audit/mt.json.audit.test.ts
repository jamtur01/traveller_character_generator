// Data-audit tests for mt-megatraveller.json. These verify the JSON
// content matches the MegaTraveller Players' Manual and the engine's
// expected shape conventions. They do NOT exercise the engine — engine
// behavior is covered by the corresponding *.test.ts files in
// tests/. Failures here mean the JSON drifted from the source, not that
// the engine is broken.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const json = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../data/editions/mt-megatraveller.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const acg = (json.advancedCharacterGeneration ?? {}) as Record<string, unknown>;
const mercenary = (acg.mercenary ?? {}) as Record<string, unknown>;
const navy = (acg.navy ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// DM-array shape: every DM entry is an object with a numeric `dm` field
// (no surviving free-text rules from earlier extraction passes).
// ---------------------------------------------------------------------------

describe("MT JSON DM arrays are structured, not free-text strings", () => {
  function assertStructured(dms: unknown) {
    expect(Array.isArray(dms)).toBe(true);
    const arr = dms as unknown[];
    for (const d of arr) {
      expect(typeof d).toBe("object");
      expect(d).not.toBeNull();
      expect(typeof (d as { dm?: unknown }).dm).toBe("number");
    }
  }
  it("navy.branchAssignment.dms", () => {
    assertStructured((navy.branchAssignment as { dms: unknown }).dms);
  });
  it("navy.commandDuty.dms", () => {
    assertStructured((navy.commandDuty as { dms: unknown }).dms);
  });
  it("navy.specialAssignments.dms", () => {
    assertStructured((navy.specialAssignments as { dms: unknown }).dms);
  });
  it("mercenary.specialAssignments.dms", () => {
    assertStructured((mercenary.specialAssignments as { dms: unknown }).dms);
  });
});

// ---------------------------------------------------------------------------
// PM citation locks (data values vs. the printed manual).
// ---------------------------------------------------------------------------

describe("Navy fleet-specific reenlistment targets (PM p. 53)", () => {
  const reenl = (navy.reenlistment ?? {}) as {
    perFleet?: Record<string, { target: number; dms: unknown[] }>;
  };
  it("per-fleet block exists for all three fleets", () => {
    expect(reenl.perFleet).toBeDefined();
    expect(Object.keys(reenl.perFleet!).sort()).toEqual(
      ["imperialNavy", "reserveFleet", "systemSquadron"],
    );
  });
  it("System Squadron reenlistment target is 5 (per manual p. 53)", () => {
    expect(reenl.perFleet!.systemSquadron!.target).toBe(5);
  });
  it("Imperial Navy and Reserve Fleet reenlistment targets are 6", () => {
    expect(reenl.perFleet!.imperialNavy!.target).toBe(6);
    expect(reenl.perFleet!.reserveFleet!.target).toBe(6);
  });
});

describe("Navy per-fleet officer rank caps (PM p. 55 line 3504)", () => {
  // Engine-side enforcement of these caps is verified in
  // tests/navyRankCaps.test.ts. This block is the data-citation lock so
  // an unintended JSON edit shows up against the PM page.
  it("rankCaps: Imperial Navy 10, Reserve Fleet 8, System Squadron 7", () => {
    const caps = (navy as { rankCaps: Record<string, number> }).rankCaps;
    expect(caps.imperialNavy).toBe(10);
    expect(caps.reserveFleet).toBe(8);
    expect(caps.systemSquadron).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Pathway → resolution sub-table mappings (consistency check on JSON).
// Engine-side use of these mappings is exercised in tests/acg.runtime.test.ts.
// ---------------------------------------------------------------------------

describe("Pathway → resolution sub-table mappings live in JSON", () => {
  it("mercenary.combatArmResolution maps every combat arm to a sub-table", () => {
    const map = mercenary.combatArmResolution as Record<string, string>;
    const arms = mercenary.combatArms as string[];
    expect(map).toBeDefined();
    const resKeys = Object.keys(
      mercenary.assignmentResolution as Record<string, unknown>,
    );
    for (const arm of arms) {
      expect(map[arm]).toBeDefined();
      expect(resKeys).toContain(map[arm]);
    }
  });

  it("navy.branchResolution maps every branch to a sub-table", () => {
    const map = navy.branchResolution as Record<string, string>;
    const branches = navy.branches as string[];
    expect(map).toBeDefined();
    const resKeys = Object.keys(
      navy.assignmentResolution as Record<string, unknown>,
    );
    for (const branch of branches) {
      expect(map[branch]).toBeDefined();
      expect(resKeys).toContain(map[branch]);
    }
  });
});

// ---------------------------------------------------------------------------
// Survival failure mode (PM p. 16) — JSON declares non-death failure.
// Engine-side behaviour for shortTerm survival is in tests/mt.architecture.test.ts.
// ---------------------------------------------------------------------------

describe("MT rules.survival.onFailure declares 'shortTerm' (PM p. 16)", () => {
  it("rules.survival.onFailure is 'shortTerm'", () => {
    const rules = json.rules as { survival?: { onFailure?: string } };
    expect(rules.survival?.onFailure).toBe("shortTerm");
  });
});

// ---------------------------------------------------------------------------
// Homeworld table (PM p. 12-13) — cell-for-cell audit against the manual.
// Engine-side behaviour is in tests/homeworld.test.ts.
// ---------------------------------------------------------------------------

interface ManualRow {
  die: number;
  starport: string;
  size: string;
  atmosphere: string;
  hydrosphere: string;
  population: string;
  law: string;
  tech: string;
}

const MANUAL_ROWS: ManualRow[] = [
  { die: 2,  starport: "A",   size: "Asteroid", atmosphere: "Vacuum",   hydrosphere: "Desert",      population: "Low Pop",  law: "No Law",    tech: "Pre-Industrial" },
  { die: 3,  starport: "A",   size: "Small",    atmosphere: "Vacuum",   hydrosphere: "Desert",      population: "Low Pop",  law: "Low Law",   tech: "Industrial" },
  { die: 4,  starport: "A",   size: "Small",    atmosphere: "Thin",     hydrosphere: "Dry",         population: "Mod Pop",  law: "Low Law",   tech: "Industrial" },
  { die: 5,  starport: "A",   size: "Small",    atmosphere: "Thin",     hydrosphere: "Dry",         population: "Mod Pop",  law: "Mod Law",   tech: "Pre-Stellar" },
  { die: 6,  starport: "A",   size: "Small",    atmosphere: "Standard", hydrosphere: "Wet World",   population: "Mod Pop",  law: "Mod Law",   tech: "Pre-Stellar" },
  { die: 7,  starport: "B",   size: "Medium",   atmosphere: "Standard", hydrosphere: "Wet World",   population: "Mod Pop",  law: "Mod Law",   tech: "Early Stellar" },
  { die: 8,  starport: "B",   size: "Medium",   atmosphere: "Standard", hydrosphere: "Wet World",   population: "High Pop", law: "Mod Law",   tech: "Early Stellar" },
  { die: 9,  starport: "B",   size: "Medium",   atmosphere: "Dense",    hydrosphere: "Wet World",   population: "High Pop", law: "Mod Law",   tech: "Avg Stellar" },
  { die: 10, starport: "C",   size: "Large",    atmosphere: "Dense",    hydrosphere: "Wet World",   population: "High Pop", law: "High Law",  tech: "Avg Stellar" },
  { die: 11, starport: "C",   size: "Large",    atmosphere: "Exotic",   hydrosphere: "Wet World",   population: "High Pop", law: "High Law",  tech: "High Stellar" },
  { die: 12, starport: "D-X", size: "Large",    atmosphere: "Exotic",   hydrosphere: "Water World", population: "High Pop", law: "Ext Law",   tech: "High Stellar" },
];

describe("MT homeworld JSON matches PM p. 12 cell-for-cell", () => {
  const rows = (json.homeworld as { rollTable: { rows: ManualRow[] } }).rollTable.rows;

  it("table has 11 rows (rolls 2-12)", () => {
    expect(rows).toHaveLength(11);
  });

  for (const m of MANUAL_ROWS) {
    it(`row die=${m.die} matches manual cell-for-cell`, () => {
      const r = rows.find((r) => r.die === m.die);
      expect(r).toBeDefined();
      expect(r!.starport).toBe(m.starport);
      expect(r!.size).toBe(m.size);
      expect(r!.atmosphere).toBe(m.atmosphere);
      expect(r!.hydrosphere).toBe(m.hydrosphere);
      expect(r!.population).toBe(m.population);
      expect(r!.law).toBe(m.law);
      expect(r!.tech).toBe(m.tech);
    });
  }
});

describe("MT homeworld starport X follow-up roll matches PM", () => {
  it("1-3 → D, 4-5 → E, 6 → X", () => {
    const r = (json.homeworld as { starportXRoll: { results: Record<string, string> } })
      .starportXRoll.results;
    expect(r["1"]).toBe("D");
    expect(r["2"]).toBe("D");
    expect(r["3"]).toBe("D");
    expect(r["4"]).toBe("E");
    expect(r["5"]).toBe("E");
    expect(r["6"]).toBe("X");
  });
});

describe("Edition lifecycle.terms declarations vs PM", () => {
  it("ct-classic.lifecycle.terms has no specialDuty step", () => {
    const ctJson = JSON.parse(
      readFileSync(resolve(__dirname, "../../data/editions/ct-classic.json"), "utf8"),
    ) as { lifecycle?: { terms?: Array<{ id: string }> } };
    const terms = ctJson.lifecycle?.terms ?? [];
    expect(terms.some((t) => t.id === "specialDuty")).toBe(false);
  });

  it("mt-megatraveller.lifecycle.terms includes specialDuty", () => {
    const terms = ((json.lifecycle as { terms?: Array<{ id: string }> }).terms ?? []);
    expect(terms.some((t) => t.id === "specialDuty")).toBe(true);
  });
});

describe("MT homeworld defaultSkills match PM p. 13", () => {
  it("includes the five canonical entries", () => {
    const ds = (json.homeworld as {
      defaultSkills: Array<{
        skill: string;
        level: number;
        when?: {
          serviceIn?: string[];
          serviceNotIn?: string[];
          techAtLeast?: string;
          techIn?: string[];
        };
      }>;
    }).defaultSkills;
    // Vacc Suit-0 for navy/marines/flyers/scouts/merchants/pirates.
    expect(ds.some((d) =>
      d.skill === "Vacc Suit" &&
      d.when?.serviceIn?.includes("navy") === true,
    )).toBe(true);
    // Gun Combat-0 for all except barbarians.
    expect(ds.some((d) =>
      d.skill === "Gun Combat" &&
      d.when?.serviceNotIn?.includes("barbarians") === true,
    )).toBe(true);
    // Computer-0 for Early Stellar+.
    expect(ds.some((d) =>
      d.skill === "Computer" && d.when?.techAtLeast === "Early Stellar",
    )).toBe(true);
    // Grav Vehicle-0 for Avg Stellar+.
    expect(ds.some((d) =>
      d.skill === "Grav Vehicle" && d.when?.techAtLeast === "Avg Stellar",
    )).toBe(true);
    // Wheeled Vehicle-0 for Industrial/Pre-Stellar/Early Stellar.
    expect(ds.some((d) =>
      d.skill === "Wheeled Vehicle" && d.when?.techIn?.includes("Industrial") === true,
    )).toBe(true);
  });
});
