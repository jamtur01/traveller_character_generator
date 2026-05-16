// Tests for the architectural changes that moved pathway routing and DM
// rules out of TypeScript into the edition JSON, and that switched the ACG
// pathway runtime to a hooks-based registry.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Character } from "../lib/traveller/character";
import { getEdition, listEditions } from "../lib/traveller/editions";
import { applyStructuredDms } from "../lib/traveller/engine/acg/tables";

const json = JSON.parse(
  readFileSync(
    resolve(__dirname, "../data/editions/mt-megatraveller.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const acg = (json.advancedCharacterGeneration ?? {}) as Record<string, unknown>;
const mercenary = (acg.mercenary ?? {}) as Record<string, unknown>;
const navy = (acg.navy ?? {}) as Record<string, unknown>;

describe("Pathway → resolution sub-table mappings live in JSON", () => {
  it("mercenary.combatArmResolution maps every combat arm to a sub-table", () => {
    const map = mercenary.combatArmResolution as Record<string, string>;
    const arms = mercenary.combatArms as string[];
    expect(map).toBeDefined();
    const resKeys = Object.keys(
      mercenary.assignmentResolution as Record<string, unknown>,
    );
    for (const arm of arms) {
      expect(map[arm]).toBeDefined();
      expect(resKeys).toContain(map[arm]);
    }
  });

  it("navy.branchResolution maps every branch to a sub-table", () => {
    const map = navy.branchResolution as Record<string, string>;
    const branches = navy.branches as string[];
    expect(map).toBeDefined();
    const resKeys = Object.keys(
      navy.assignmentResolution as Record<string, unknown>,
    );
    for (const branch of branches) {
      expect(map[branch]).toBeDefined();
      expect(resKeys).toContain(map[branch]);
    }
  });
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
      // Trigger the lazy getter on acgState which initializes it.
      c.browniePoints = 0;
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
    c.browniePoints = 0; // initializes acgState
    c.acgState!.pathway = "mercenary" as never;
    expect(() => c.doServiceTermStep()).toThrow(
      /No ACG pathway implementation for "mercenary"/,
    );
  });
});

describe("Navy fleet-specific reenlistment uses per-fleet targets from JSON", () => {
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

describe("MT survival rule declares non-death failure", () => {
  it("rules.survival.onFailure is 'musterOut' for MT", () => {
    const rules = json.rules as { survival?: { onFailure?: string } };
    expect(rules.survival?.onFailure).toBe("musterOut");
  });
  it("CT lacks the survival rules block (defaults to death)", () => {
    const ct = getEdition("ct-classic");
    const rules = ct.data.rules as { survival?: unknown } | undefined;
    expect(rules?.survival).toBeUndefined();
  });
});

describe("trigger='term' automatic skills fire at the matching term", () => {
  it("MT Belter gets Zero-G Environ-1 at the start of term 3", () => {
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
  });

  it("trigger='term' entries do NOT fire on other terms", () => {
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
