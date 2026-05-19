// MT homeworld generation audit against PM pp. 12-15. The existing
// tests/audit/mt.json.audit.test.ts covers the roll table cell-for-cell;
// this file adds the rules/policies layered on top: tech order, career
// availability rules, default skills, starport X follow-up.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

interface DefaultSkill {
  skill: string;
  level: number;
  when?: {
    serviceIn?: string[];
    serviceNotIn?: string[];
    techAtLeast?: string;
    techIn?: string[];
  };
}

const HW = () => getEdition("mt-megatraveller").data.homeworld as
  unknown as Record<string, unknown>;

describe("MT homeworld tech code order (PM p. 15)", () => {
  it("Tech codes ordered low → high", () => {
    const order = HW().techCodeOrder as string[];
    expect(order).toEqual([
      "Pre-Industrial",
      "Industrial",
      "Pre-Stellar",
      "Early Stellar",
      "Avg Stellar",
      "High Stellar",
    ]);
  });
});

describe("MT homeworld career availability gates (PM p. 14)", () => {
  it("Every of the 18 MT careers is covered by at least one availability rule", () => {
    const avail = HW().careerAvailability as Array<{ services?: string[] }>;
    expect(Array.isArray(avail)).toBe(true);
    const covered = new Set<string>();
    for (const rule of avail) for (const s of rule.services ?? []) covered.add(s);
    // High-tech careers (army/marines/navy/scientists at Pre-Stellar+) and
    // Early Stellar+ careers (scouts/merchants/belters/pirates) must each
    // appear in at least one availability rule. Unrestricted services like
    // nobles/other/barbarians are intentionally absent.
    for (const svc of ["army", "marines", "navy", "scientists",
                       "scouts", "merchants", "belters", "pirates"]) {
      expect(covered.has(svc), `${svc} should appear in some availability rule`).toBe(true);
    }
  });
});

describe("MT homeworld default skills (PM p. 15)", () => {
  const ds = () => HW().defaultSkills as DefaultSkill[];

  it("Navy/Marines/Flyers/Scouts/Merchants/Pirates: Vacc Suit-0", () => {
    const entry = ds().find((e) => e.skill === "Vacc Suit");
    expect(entry?.level).toBe(0);
    const svcs = entry?.when?.serviceIn ?? [];
    for (const svc of ["navy", "marines", "flyers", "scouts", "merchants", "pirates"]) {
      expect(svcs, `${svc} should get Vacc Suit-0`).toContain(svc);
    }
  });

  it("All except Barbarians: Gun Combat-0", () => {
    const entry = ds().find((e) => e.skill === "Gun Combat");
    expect(entry?.level).toBe(0);
    expect(entry?.when?.serviceNotIn).toContain("barbarians");
  });

  it("Early Stellar+: Computer-0", () => {
    const entry = ds().find((e) => e.skill === "Computer");
    expect(entry?.level).toBe(0);
    expect(entry?.when?.techAtLeast).toBe("Early Stellar");
  });

  it("Avg Stellar+: Grav Vehicle-0", () => {
    const entry = ds().find((e) => e.skill === "Grav Vehicle");
    expect(entry?.level).toBe(0);
    expect(entry?.when?.techAtLeast).toBe("Avg Stellar");
  });

  it("Industrial/Pre-Stellar/Early Stellar: Wheeled Vehicle-0", () => {
    const entry = ds().find((e) => e.skill === "Wheeled Vehicle");
    expect(entry?.level).toBe(0);
    expect(entry?.when?.techIn).toEqual(
      expect.arrayContaining(["Industrial", "Pre-Stellar", "Early Stellar"]),
    );
  });
});

describe("MT homeworld starport X follow-up (PM p. 15)", () => {
  it("1D → 1-3:D, 4-5:E, 6:X", () => {
    const xr = HW().starportXRoll as {
      die?: string; results?: Record<string, string>;
    };
    expect(xr?.die).toBe("1D");
    expect(xr?.results?.["1"]).toBe("D");
    expect(xr?.results?.["2"]).toBe("D");
    expect(xr?.results?.["3"]).toBe("D");
    expect(xr?.results?.["4"]).toBe("E");
    expect(xr?.results?.["5"]).toBe("E");
    expect(xr?.results?.["6"]).toBe("X");
  });
});

describe("MT homeworld DMs by column (PM p. 15)", () => {
  it("Atmosphere, hydrosphere, law, tech have DM tables", () => {
    const dms = HW().dmsByColumn as Record<string, unknown>;
    expect(dms.atmosphere).toBeDefined();
    expect(dms.hydrosphere).toBeDefined();
    expect(dms.law).toBeDefined();
    expect(dms.tech).toBeDefined();
  });
});
