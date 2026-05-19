// Mercenary special-duty schools audit. Cross-references PM pp. 50-51
// + p. 65 (mercenary special-duty table). The existing
// tests/audit/mt.pdf.audit.test.ts covers 9 of these; this file adds
// the Specialist School table check (which isn't there) and verifies
// every school referenced by PM exists in the JSON.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

const PM_MERCENARY_SCHOOLS = [
  "Specialist School",  // PM p. 50 mercenary special assignments table
  "Cross-Training",
  "Recruiting Duty",
  "Commando School",
  "Protected Forces",
  "OCS",
  "Intelligence School",
  "Command College",
  "Staff College",
  "Attache/Aide",
];

describe("Mercenary special-duty schools (PM pp. 50-51 + 65)", () => {
  const merc = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.mercenary;

  it("Every PM-listed school exists in the JSON", () => {
    const details = (merc?.specialAssignmentDetails ?? {}) as
      Record<string, unknown>;
    for (const school of PM_MERCENARY_SCHOOLS) {
      expect(details[school], `${school} missing`).toBeDefined();
    }
  });

  it("Specialist School: 1D table with training (enlisted) and schooling (officer) columns", () => {
    const spec = (merc as { specialistSchool?: { columns?: string[]; rows?: Array<{ die: number; training: string; schooling: string }> } })?.specialistSchool;
    expect(spec?.columns).toEqual(
      expect.arrayContaining(["die", "training", "schooling"]),
    );
    expect(spec?.rows).toHaveLength(6);
    // PM p. 50 table values for die 1: training=Mechanical, schooling=Academic.
    const r1 = spec?.rows?.find((r) => r.die === 1);
    expect(r1?.training).toBe("Mechanical");
    expect(r1?.schooling).toBe("Academic");
  });

  it("OCS: age limit 38; commission to O1 (or O2 for E7); E8/E9 → O3 (no skills)", () => {
    const details = (merc?.specialAssignmentDetails ?? {}) as
      Record<string, { summary?: string; ageLimit?: number; effects?: unknown[] }>;
    const ocs = details.OCS;
    expect(ocs?.ageLimit).toBe(38);
    expect(ocs?.summary).toMatch(/E7.*O2|rank.*O2.*E7/i);
    expect(ocs?.summary).toMatch(/E8\/E9.*O3|O3.*E8/i);
  });

  it("Attache/Aide: 1-4 attache (+1 rank, +1 Soc), 5-6 aide (+1 Soc, select)", () => {
    const details = (merc?.specialAssignmentDetails ?? {}) as
      Record<string, { summary?: string }>;
    const aa = details["Attache/Aide"];
    expect(aa?.summary).toMatch(/attache/i);
    expect(aa?.summary).toMatch(/aide/i);
    expect(aa?.summary).toMatch(/\+1.*Social|\+1.*Soc/i);
  });
});
