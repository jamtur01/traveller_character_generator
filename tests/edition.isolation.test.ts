// Edition-isolation tests. The engine must NOT leak edition-specific data
// across boundaries: CT must never roll an MT-only weapon; MT must never
// roll a CT-only weapon; cascades, service lists, lifecycle steps, and
// hooks must all stay scoped to the character's editionId.
//
// These tests are the second-line defense against regressions when adding
// a new edition: the row-level cell tests prove the data is correct;
// these tests prove the engine respects the data's edition boundary.

import { describe, expect, it, vi, afterEach } from "vitest";
import { getEdition, getEditionServices, listEditions, type ServiceKey } from "../lib/traveller";
import { Character } from "../lib/traveller/character";
import {
  cascadePoolByKey, cascadePoolForLabel, isCascadeLabel,
} from "../lib/traveller/engine/cascadeMap";

const ACTIVE = listEditions().filter((e) => e.status === "active");
const ALL = listEditions();

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Each active edition resolves its own cascade pools — no cross-pollination
// ---------------------------------------------------------------------------

describe("cascade pools are edition-scoped", () => {
  for (const ed of ACTIVE) {
    it(`${ed.id}: bladeCombat pool matches edition JSON exactly`, () => {
      const fromHelper = cascadePoolByKey("bladeCombat", ed.id);
      const fromJson = (
        getEdition(ed.id).data as {
          cascadeSkills?: Record<string, readonly string[]>;
        }
      ).cascadeSkills?.["bladeCombat"];
      expect(fromHelper).toEqual(fromJson);
    });

    it(`${ed.id}: gunCombat pool matches edition JSON exactly`, () => {
      const fromHelper = cascadePoolByKey("gunCombat", ed.id);
      const fromJson = (
        getEdition(ed.id).data as {
          cascadeSkills?: Record<string, readonly string[]>;
        }
      ).cascadeSkills?.["gunCombat"];
      expect(fromHelper).toEqual(fromJson);
    });
  }

  it("CT bladeCombat does not contain MT-only blades", () => {
    const ct = cascadePoolByKey("bladeCombat", "ct-classic");
    const mtOnly = ["Axe", "Large Blade", "Small Blade", "Polearm"];
    for (const w of mtOnly) expect(ct).not.toContain(w);
  });

  it("MT bladeCombat does not contain CT-only blades", () => {
    const mt = cascadePoolByKey("bladeCombat", "mt-megatraveller");
    const ctOnly = ["Dagger", "Sword", "Cutlass", "Broadsword", "Bayonet",
      "Spear", "Halberd", "Pike"];
    for (const w of ctOnly) expect(mt).not.toContain(w);
  });
});

// ---------------------------------------------------------------------------
// "Gunnery" is a cascade in MT, literal in CT
// ---------------------------------------------------------------------------

describe('"Gunnery" label resolves per edition', () => {
  it("isCascadeLabel returns true for 'Gunnery' in MT (cascade alias)", () => {
    expect(isCascadeLabel("Gunnery", "mt-megatraveller")).toBe(true);
  });
  it("isCascadeLabel returns false for 'Gunnery' in CT (no alias)", () => {
    expect(isCascadeLabel("Gunnery", "ct-classic")).toBe(false);
  });

  it("CT has no gunnery cascade — pool lookup returns undefined", () => {
    expect(cascadePoolForLabel("Gunnery", "ct-classic")).toBeUndefined();
  });

  it("MT has a gunnery cascade — pool is non-empty", () => {
    const pool = cascadePoolForLabel("Gunnery", "mt-megatraveller");
    expect(pool).toBeDefined();
    expect(pool!.length).toBeGreaterThan(0);
    expect(pool).toContain("Turret Weapons");
  });
});

// ---------------------------------------------------------------------------
// Service maps are edition-scoped
// ---------------------------------------------------------------------------

describe("service maps don't leak across editions", () => {
  it("CT has 'other' but no 'lawenforcers'", () => {
    const ct = getEditionServices("ct-classic");
    expect(ct.other).toBeDefined();
    expect(ct.lawenforcers).toBeUndefined();
  });

  it("MT has 'lawenforcers' but no 'other'", () => {
    const mt = getEditionServices("mt-megatraveller");
    expect(mt.lawenforcers).toBeDefined();
    expect(mt.other).toBeUndefined();
  });

  it("an MT character cannot access CT's 'other' service via serviceDef()", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "other";
    expect(() => c.serviceDef()).toThrow(/not part of edition/);
  });

  it("a CT character cannot access MT's 'lawenforcers' service via serviceDef()", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "lawenforcers";
    expect(() => c.serviceDef()).toThrow(/not part of edition/);
  });
});

// ---------------------------------------------------------------------------
// Cascade-via-Character respects ch.editionId
// ---------------------------------------------------------------------------

describe("doBladeBenefit reads pool from character's edition", () => {
  function freshChar(editionId: string, service: ServiceKey): Character {
    const c = new Character();
    c.showHistory = "none";
    c.editionId = editionId;
    c.service = service;
    c.bladeBenefit = "";
    c.gunBenefit = "";
    c.skills = [];
    c.benefits = [];
    c.events = [];
    c.muster.musterLog = [];
    return c;
  }

  it("CT character receives a CT-only blade", () => {
    // Force Math.random to pick index 0 so the result is deterministic.
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const c = freshChar("ct-classic", "navy");
    c.doBladeBenefit();
    const ct = cascadePoolByKey("bladeCombat", "ct-classic");
    expect(ct).toContain(c.bladeBenefit);
  });

  it("MT character receives an MT-only blade", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const c = freshChar("mt-megatraveller", "marines");
    c.doBladeBenefit();
    const mt = cascadePoolByKey("bladeCombat", "mt-megatraveller");
    expect(mt).toContain(c.bladeBenefit);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle step ids referenced by JSON must exist in the registry
// ---------------------------------------------------------------------------

describe("each edition's lifecycle.terms is wired to known steps", () => {
  for (const ed of ALL) {
    const terms = ed.id && getEdition(ed.id).data.lifecycle?.terms;
    if (!terms) continue;
    it(`${ed.id}: every step id resolves to a registered step fn`, async () => {
      const { STEP_REGISTRY } = await import("../lib/traveller/engine/steps");
      expect(terms.length).toBeGreaterThan(0);
      for (const t of terms) {
        expect(
          STEP_REGISTRY[t.id as keyof typeof STEP_REGISTRY],
          `step "${t.id}" referenced in ${ed.id}.lifecycle.terms is not registered`,
        ).toBeDefined();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Hook isolation — each edition's hooks file is independent
// ---------------------------------------------------------------------------

describe("edition hooks are isolated", () => {
  it("CT hooks contain noblesSocialByRank; MT hooks do not", () => {
    const ct = getEdition("ct-classic");
    const mt = getEdition("mt-megatraveller");
    expect(ct.hooks.doPromotion?.["noblesSocialByRank"]).toBeDefined();
    expect(mt.hooks.doPromotion?.["noblesSocialByRank"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MT runtime smoke test — does the engine survive a full term?
// ---------------------------------------------------------------------------

describe("MT smoke test: build character, enlist, run a term", () => {
  it("MT Navy term 1 with max rolls: terms=1, ages 4 years, commissions, allocates 2 skill points", () => {
    // Forced max rolls (Math.random=0.999 → every d6=6, every 2d6=12) so
    // survival passes (target 5+), commission passes (10+), promotion
    // passes (8+). MT navy term-1 should give skillsPerTerm (1) +
    // term1Bonus (1) = 2 skill points.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.attributes = {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    };
    c.service = "navy";
    const startAge = c.age;
    c.doServiceTermStep();
    expect(c.serviceDef().serviceName).toBe("Navy");
    expect(c.terms).toBe(1);
    expect(c.age).toBe(startAge + 4);
    expect(c.deceased).toBe(false);
    expect(c.commissioned).toBe(true);
    expect(c.skillPoints).toBeGreaterThanOrEqual(2);
  });

  it("MT character can survive a term and pick skills via auto-resolve", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 12, education: 12, social: 12,
    };
    c.service = "scouts";
    const def = c.serviceDef();
    c.doServiceTermStep();
    // Scouts get skillsPerTerm=2 per MT data (and CT shared logic).
    expect(c.skillPoints).toBeGreaterThanOrEqual(2);
    // Roll out the skills.
    let safety = 20;
    while (c.skillPoints > 0 && safety-- > 0) {
      def.acquireSkill(c);
      c.skillPoints -= 1;
    }
    expect(c.skills.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Step composition is edition-agnostic — same registry, different ordering
// ---------------------------------------------------------------------------

describe("MT data wiring (post-PDF swap)", () => {
  it("MT aging at term 4 applies -1 to Str/Dex/End on failed saves", () => {
    // Force every roll to minimum (Math.random=0 → d6=1 → 2d6=2). Saves
    // are 8/7/8 — all fail at roll 2 → each attribute drops by 1.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.attributes = {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    };
    c.service = "navy";
    c.terms = 4;
    c.age = 34;
    c.doAging();
    // Term-4 row per the JSON aging table: -1 to each of Str/Dex/End.
    expect(c.attributes.strength).toBe(8);
    expect(c.attributes.dexterity).toBe(8);
    expect(c.attributes.endurance).toBe(8);
    // Intelligence isn't affected until term 12+.
    expect(c.attributes.intelligence).toBe(9);
  });

  it("MT musterOutRolls applies cumulative rank-extra bonus (PM p. 17)", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.service = "navy";
    c.terms = 4;
    c.rank = 5;
    // MT: 2 per term × 4 terms + rank 5-6 cumulative +3 = 11
    expect(c.musterOutRolls()).toBe(11);
  });

  it("CT musterOutRolls still uses rank-band scaling (TTB)", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 4;
    c.rank = 5;
    // CT: 1 per term × 4 + rank-band [5,6] +3 = 7
    expect(c.musterOutRolls()).toBe(7);
  });

  it("MT skill allocation honors per-service skillsPerTerm", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 12, education: 12, social: 12,
    };
    c.service = "scouts";
    c.doServiceTermStep();
    // Scouts: skillsPerTerm=2 from JSON, plus 1–2 from MT's specialDuty
    // (target 4 with possible +1 overshoot bonus on roll >=8). All-12s →
    // specialDuty almost certainly succeeds → final total of 3 or 4.
    expect(c.skillPoints).toBeGreaterThanOrEqual(2);
    expect(c.skillPoints).toBeLessThanOrEqual(4);
  });
});

// JSON-side lifecycle declarations for both editions are in
// tests/audit/mt.json.audit.test.ts ("Edition lifecycle.terms
// declarations vs PM"). No engine-runtime equivalent exists here —
// lifecycle wiring is verified per-step by other tests via the
// STEP_REGISTRY resolution test above.
