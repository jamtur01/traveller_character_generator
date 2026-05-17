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
