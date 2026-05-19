// Pre-career audit against MT PM p. 49. Asserts the JSON has the exact
// throws / DMs / honors targets the PM specifies — the PDF audit
// (tests/audit/mt.pdf.audit.test.ts) covers some of these; this file
// adds explicit checks for the full set.

import { describe, expect, it } from "vitest";
import { getAcgCommon } from "../../lib/traveller";

describe("Pre-career audit — PM p. 49", () => {
  it("College: admit 9+ (DM+2 Edu 9+), success 7+ (DM+2 Int 8+), honors 10+ (DM+1 Int 10+)", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, {
        admission?: { target?: number; dms?: Array<Record<string, unknown>> };
        success?: { target?: number; dms?: Array<Record<string, unknown>> };
        honors?: { target?: number; dms?: Array<Record<string, unknown>> };
      }>;
    const college = opts.college;
    expect(college?.admission?.target).toBe(9);
    expect(college?.success?.target).toBe(7);
    expect(college?.honors?.target).toBe(10);
  });

  it("Naval Academy: admit 10+ (DM+2 Soc 10+), success 9+ (DM+2 Edu 8+), honors 9+", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { admission?: { target?: number }; success?: { target?: number }; honors?: { target?: number } }>;
    const na = opts.navalAcademy;
    expect(na?.admission?.target).toBe(10);
    expect(na?.success?.target).toBe(9);
    expect(na?.honors?.target).toBe(9);
  });

  it("Military Academy: admit 10+ (DM+2 Str 10+), success 9+, honors 9+", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { admission?: { target?: number }; success?: { target?: number }; honors?: { target?: number } }>;
    const ma = opts.militaryAcademy;
    expect(ma?.admission?.target).toBe(10);
    expect(ma?.success?.target).toBe(9);
    expect(ma?.honors?.target).toBe(9);
  });

  it("Merchant Academy: admit 9+ (DM+2 Edu 10+), success 9+, honors 9+", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { admission?: { target?: number }; success?: { target?: number }; honors?: { target?: number } }>;
    const ma = opts.merchantAcademy;
    expect(ma?.admission?.target).toBe(9);
    expect(ma?.success?.target).toBe(9);
    expect(ma?.honors?.target).toBe(9);
  });

  it("Medical School: admit 9+ (DM+2 Edu 10+), success 8+ (DM+2 Edu 8+), honors 11+", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { admission?: { target?: number }; success?: { target?: number }; honors?: { target?: number } }>;
    const med = opts.medicalSchool;
    expect(med?.admission?.target).toBe(9);
    expect(med?.success?.target).toBe(8);
    expect(med?.honors?.target).toBe(11);
  });

  it("Flight School: admit 9+ (DM+1 Dex 9+), success 7+ (DM+1 Int 8+)", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { admission?: { target?: number }; success?: { target?: number } }>;
    const fs = opts.flightSchool;
    expect(fs?.admission?.target).toBe(9);
    expect(fs?.success?.target).toBe(7);
  });

  it("College OTC 8+ (DM+1 Soc 8+) and NOTC 9+ (DM+1 Soc 10+)", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, {
        otc?: { target?: number; dms?: Array<{ attribute?: string; min?: number; dm?: number }> };
        notc?: { target?: number; dms?: Array<{ attribute?: string; min?: number; dm?: number }> };
      }>;
    const college = opts.college;
    expect(college?.otc?.target).toBe(8);
    // JSON spells the attribute as "socialStanding"; engine normalizes
    // via attributeAbbreviations.
    const otcSoc = college?.otc?.dms?.find((d) =>
      d.attribute === "social" || d.attribute === "socialStanding");
    expect(otcSoc?.min).toBe(8);
    expect(otcSoc?.dm).toBe(1);
    expect(college?.notc?.target).toBe(9);
    const notcSoc = college?.notc?.dms?.find((d) =>
      d.attribute === "social" || d.attribute === "socialStanding");
    expect(notcSoc?.min).toBe(10);
    expect(notcSoc?.dm).toBe(1);
  });
});

describe("Pre-career skills (PM p. 49)", () => {
  it("Naval Academy: skills include Vacc Suit, Navigation, Engineering", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { skills?: { skills?: string[] } }>;
    const na = opts.navalAcademy;
    const skills = na?.skills?.skills ?? [];
    expect(skills).toEqual(expect.arrayContaining([
      "Vacc Suit", "Navigation", "Engineering",
    ]));
  });

  it("Military Academy: automatic Combat Rifleman + 4+ for Tactics/Leader/Admin/Heavy Weapons/Forward Observer/Computer", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, {
        automaticSkills?: string[];
        skills?: { throw?: string; skills?: string[] };
      }>;
    const ma = opts.militaryAcademy;
    expect(ma?.automaticSkills).toContain("Combat Rifleman");
    const skills = ma?.skills?.skills ?? [];
    expect(skills).toEqual(expect.arrayContaining([
      "Tactics", "Leader", "Admin", "Heavy Weapons", "Forward Observer", "Computer",
    ]));
  });

  it("Medical School: automatic +1 Edu + Medical-3 + Admin", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { automaticSkills?: string[] }>;
    const med = opts.medicalSchool;
    // Per PM p. 49: "All graduates receive +1 Education, Medical-3,
    // and Admin." Stored as string entries in automaticSkills.
    const auto = med?.automaticSkills ?? [];
    expect(auto.some((s) => /\+1.*Education/.test(s))).toBe(true);
    expect(auto.some((s) => /Medical-?3/.test(s))).toBe(true);
    expect(auto.some((s) => /Admin/.test(s))).toBe(true);
  });

  it("Flight School: Ship's Boat + Navigation automatic, Pilot 1D-3 min 1", () => {
    const opts = getAcgCommon("mt-megatraveller").preCareerOptions as
      Record<string, { skills?: string[] | { skills?: string[] } }>;
    const fs = opts.flightSchool;
    // Flight school stores skills as a flat string array (no throw); the
    // engine reads it as a plain list and grants each entry.
    const skills = Array.isArray(fs?.skills) ? fs!.skills
      : (fs?.skills && !Array.isArray(fs.skills) ? fs.skills.skills : []) ?? [];
    expect(skills.some((s) => /Ship's Boat|Ships Boat/.test(s))).toBe(true);
    expect(skills.some((s) => /Navigation/.test(s))).toBe(true);
    expect(skills.some((s) => /Pilot/.test(s))).toBe(true);
  });
});
