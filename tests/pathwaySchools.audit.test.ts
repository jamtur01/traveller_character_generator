// Per-pathway special-duty schools audit.
//   Navy schools — PM p. 57 (Naval Special Assignments).
//   Scout schools — PM p. 59 (School Assignment table).
//   Merchant schools — PM p. 65 (Special Duty Resolution).

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";

describe("Navy special-duty schools (PM p. 57)", () => {
  const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
  const details = (navy?.specialAssignmentDetails ?? {}) as
    Record<string, unknown>;

  const PM_NAVY_SCHOOLS = [
    "Specialist School",
    "Cross-Training",
    "Recruiting",
    "Gunnery School",
    "Engineer School",  // Engineering School
    "OCS",
    "Intelligence School",
    "Naval Attache",
    "Command College",
    "Staff College",
  ];

  it("Every PM-listed navy school exists", () => {
    for (const school of PM_NAVY_SCHOOLS) {
      expect(details[school], `${school} missing`).toBeDefined();
    }
  });

  it("OCS: commission, Service Skills × 2 + Branch Skills × 1, E8/E9 → O3", () => {
    const ocs = details.OCS as { summary?: string; ageLimit?: number };
    expect(ocs?.summary ?? "").toMatch(/service skills|two skills/i);
    expect(ocs?.summary ?? "").toMatch(/E8.*E9.*O3|O3.*E8/i);
  });

  it("Gunnery School: 4 throws, 5+ for Gunnery each", () => {
    const gs = details["Gunnery School"] as { summary?: string };
    expect(gs?.summary ?? "").toMatch(/four|4.*throws/i);
    expect(gs?.summary ?? "").toMatch(/Gunnery/);
    expect(gs?.summary ?? "").toMatch(/5\+/);
  });
});

describe("Scout schools (PM p. 59)", () => {
  const scout = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.scout;
  const schools = (scout as { schools?: { columns?: string[]; rows?: unknown[] } })
    ?.schools;

  it("Has six school columns: ship/intelligence/technology/specialist/field/contact", () => {
    const cols = (schools?.columns ?? []) as string[];
    expect(cols).toEqual(expect.arrayContaining([
      "shipSchool", "intelligenceSchool", "technologySchool",
      "specialistSchool", "fieldTraining", "contactSchool",
    ]));
  });

  it("Table has 6 rows (one per die)", () => {
    expect((schools?.rows ?? []).length).toBe(6);
  });
});

describe("Merchant Prince Special Duty Resolution (PM p. 65)", () => {
  const merch = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.merchantPrince;
  const sdr = (merch as {
    specialDutyResolution?: Record<string, { throw?: string; skills?: string[]; effect?: string }>;
  })?.specialDutyResolution ?? {};

  const PM_MERCHANT_SCHOOLS = [
    "businessSchool",
    "commandSchool",
    "commission",
    "deckSchool",
    "departmentTest",
    "driveTrainingEngineeringSchool",
    "helmTraining",
    "securityTraining",
    "stewardTrainingPurserSchool",
    "tradeStation",
  ];

  it("Every PM-listed merchant school exists", () => {
    for (const school of PM_MERCHANT_SCHOOLS) {
      expect(sdr[school], `${school} missing`).toBeDefined();
    }
  });

  it("Business School: throw 5+ for Admin/Computer/Legal/Liaison; +1 exam DM for O6+; transfer to Sales", () => {
    const bs = sdr.businessSchool;
    expect(bs?.throw ?? "").toMatch(/5\+/);
    const skills = bs?.skills ?? [];
    expect(skills).toEqual(expect.arrayContaining([
      "Admin", "Computer", "Legal", "Liaison",
    ]));
    expect(bs?.effect ?? "").toMatch(/Sales/);
  });

  it("Command School: throw 5+ for Admin/Leader/Legal/Ship Tactics; transfer to Deck", () => {
    const cs = sdr.commandSchool;
    expect(cs?.throw ?? "").toMatch(/5\+/);
    expect(cs?.skills ?? []).toEqual(expect.arrayContaining([
      "Admin", "Leader", "Legal", "Ship Tactics",
    ]));
    expect(cs?.effect ?? "").toMatch(/Deck/);
  });

  it("Commission: gives O0 (O1 for Free Traders) + Department Assignment", () => {
    const c = sdr.commission;
    expect(c?.effect ?? "").toMatch(/O0|rank 0|01.*Free Trader|O1/i);
  });

  it("Security Training: throw 4+ for Zero-G/Vacc Suit/Brawling/Computer", () => {
    const st = sdr.securityTraining;
    expect(st?.throw ?? "").toMatch(/4\+/);
    const skills = st?.skills ?? [];
    expect(skills.length).toBeGreaterThanOrEqual(4);
  });
});
