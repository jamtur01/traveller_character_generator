// MT basic-service data audit: prior-service throws + muster-out tables for
// all 18 MegaTraveller services, checked against the printed Players' Manual.
//
// Source tables (MT Players' Manual, printed page numbers; PDF page = printed
// + 2), image-verified 2026-07-03 against high-DPI page renders:
//   - printed p.20: Navy, Marines, Army, Scouts, Flyer, Sailor
//   - printed p.22: Law Enforcer, Doctor, Diplomat, Bureaucrat, Scientist, Noble
//   - printed p.24: Merchant, Belter, Pirate, Rogue, Hunter, Barbarian
//
// Every EXPECTED value below is a hardcoded literal transcribed from the PM
// page images (see local://mt-basic-groundtruth.md). Only the ACTUAL side reads
// getEdition("mt-megatraveller"). The audit is therefore an INDEPENDENT PM
// record: a future JSON edit that drifts from the printed tables fails here.
//
// Array convention: 1-indexed for die rolls 1-7; index 0 is a null placeholder,
// and `null` inside a table = the printed em-dash "—". "Free Trader" is the
// JSON's expansion of the merchant table's abbreviated "Trader".

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";
import type { ServiceKey } from "../../lib/traveller";

// The 18 MT basic services (CT's catch-all "other" has no MT service table).
type MtService = Exclude<ServiceKey, "other">;

// Prior-service throw targets, keyed by check. `null` = the service has no such
// throw (scouts/doctors/scientists/belters/rogues/hunters have no Position or
// Promotion; nobles has no enlistment target — Social 10+ auto-enlists).
interface Throws {
  enlistment: number | null;
  survival: number | null;
  position: number | null;
  promotion: number | null;
  specialDuty: number | null;
  reenlistment: number | null;
}

interface ServiceTruth {
  throws: Throws;
  cash: (number | null)[];
  benefits: (string | null)[];
}

// Ground truth — hardcoded PM literals. NEVER derive these from getEdition().
const PM: Record<MtService, ServiceTruth> = {
  // ---- printed p.20 ----
  navy: {
    throws: { enlistment: 8, survival: 5, position: 10, promotion: 8, specialDuty: 5, reenlistment: 6 },
    cash: [null, 1000, 5000, 5000, 10000, 20000, 50000, 50000],
    benefits: [null, "Low Psg", "+1 Intelligence", "+2 Education", "Weapon", "Travellers'", "High Psg", "+2 Social"],
  },
  marines: {
    throws: { enlistment: 9, survival: 6, position: 9, promotion: 9, specialDuty: 4, reenlistment: 6 },
    cash: [null, 2000, 5000, 5000, 10000, 20000, 30000, 40000],
    benefits: [null, "Low Psg", "+2 Intelligence", "+1 Education", "Weapon", "Travellers'", "High Psg", "+2 Social"],
  },
  army: {
    throws: { enlistment: 5, survival: 5, position: 5, promotion: 6, specialDuty: 6, reenlistment: 7 },
    cash: [null, 2000, 5000, 10000, 10000, 10000, 20000, 30000],
    benefits: [null, "Low Psg", "+1 Intelligence", "+2 Education", "Weapon", "High Psg", "Mid Psg", "+1 Social"],
  },
  scouts: {
    throws: { enlistment: 7, survival: 7, position: null, promotion: null, specialDuty: 4, reenlistment: 3 },
    cash: [null, 20000, 20000, 30000, 30000, 50000, 50000, 50000],
    benefits: [null, "Low Psg", "+2 Intelligence", "+2 Education", "Weapon", "Weapon", "Scout Ship", null],
  },
  flyers: {
    throws: { enlistment: 6, survival: 5, position: 5, promotion: 8, specialDuty: 6, reenlistment: 6 },
    cash: [null, 2000, 5000, 10000, 10000, 10000, 20000, 30000],
    benefits: [null, "Low Psg", "+1 Education", "Weapon", "Weapon", "High Psg", "Mid Psg", "+1 Social"],
  },
  sailors: {
    throws: { enlistment: 6, survival: 5, position: 5, promotion: 6, specialDuty: 6, reenlistment: 6 },
    cash: [null, 2000, 5000, 10000, 10000, 10000, 20000, 30000],
    benefits: [null, "Low Psg", "+1 Intelligence", "+1 Education", "Weapon", "+1 Social", "High Psg", "Travellers'"],
  },
  // ---- printed p.22 ----
  lawenforcers: {
    throws: { enlistment: 6, survival: 6, position: 6, promotion: 8, specialDuty: 4, reenlistment: 6 },
    cash: [null, 1000, 2000, 5000, 7500, 10000, 25000, 50000],
    benefits: [null, "Low Psg", "+1 Intelligence", "Forensic Kit", "Weapon", "High Psg", "+1 Social", "Travellers'"],
  },
  doctors: {
    throws: { enlistment: 9, survival: 4, position: null, promotion: null, specialDuty: 6, reenlistment: 4 },
    cash: [null, 20000, 20000, 20000, 30000, 40000, 60000, 100000],
    benefits: [null, "Low Psg", "+1 Education", "+1 Education", "Weapon", "Instruments", "Mid Psg", null],
  },
  diplomats: {
    throws: { enlistment: 8, survival: 4, position: 5, promotion: 10, specialDuty: 5, reenlistment: 5 },
    cash: [null, 2000, 5000, 10000, 10000, 10000, 20000, 30000],
    benefits: [null, "Low Psg", "+1 Intelligence", "+2 Education", "Weapon", "+1 Social", "High Psg", "Travellers'"],
  },
  bureaucrats: {
    throws: { enlistment: 5, survival: 4, position: 6, promotion: 7, specialDuty: 6, reenlistment: 5 },
    cash: [null, null, null, 10000, 10000, 40000, 40000, 80000],
    benefits: [null, "Low Psg", "Mid Psg", null, "Watch", null, "High Psg", "+1 Social"],
  },
  scientists: {
    throws: { enlistment: 6, survival: 5, position: null, promotion: null, specialDuty: 5, reenlistment: 5 },
    cash: [null, 1000, 2000, 5000, 10000, 20000, 30000, 40000],
    benefits: [null, "Low Psg", "Mid Psg", "High Psg", "+1 Social", "Weapon", "Lab Ship", null],
  },
  nobles: {
    throws: { enlistment: null, survival: 4, position: 5, promotion: 12, specialDuty: 6, reenlistment: 4 },
    cash: [null, 10000, 10000, 50000, 50000, 100000, 100000, 200000],
    benefits: [null, "Low Psg", "High Psg", "Weapon", "Weapon", "Travellers'", "Yacht", null],
  },
  // ---- printed p.24 ----
  merchants: {
    throws: { enlistment: 7, survival: 5, position: 4, promotion: 10, specialDuty: 4, reenlistment: 4 },
    cash: [null, 1000, 5000, 10000, 10000, 10000, 20000, 50000],
    benefits: [null, "Low Psg", "+1 Intelligence", "+2 Education", "Weapon", "Weapon", "Low Psg", "Free Trader"],
  },
  belters: {
    throws: { enlistment: 8, survival: 9, position: null, promotion: null, specialDuty: 6, reenlistment: 6 },
    cash: [null, 0, 0, 1000, 10000, 100000, 100000, 100000],
    benefits: [null, "Low Psg", "+1 Intelligence", "Weapon", "High Psg", "Travellers'", "Seeker", null],
  },
  pirates: {
    throws: { enlistment: 7, survival: 6, position: 9, promotion: 8, specialDuty: 5, reenlistment: 7 },
    cash: [null, null, null, 1000, 10000, 50000, 50000, 50000],
    benefits: [null, "Low Psg", "+1 Intelligence", "Weapon", "Letter", "-1 Social", "Mid Psg", "Corsair"],
  },
  rogues: {
    throws: { enlistment: 6, survival: 7, position: null, promotion: null, specialDuty: 5, reenlistment: 5 },
    cash: [null, null, null, 10000, 10000, 50000, 100000, 100000],
    benefits: [null, "Low Psg", "+1 Social", "Weapon", "Weapon", "High Psg", "Travellers'", null],
  },
  hunters: {
    throws: { enlistment: 9, survival: 6, position: null, promotion: null, specialDuty: 6, reenlistment: 5 },
    cash: [null, 1000, 1000, 5000, 5000, 10000, 100000, 100000],
    benefits: [null, "Low Psg", "High Psg", "Weapon", "Weapon", "Weapon", "Safari Ship", null],
  },
  barbarians: {
    throws: { enlistment: 5, survival: 6, position: 6, promotion: 9, specialDuty: 7, reenlistment: 6 },
    cash: [null, null, null, 1000, 2000, 3000, 4000, 5000],
    benefits: [null, "Low Psg", "Weapon", "Weapon", "Weapon", null, "High Psg", "High Psg"],
  },
};

// ACTUAL side — the only reader of edition JSON. Collapses "check absent"
// (position/promotion === null) and "target null" (nobles enlistment) into the
// same `null` the printed em-dash represents.
function readThrows(svc: MtService): Throws {
  const { checks } = getEdition("mt-megatraveller").data.services[svc];
  return {
    enlistment: checks.enlistment?.target ?? null,
    survival: checks.survival?.target ?? null,
    position: checks.position?.target ?? null,
    promotion: checks.promotion?.target ?? null,
    specialDuty: checks.specialDuty?.target ?? null,
    reenlistment: checks.reenlistment?.target ?? null,
  };
}

const GROUPS: [string, MtService[]][] = [
  ["MT basic services — PM printed p.20 (Navy/Marines/Army/Scouts/Flyer/Sailor)",
    ["navy", "marines", "army", "scouts", "flyers", "sailors"]],
  ["MT basic services — PM printed p.22 (LawEnf/Doctor/Diplomat/Bureaucrat/Scientist/Noble)",
    ["lawenforcers", "doctors", "diplomats", "bureaucrats", "scientists", "nobles"]],
  ["MT basic services — PM printed p.24 (Merchant/Belter/Pirate/Rogue/Hunter/Barbarian)",
    ["merchants", "belters", "pirates", "rogues", "hunters", "barbarians"]],
];

for (const [title, services] of GROUPS) {
  describe(title, () => {
    for (const svc of services) {
      const truth = PM[svc];
      it(`${svc}: prior-service throw targets match PM`, () => {
        expect(readThrows(svc)).toEqual(truth.throws);
      });
      it(`${svc}: muster-out cash matches PM`, () => {
        expect(getEdition("mt-megatraveller").data.services[svc].musterOut.cash).toEqual(truth.cash);
      });
      it(`${svc}: muster-out benefits match PM`, () => {
        expect(getEdition("mt-megatraveller").data.services[svc].musterOut.benefits).toEqual(truth.benefits);
      });
    }
  });
}

// Explicit regression guards for the specific cells corrected in this pass.
// These duplicate coverage from the group audit above on purpose: each names
// exactly what was wrong before, so a regression points straight at the cell.
describe("MT basic services — corrected-cell regression guards", () => {
  it("Law Enforcer survival target is 6 (printed p.22)", () => {
    expect(readThrows("lawenforcers").survival).toBe(6);
  });
  it("Bureaucrat enlistment target is 5 (printed p.22)", () => {
    expect(readThrows("bureaucrats").enlistment).toBe(5);
  });
  it("Rogue enlistment target is 6 (printed p.24)", () => {
    expect(readThrows("rogues").enlistment).toBe(6);
  });
  it("Merchant muster cash die-roll 5 is 10000, not 20000 (printed p.24)", () => {
    expect(getEdition("mt-megatraveller").data.services.merchants.musterOut.cash[5]).toBe(10000);
  });
});
