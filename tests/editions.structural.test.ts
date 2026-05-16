// Edition-aware structural tests. Iterates every edition registered in
// lib/traveller/editions and asserts each services JSON entry has the
// expected shape:
//   - 7-position ranks array (nulls allowed)
//   - 4 skill tables, each a 7-position array (null + 6 cells)
//   - musterOut.benefits is an 8-position array (null + 7 cells)
//   - musterOut.cash is an 8-position array (null + 7 cells)
//   - cell labels are well-formed (attribute change, recognised cascade,
//     recognised benefit, or plain skill string)
//
// These tests pass for both "active" and "data-only" editions; they don't
// require the engine to be wired for the edition.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

interface EditionFile {
  id: string;
  path: string;
  data: {
    edition: { id: string; status?: string; displayName: string };
    services: Record<string, ServiceShape>;
    lifecycle?: { terms?: Array<{ id: string; config?: unknown }> };
  };
}

interface ServiceShape {
  displayName?: string;
  ranks: unknown[];
  automaticSkills: unknown[];
  skillTables: {
    personalDevelopment: unknown[];
    serviceSkills: unknown[];
    advancedEducation: unknown[];
    advancedEducation8Plus: unknown[];
  };
  musterOut: { benefits: unknown[]; cash: unknown[] };
  checks: {
    enlistment: { target: unknown };
    survival: { target: unknown };
    position: { target: unknown } | null;
    promotion: { target: unknown } | null;
    reenlistment: { target: unknown };
  };
}

const EDITIONS_DIR = resolve(__dirname, "../data/editions");

function loadEditions(): EditionFile[] {
  const files = readdirSync(EDITIONS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const data = JSON.parse(readFileSync(resolve(EDITIONS_DIR, f), "utf8")) as
      EditionFile["data"];
    return { id: data.edition.id, path: f, data };
  });
}

const EDITIONS = loadEditions();

// ---------------------------------------------------------------------------
// Edition discovery — sanity check we found something
// ---------------------------------------------------------------------------

describe("edition discovery", () => {
  it("finds at least one edition under data/editions/", () => {
    expect(EDITIONS.length).toBeGreaterThan(0);
  });

  for (const ed of EDITIONS) {
    it(`${ed.path}: parses as valid JSON with edition.id`, () => {
      expect(ed.data.edition.id).toBeTruthy();
      expect(ed.data.edition.displayName).toBeTruthy();
    });
  }
});

// ---------------------------------------------------------------------------
// Per-service structural checks for every edition
// ---------------------------------------------------------------------------

const ATTR_LABELS = new Set([
  "Stren", "Dext", "Endur", "Intel", "Educ", "Social", "Soc",
]);

/** Cell labels that should resolve via known cascades, attribute changes,
 *  literal skills, or be null. Editions may introduce their own cascade
 *  vocabulary (MT adds Physical/Mental/Vice/etc.); we accept any non-empty
 *  string here and rely on per-edition cellResolver tests for deeper checks. */
function isWellFormedCell(cell: unknown): boolean {
  if (cell === null) return true;
  if (typeof cell !== "string") return false;
  if (cell.trim() === "") return false;
  return true;
}

function isAttributeCell(cell: string): boolean {
  const m = cell.match(/^([+-]\d+)\s+(\w+)$/);
  if (!m) return false;
  return ATTR_LABELS.has(m[2]!);
}

for (const ed of EDITIONS) {
  describe(`${ed.id}: service structure`, () => {
    const services = Object.entries(ed.data.services);

    it(`has at least one service`, () => {
      expect(services.length).toBeGreaterThan(0);
    });

    for (const [key, svc] of services) {
      describe(`${ed.id} / ${key}`, () => {
        it("ranks is a 7-position array (nulls allowed)", () => {
          expect(Array.isArray(svc.ranks)).toBe(true);
          expect(svc.ranks).toHaveLength(7);
        });

        it("automaticSkills is an array", () => {
          expect(Array.isArray(svc.automaticSkills)).toBe(true);
        });

        for (const tableKey of [
          "personalDevelopment", "serviceSkills",
          "advancedEducation", "advancedEducation8Plus",
        ] as const) {
          it(`skillTables.${tableKey} is 7 positions with row 0 = null`, () => {
            const t = svc.skillTables[tableKey];
            expect(Array.isArray(t)).toBe(true);
            expect(t).toHaveLength(7);
            expect(t[0]).toBeNull();
            for (let r = 1; r <= 6; r++) {
              expect(isWellFormedCell(t[r])).toBe(true);
            }
          });
        }

        it("musterOut.benefits is 8 positions with row 0 = null", () => {
          expect(svc.musterOut.benefits).toHaveLength(8);
          expect(svc.musterOut.benefits[0]).toBeNull();
          for (let r = 1; r <= 7; r++) {
            expect(isWellFormedCell(svc.musterOut.benefits[r])).toBe(true);
          }
        });

        it("musterOut.cash is 8 positions with row 0 = null", () => {
          expect(svc.musterOut.cash).toHaveLength(8);
          expect(svc.musterOut.cash[0]).toBeNull();
          for (let r = 1; r <= 7; r++) {
            const v = svc.musterOut.cash[r];
            expect(v === null || typeof v === "number").toBe(true);
          }
        });

        it("checks.enlistment.target is a number or null", () => {
          const t = svc.checks.enlistment.target;
          expect(t === null || typeof t === "number").toBe(true);
        });

        it("checks.survival.target is a number", () => {
          expect(typeof svc.checks.survival.target).toBe("number");
        });

        it("checks.reenlistment.target is a number", () => {
          expect(typeof svc.checks.reenlistment.target).toBe("number");
        });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Edition-level structural checks
// ---------------------------------------------------------------------------

const KNOWN_STEPS = new Set([
  "allocateSkills", "survival", "commission", "promotion", "specialDuty",
]);

for (const ed of EDITIONS) {
  const terms = ed.data.lifecycle?.terms;
  if (!terms) continue;
  describe(`${ed.id}: lifecycle declaration`, () => {
    it("terms is a non-empty array", () => {
      expect(Array.isArray(terms)).toBe(true);
      expect(terms.length).toBeGreaterThan(0);
    });
    for (let i = 0; i < terms.length; i++) {
      it(`terms[${i}].id "${terms[i]!.id}" is a known step`, () => {
        expect(KNOWN_STEPS.has(terms[i]!.id)).toBe(true);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// ACG structural checks — verify every pathway has the required keys
// ---------------------------------------------------------------------------

const ACG_REQUIRED_KEYS = ["enlistment", "reenlistment"];

for (const ed of EDITIONS) {
  const acg = (ed.data as { advancedCharacterGeneration?: Record<string, unknown> })
    .advancedCharacterGeneration;
  if (!acg) continue;
  describe(`${ed.id}: ACG structural`, () => {
    it("declares a 'common' block with the four shared tables", () => {
      const common = acg.common as Record<string, unknown>;
      expect(common).toBeDefined();
      expect(common.preCareerOptions).toBeDefined();
      expect(common.courtMartial).toBeDefined();
      expect(common.browniePoints).toBeDefined();
      expect(common.decorationAndSurvival).toBeDefined();
    });

    const pathways = Object.keys(acg).filter(
      (k) => k !== "common" && k !== "source" && k !== "coverage",
    );

    it("has at least one named pathway", () => {
      expect(pathways.length).toBeGreaterThan(0);
    });

    for (const pname of pathways) {
      describe(`pathway ${pname}`, () => {
        const p = acg[pname] as Record<string, unknown>;
        for (const required of ACG_REQUIRED_KEYS) {
          it(`has required key "${required}"`, () => {
            expect(p[required]).toBeDefined();
          });
        }
        it("declares a sourcePrintedPages list", () => {
          expect(Array.isArray(p.sourcePrintedPages)).toBe(true);
          expect((p.sourcePrintedPages as number[]).length).toBeGreaterThan(0);
        });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Cell-attribute sanity (catches typo cells like "+1 Foo")
// ---------------------------------------------------------------------------

for (const ed of EDITIONS) {
  describe(`${ed.id}: attribute-change cells reference known attributes`, () => {
    for (const [svcKey, svc] of Object.entries(ed.data.services)) {
      for (const [tableKey, table] of Object.entries(svc.skillTables)) {
        for (let r = 1; r <= 6; r++) {
          const cell = table[r];
          if (typeof cell !== "string") continue;
          if (!cell.match(/^[+-]\d+\s+/)) continue;
          it(`${svcKey}.${tableKey}[${r}] = "${cell}" → known attr`, () => {
            expect(isAttributeCell(cell)).toBe(true);
          });
        }
      }
      for (let r = 1; r <= 7; r++) {
        const cell = svc.musterOut.benefits[r];
        if (typeof cell !== "string") continue;
        if (!cell.match(/^[+-]\d+\s+/)) continue;
        it(`${svcKey}.muster[${r}] = "${cell}" → known attr`, () => {
          expect(isAttributeCell(cell)).toBe(true);
        });
      }
    }
  });
}
