// Cross-validate the runtime engine against every active edition's JSON.
// For each edition, this file:
//
//   1. Loads the JSON file directly.
//   2. Builds a Character pinned to that edition.
//   3. For every service / skill cell / muster cell / rank / cash row,
//      forces the relevant d6, runs the engine, and asserts the observed
//      mutation matches what the JSON cell declared.
//
// Failures here mean the engine's interpretation of the JSON drifted from
// the JSON itself. Edition-specific quirks (PM abbreviations like "Stren"
// vs "Strength", skill renames like "Engnrng" → "Engineering") come from
// each edition's own attributeAbbreviations / skillLabelRenames blocks so
// no per-edition special-casing leaks into this test.

import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getEditionServices, listEditions,
  type AttributeKey, type ServiceKey,
} from "../lib/traveller";
import { Character } from "../lib/traveller/character";
import { cascadePoolForLabel } from "../lib/traveller/engine/cascadeMap";

interface JsonCheck {
  target: number | null;
}

interface JsonService {
  source: string;
  displayName: string;
  startAge: number;
  draft: number | null;
  checks: {
    enlistment: JsonCheck;
    survival: JsonCheck;
    position: JsonCheck | null;
    promotion: JsonCheck | null;
    reenlistment: JsonCheck;
  };
  ranks: (string | null)[];
  automaticSkills: Array<Record<string, unknown>>;
  skillTables: {
    personalDevelopment: (string | null)[];
    serviceSkills: (string | null)[];
    advancedEducation: (string | null)[];
    advancedEducation8Plus: (string | null)[];
  };
  musterOut: {
    benefits: (string | null)[];
    cash: (number | null)[];
  };
}

interface EditionJson {
  services: Record<string, JsonService>;
  attributeAbbreviations?: Record<string, string>;
  skillLabelRenames?: Record<string, string>;
  benefitDetails?: Record<string, { displayName?: string; firstReceiptMortgageYears?: number }>;
}

const ACTIVE_EDITIONS = listEditions().filter((e) => e.status === "active");
if (ACTIVE_EDITIONS.length === 0) {
  throw new Error("No active editions registered — data.validation.test cannot run");
}

const BASE = 7;

function forceD6(v: number): void {
  vi.spyOn(Math, "random").mockReturnValue((v - 1) / 6 + 0.0001);
}

function freshCharacter(editionId: string, svc: ServiceKey): Character {
  const c = new Character();
  c.editionId = editionId;
  c.showHistory = "none";
  c.attributes = {
    strength: BASE, dexterity: BASE, endurance: BASE,
    intelligence: BASE, education: BASE, social: BASE,
  };
  c.skills = [];
  c.benefits = [];
  c.events = [];
  c.musterLog = [];
  c.bladeBenefit = "";
  c.gunBenefit = "";
  c.mortgage = 40;
  c.ship = false;
  c.TAS = false;
  c.service = svc;
  return c;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Per-edition helpers
// ---------------------------------------------------------------------------

interface SkillRow {
  attrDelta: Partial<Record<AttributeKey, number>>;
  skills: [string, number][];
}

function runSkillRow(
  editionId: string, svc: ServiceKey, table: number, n: number,
): SkillRow {
  const c = freshCharacter(editionId, svc);
  c.forceTable = true;
  c.forceTableIndex = table;
  forceD6(n);
  getEditionServices(editionId)[svc]!.acquireSkill(c);
  vi.restoreAllMocks();
  const attrDelta: Partial<Record<AttributeKey, number>> = {};
  for (const k of [
    "strength", "dexterity", "endurance",
    "intelligence", "education", "social",
  ] as AttributeKey[]) {
    const d = c.attributes[k] - BASE;
    if (d !== 0) attrDelta[k] = d;
  }
  return {
    attrDelta,
    skills: c.skills.map(([n2, l]) => [n2, l] as [string, number]),
  };
}

interface MusterRow {
  benefits: string[];
  attrDelta: Partial<Record<AttributeKey, number>>;
  ship: boolean;
  TAS: boolean;
  skills: [string, number][];
}

function runMusterRow(
  editionId: string, svc: ServiceKey, n: number,
): MusterRow {
  const c = freshCharacter(editionId, svc);
  forceD6(n);
  getEditionServices(editionId)[svc]!.musterBenefits(c, 0);
  vi.restoreAllMocks();
  const attrDelta: Partial<Record<AttributeKey, number>> = {};
  for (const k of [
    "strength", "dexterity", "endurance",
    "intelligence", "education", "social",
  ] as AttributeKey[]) {
    const d = c.attributes[k] - BASE;
    if (d !== 0) attrDelta[k] = d;
  }
  return {
    benefits: c.benefits,
    attrDelta,
    ship: c.ship,
    TAS: c.TAS,
    skills: c.skills.map(([nm, l]) => [nm, l] as [string, number]),
  };
}

const PASSAGE_BY_LABEL: Record<string, string> = {
  "High Psg": "High Passage",
  "Mid Psg": "Mid Passage",
  "Low Psg": "Low Passage",
  "High Passage": "High Passage",
  "Mid Passage": "Mid Passage",
  "Low Passage": "Low Passage",
};

const TABLES: Array<[keyof JsonService["skillTables"], number]> = [
  ["personalDevelopment", 1],
  ["serviceSkills", 2],
  ["advancedEducation", 3],
  ["advancedEducation8Plus", 4],
];

// ---------------------------------------------------------------------------
// Per-edition test sweep
// ---------------------------------------------------------------------------

for (const meta of ACTIVE_EDITIONS) {
  const editionId = meta.id;
  const DATA: EditionJson = JSON.parse(
    readFileSync(resolve(__dirname, `../data/editions/${editionId}.json`), "utf8"),
  ) as EditionJson;
  const SERVICES = Object.keys(DATA.services) as ServiceKey[];
  const ATTR_BY_ABBR = (DATA.attributeAbbreviations ?? {}) as Record<string, string>;
  const SKILL_RENAMES = (DATA.skillLabelRenames ?? {}) as Record<string, string>;
  const editionServices = getEditionServices(editionId);

  // Build a set of all ship-benefit labels for this edition (derived from
  // benefitDetails entries that declare firstReceiptMortgageYears, plus
  // the canonical displayName of any benefit ending in "Ship", "Trader",
  // "Yacht", or "Corsair" — same heuristic the engine uses).
  const shipLabels = new Set<string>();
  for (const [label, entry] of Object.entries(DATA.benefitDetails ?? {})) {
    if (entry?.firstReceiptMortgageYears !== undefined) {
      shipLabels.add(label);
      continue;
    }
    if (/Ship|Trader|Yacht|Corsair|Seeker/.test(label)) {
      shipLabels.add(label);
    }
  }

  function resolveAttrFromLabel(abbr: string): AttributeKey | undefined {
    const mapped = ATTR_BY_ABBR[abbr];
    if (!mapped) return undefined;
    return mapped as AttributeKey;
  }

  function assertCellMatchesCode(
    svc: ServiceKey, table: number, n: number, cellLabel: string,
  ) {
    const got = runSkillRow(editionId, svc, table, n);

    // Cascade label? Look up the cascade pool by the cell label.
    const pool = cascadePoolForLabel(cellLabel, editionId);
    if (pool) {
      expect(got.attrDelta, `${editionId}/${svc} table ${table} row ${n}`).toEqual({});
      // A cascade pick may itself be a PM Includes-skill umbrella
      // (e.g., "Small Blade" expands to [Blade, Dagger]; "Large Blade"
      // expands to [Broadsword, Cutlass, Sword]). Expansion produces
      // multiple skill entries. Accept either the literal pool member
      // or a non-empty expansion.
      expect(
        got.skills.length, `${editionId}/${svc} table ${table} row ${n}`,
      ).toBeGreaterThanOrEqual(1);
      if (got.skills.length === 1) {
        const [name, level] = got.skills[0]!;
        expect(level).toBe(1);
        expect(
          pool, `${editionId}/${svc} table ${table} row ${n}: ${name} not in ${cellLabel} pool`,
        ).toContain(name);
      }
      return;
    }

    // Attribute change? Both "+1 Stren" and "+1 Strength" — the leading
    // sign-and-magnitude is the same; the abbreviation/full name resolves
    // via the edition's attributeAbbreviations block.
    const attrMatch = cellLabel.match(/^([+-]\d+)\s+([A-Za-z]+)$/);
    if (attrMatch) {
      const delta = parseInt(attrMatch[1]!, 10);
      const abbr = attrMatch[2];
      const attr = abbr ? resolveAttrFromLabel(abbr) : undefined;
      expect(
        attr, `${editionId}/${svc}: unknown attr abbr in ${cellLabel}`,
      ).toBeDefined();
      expect(
        got.attrDelta, `${editionId}/${svc} table ${table} row ${n} ← "${cellLabel}"`,
      ).toEqual({ [attr!]: delta });
      expect(got.skills).toEqual([]);
      return;
    }

    // Plain skill name (possibly aliased via skillLabelRenames).
    const skillName = SKILL_RENAMES[cellLabel] ?? cellLabel;
    expect(
      got.attrDelta, `${editionId}/${svc} table ${table} row ${n} ← "${cellLabel}"`,
    ).toEqual({});
    // Some MT cells expand to multiple skills (Includes-skills like ATV,
    // Battle Dress). Accept either an exact-match single skill or any
    // non-empty skill list — we don't try to predict expansion here.
    if (got.skills.length === 1) {
      const [n2, l2] = got.skills[0]!;
      expect(l2).toBeGreaterThanOrEqual(0);
      // Accept the canonical name OR the rename target.
      expect([cellLabel, skillName]).toContain(n2);
    } else {
      expect(got.skills.length).toBeGreaterThan(0);
    }
  }

  function assertMusterMatchesCode(svc: ServiceKey, n: number, cellLabel: string) {
    const got = runMusterRow(editionId, svc, n);

    if (cellLabel === "Travellers'") {
      expect(got.TAS, `${editionId}/${svc} muster row ${n}`).toBe(true);
      // B11: Travellers' now stores the JSON displayName (was hardcoded "Travellers' Aid Society").
      expect(got.benefits).toEqual(["Travellers' Aid Society membership"]);
      return;
    }
    if (cellLabel === "Weapon" || cellLabel === "Blade" || cellLabel === "Gun") {
      expect(got.benefits, `${editionId}/${svc} muster row ${n}`).toHaveLength(1);
      expect(got.skills).toHaveLength(1);
      expect(got.skills[0]![0]).toBe(got.benefits[0]);
      return;
    }
    if (shipLabels.has(cellLabel)) {
      expect(got.benefits, `${editionId}/${svc} muster row ${n}`).toEqual([cellLabel]);
      expect(got.ship).toBe(true);
      return;
    }
    const passage = PASSAGE_BY_LABEL[cellLabel];
    if (passage) {
      expect(
        got.benefits, `${editionId}/${svc} muster row ${n} ← ${cellLabel}`,
      ).toEqual([passage]);
      return;
    }
    const attrMatch = cellLabel.match(/^([+-]\d+)\s+([A-Za-z]+)$/);
    if (attrMatch) {
      const delta = parseInt(attrMatch[1]!, 10);
      const abbr = attrMatch[2];
      const attr = abbr ? resolveAttrFromLabel(abbr) : undefined;
      expect(
        attr, `${editionId}/${svc}: unknown attr abbr in ${cellLabel}`,
      ).toBeDefined();
      expect(
        got.attrDelta, `${editionId}/${svc} muster row ${n} ← ${cellLabel}`,
      ).toEqual({ [attr!]: delta });
      return;
    }
    // Plain benefit string (Instruments, Watch, etc.)
    expect(
      got.benefits, `${editionId}/${svc} muster row ${n} ← ${cellLabel}`,
    ).toEqual([cellLabel]);
  }

  describe(`${editionId}: service check targets vs JSON`, () => {
    for (const svc of SERVICES) {
      const j = DATA.services[svc]!;
      const c = editionServices[svc]!;
      it(`${svc}: enlistment target = ${j.checks.enlistment.target}`, () => {
        if (j.checks.enlistment.target === null) {
          expect(c.enlistmentThrow).toBeDefined();
        } else {
          expect(c.enlistmentThrow).toBe(j.checks.enlistment.target);
        }
      });
      it(`${svc}: survival target = ${j.checks.survival.target}`, () => {
        expect(c.survivalThrow).toBe(j.checks.survival.target);
      });
      if (j.checks.position) {
        it(`${svc}: position target = ${j.checks.position.target}`, () => {
          expect(c.commissionThrow).toBe(j.checks.position!.target);
        });
      }
      if (j.checks.promotion) {
        it(`${svc}: promotion target = ${j.checks.promotion.target}`, () => {
          expect(c.promotionThrow).toBe(j.checks.promotion!.target);
        });
      }
      it(`${svc}: reenlistment target = ${j.checks.reenlistment.target}`, () => {
        expect(c.reenlistThrow).toBe(j.checks.reenlistment.target);
      });
    }
  });

  describe(`${editionId}: rank titles vs JSON`, () => {
    for (const svc of SERVICES) {
      const j = DATA.services[svc]!;
      it(`${svc}: ranks match`, () => {
        const jRanks = j.ranks.map((r) => r ?? "");
        const codeRanks = [0, 1, 2, 3, 4, 5, 6].map((r) =>
          (editionServices[svc]!.ranks as Record<number, string>)[r] ?? "");
        expect(codeRanks).toEqual(jRanks);
      });
    }
  });

  describe(`${editionId}: muster cash table vs JSON`, () => {
    for (const svc of SERVICES) {
      const j = DATA.services[svc]!;
      it(`${svc}: cash rows 1-7`, () => {
        const expected = j.musterOut.cash.slice(1).map((v) => v ?? 0);
        const got = [1, 2, 3, 4, 5, 6, 7].map((r) =>
          (editionServices[svc]!.musterCash as Record<number, number>)[r]);
        expect(got).toEqual(expected);
      });
    }
  });

  describe(`${editionId}: skill tables vs JSON`, () => {
    for (const svc of SERVICES) {
      const j = DATA.services[svc]!;
      for (const [tableKey, tableIdx] of TABLES) {
        for (let row = 1; row <= 6; row++) {
          const cell = j.skillTables[tableKey][row];
          if (cell == null) continue;
          const cellStr = cell;
          it(`${svc}: ${tableKey} row ${row} → ${cellStr}`, () => {
            assertCellMatchesCode(svc, tableIdx, row, cellStr);
          });
        }
      }
    }
  });

  describe(`${editionId}: muster benefits vs JSON`, () => {
    for (const svc of SERVICES) {
      const j = DATA.services[svc]!;
      for (let row = 1; row <= 7; row++) {
        const cell = j.musterOut.benefits[row];
        if (cell == null) continue;
        const cellStr = cell;
        it(`${svc}: muster row ${row} → ${cellStr}`, () => {
          assertMusterMatchesCode(svc, row, cellStr);
        });
      }
    }
  });

  describe(`${editionId}: doEnlistment applies JSON-declared startAge`, () => {
    // applyServiceStartAge is private, but doEnlistment invokes it on the
    // accepted-service path. Force max enlistment rolls so every service
    // accepts; the resulting c.age must equal the service's JSON startAge.
    for (const svc of SERVICES) {
      const j = DATA.services[svc]!;
      if (j.startAge === undefined) continue;
      // Nobles enter via the Soc 10+ auto-path; covered by sibling test.
      if (svc === "nobles") continue;
      it(`${svc}: doEnlistment sets age to ${j.startAge}`, () => {
        vi.spyOn(Math, "random").mockReturnValue(0.999);
        const c = new Character();
        c.editionId = editionId;
        c.showHistory = "none";
        // Soc <10 to avoid the auto-noble enrollment branch.
        c.attributes = {
          strength: 12, dexterity: 12, endurance: 12,
          intelligence: 12, education: 12, social: 9,
        };
        // No homeworld: MT's tech-based career availability would block
        // services like barbarians on a high-tech world. doEnlistment
        // without homeworld uses the full enlistable list and exercises
        // applyServiceStartAge cleanly — which is all this test cares about.
        c.doEnlistment(svc);
        expect(c.service).toBe(svc);
        expect(c.age).toBe(j.startAge);
      });
    }

    if (DATA.services["nobles"]) {
      it("nobles: Soc 10+ auto-enrollment sets age to nobles' startAge", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.999);
        const c = new Character();
        c.editionId = editionId;
        c.showHistory = "none";
        c.attributes = {
          strength: 12, dexterity: 12, endurance: 12,
          intelligence: 12, education: 12, social: 11,
        };
        c.doEnlistment(""); // random method → auto-noble path at Soc 10+
        expect(c.service).toBe("nobles");
        expect(c.age).toBe(DATA.services["nobles"]!.startAge);
      });
    }
  });
}
