// Tests for the architectural changes that moved pathway routing and DM
// rules out of TypeScript into the edition JSON, and that switched the ACG
// pathway runtime to a hooks-based registry.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition, listEditions } from "../lib/traveller/editions";
import { applyStructuredDms } from "../lib/traveller/engine/acg/tables";
import { freshAcgState } from "../lib/traveller/engine/acg/state";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Structured DM arrays evaluate correctly", () => {
  function makeCh(withAcgState = false): Character {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.attributes = {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7,
    };
    if (withAcgState) {
      c.useAcg = true;
      c.acgState = freshAcgState("mercenary");
    }
    return c;
  }

  it("attribute threshold (min) fires when attribute ≥ min", () => {
    const c = makeCh();
    c.attributes.education = 9;
    const dm = applyStructuredDms(
      [{ attribute: "education", min: 9, dm: 2 }],
      c,
    );
    expect(dm).toBe(2);
    c.attributes.education = 8;
    expect(applyStructuredDms(
      [{ attribute: "education", min: 9, dm: 2 }],
      c,
    )).toBe(0);
  });

  it("attribute threshold (max) fires when attribute ≤ max", () => {
    const c = makeCh();
    c.attributes.intelligence = 7;
    expect(applyStructuredDms(
      [{ attribute: "intelligence", max: 7, dm: -1 }],
      c,
    )).toBe(-1);
    c.attributes.intelligence = 8;
    expect(applyStructuredDms(
      [{ attribute: "intelligence", max: 7, dm: -1 }],
      c,
    )).toBe(0);
  });

  it("rankAtMost fires when same-letter rank ≤ given", () => {
    const c = makeCh(true);
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O2";
    expect(applyStructuredDms([{ rankAtMost: "O2", dm: -2 }], c)).toBe(-2);
    c.acgState!.rankCode = "O3";
    expect(applyStructuredDms([{ rankAtMost: "O2", dm: -2 }], c)).toBe(0);
  });

  it("fleet condition fires only for matching fleet", () => {
    const c = makeCh(true);
    c.acgState!.fleet = "imperialNavy";
    expect(applyStructuredDms([{ fleet: "imperialNavy", dm: -2 }], c)).toBe(-2);
    c.acgState!.fleet = "reserveFleet";
    expect(applyStructuredDms([{ fleet: "imperialNavy", dm: -2 }], c)).toBe(0);
  });

  it("service condition fires only for matching service", () => {
    const c = makeCh(true);
    c.acgState!.isOfficer = false;
    c.service = "marines";
    c.attributes.education = 7;
    expect(applyStructuredDms([
      { enlisted: true, service: "marines", attribute: "education", min: 7, dm: 1 },
    ], c)).toBe(1);
    c.service = "army";
    expect(applyStructuredDms([
      { enlisted: true, service: "marines", attribute: "education", min: 7, dm: 1 },
    ], c)).toBe(0);
  });
});

describe("Dynamic pathway factory registry via EditionHooks", () => {
  it("MT registers all four ACG pathways through hooks.acgPathways", () => {
    const ed = getEdition("mt-megatraveller");
    const factories = ed.hooks.acgPathways;
    expect(factories).toBeDefined();
    expect(Object.keys(factories!).sort()).toEqual(
      ["mercenary", "merchantPrince", "navy", "scout"],
    );
    for (const [name, factory] of Object.entries(factories!)) {
      const impl = factory();
      expect(impl.pathway).toBe(name);
      expect(typeof impl.enlist).toBe("function");
      expect(typeof impl.rollAssignment).toBe("function");
      expect(typeof impl.resolveAssignment).toBe("function");
      expect(typeof impl.reenlist).toBe("function");
    }
  });

  it("CT-classic does not register ACG pathways (no ACG in edition)", () => {
    const ed = getEdition("ct-classic");
    expect(ed.hooks.acgPathways).toBeUndefined();
  });

  it("Runner throws a clear error for unregistered pathway", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.useAcg = true;
    c.acgState = freshAcgState("mercenary");
    expect(() => c.doServiceTermStep()).toThrow(
      /No ACG pathway implementation for "mercenary"/,
    );
  });
});

// JSON-side declaration of rules.survival.onFailure='shortTerm' is in
// tests/audit/mt.json.audit.test.ts. This block tests the engine-side
// consequence of that declaration.

describe("MT survival failure routes through non-death short-term path", () => {
  it("MT survival failure: 2-year short term, no muster benefits, commission/promotion skipped", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.attributes = {
      strength: 2, dexterity: 2, endurance: 2,
      intelligence: 2, education: 2, social: 2,
    };
    c.service = "army";
    const ageBefore = c.age;
    // Force survival failure by setting roll to absolute minimum.
    const spy = vi
      .spyOn(Math, "random")
      .mockReturnValue(0); // all rolls = 1, lowest possible
    c.doServiceTermStep();
    expect(c.shortTermsCount).toBe(1);
    expect(c.shortTermThisTerm).toBe(true);
    // Term is added but only 2 years pass.
    expect(c.age).toBe(ageBefore + 2);
    expect(c.terms).toBe(1);
    expect(c.activeDuty).toBe(false);
    // No commission attempt (which would set commissioned=true).
    expect(c.commissioned).toBe(false);
    // Muster-out rolls exclude this short term entirely.
    expect(c.musterOutRolls()).toBe(0);
    spy.mockRestore();
  });
  it("CT survival block omits onFailure (defaults to death)", () => {
    const ct = getEdition("ct-classic");
    const rules = ct.data.rules as { survival?: { onFailure?: unknown } } | undefined;
    // CT declares rules.survival only for fullTermYears; with no onFailure,
    // survival.ts falls back to "death" (no short-term injury path).
    expect(rules?.survival?.onFailure).toBeUndefined();
  });
});

describe("trigger='term' automatic skills fire at the matching term", () => {
  it("MT Belter gets Zero-G Environ-1 at the start of term 3", () => {
    // Pin Math.random high so every survival / promotion / skill roll
    // passes — otherwise this test is a flake (the Belter survival
    // target is 9; ~85% pass per term means ~61% chance of clean run).
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.attributes = {
      strength: 10, dexterity: 10, endurance: 10,
      intelligence: 10, education: 10, social: 10,
    };
    c.service = "belters";
    // doServiceTermStep increments terms first, so 3 calls reach term 3.
    // The autoSkillTerm step matches entry.term===3 → Zero-G Environ-1.
    c.terms = 0;
    for (let t = 0; t < 3; t++) c.doServiceTermStep();
    expect(c.terms).toBe(3);
    const level = c.skills.find((s) => s[0] === "Zero-G Environ")?.[1] ?? 0;
    expect(level).toBeGreaterThanOrEqual(1);
    vi.restoreAllMocks();
  });

  it("trigger='term' entries do NOT fire on other terms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.attributes = {
      strength: 10, dexterity: 10, endurance: 10,
      intelligence: 10, education: 10, social: 10,
    };
    c.service = "belters";
    c.terms = 0;
    c.doServiceTermStep(); // terms → 1
    c.doServiceTermStep(); // terms → 2
    expect(c.terms).toBe(2);
    const level = c.skills.find((s) => s[0] === "Zero-G Environ")?.[1] ?? 0;
    expect(level).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("All registered editions either have ACG pathways or omit ACG entirely", () => {
  it("every edition with advancedCharacterGeneration registers acgPathways", () => {
    for (const meta of listEditions()) {
      const ed = getEdition(meta.id);
      const hasAcg = ed.data.advancedCharacterGeneration !== undefined;
      if (hasAcg) {
        expect(ed.hooks.acgPathways).toBeDefined();
        const declared = Object.keys(ed.data.advancedCharacterGeneration!)
          .filter((k) => k !== "common" && k !== "source" && k !== "coverage" && k !== "homeworld");
        for (const pathway of declared) {
          expect(ed.hooks.acgPathways![pathway]).toBeDefined();
        }
      }
    }
  });
});
