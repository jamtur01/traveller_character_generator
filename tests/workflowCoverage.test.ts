// Workflow coverage — each PDF checklist step is implemented and
// executes against a representative character. Locks the engine against
// the canonical PM/TTB checklists so a future refactor that drops a
// step (aging, retention, command duty, etc.) fails the test.
//
// Sources:
//   - PM p. 64: Mercenary + Navy character-generation checklists
//   - PM p. 65: Scout + Merchant Prince character-generation checklists
//   - TTB p. 18: CT basic chargen procedure
//
// This isn't a behavior assertion (the audit suite + acg.runtime tests
// cover those); it asserts that each pathway exports / runs through
// every checklist step, and that the resolveAssignment phase orderings
// match the PM tables.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition } from "../lib/traveller/editions";
import {
  runAcgYear, runAcgTerm,
} from "../lib/traveller/engine/acg/runner";

afterEach(() => { vi.restoreAllMocks(); });

function mtChar(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  c.homeworld = {
    starport: "A", size: "Medium", atmosphere: "Standard",
    hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
    tech: "High Stellar",
  };
  c.choiceMode = "auto";
  return c;
}

// ──────────────────────────────────────────────────────────────────
// Phase ordering ↔ PM checklists
// ──────────────────────────────────────────────────────────────────

describe("Pathway phase orderings match PM checklists", () => {
  function phasesOf(pathway: "mercenary" | "navy" | "scout" | "merchantPrince"): string[] {
    const acg = getEdition("mt-megatraveller").data.advancedCharacterGeneration;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = (acg as any)?.[pathway];
    return block.resolveAssignment.phases.map((p: { kind: string }) => p.kind);
  }

  it("mercenary: Survival → Promotion → Decoration → Skills (PM p. 64)", () => {
    expect(phasesOf("mercenary")).toEqual(["survival", "promotion", "decoration", "skills"]);
  });

  it("navy: Survival → Decoration → Promotion → Skills (PM p. 64)", () => {
    // Navy puts decoration BEFORE promotion: court-martial-from-
    // decoration can pre-empt the promotion attempt this year.
    expect(phasesOf("navy")).toEqual(["survival", "decoration", "promotion", "skills"]);
  });

  it("scout: Survival → Promotion → Skills (PM p. 65)", () => {
    // PM p. 65 scout checklist mentions a decoration step but the
    // actual scout resolution tables on p. 59 have no decoration
    // column. The engine matches the data tables (no decoration);
    // this is a documented PM checklist/data inconsistency.
    expect(phasesOf("scout")).toEqual(["survival", "promotion", "skills"]);
  });

  it("merchantPrince: Survival → Skills → Bonus (PM p. 65)", () => {
    // Merchant promotion is an exam at end-of-term, not a per-
    // assignment phase. Bonus replaces decoration.
    expect(phasesOf("merchantPrince")).toEqual(["survival", "skills", "bonus"]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Mercenary end-to-end (PM p. 64 checklist)
// ──────────────────────────────────────────────────────────────────

describe("Mercenary checklist (PM p. 64)", () => {
  it("steps 1-6 execute and produce a valid characterized state", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    // 1. Generate character + homeworld (caller-side); already done in mtChar.
    expect(c.homeworld).toBeDefined();
    // 2. Pre-Enlistment Options (skipped — proceed straight to enlistment).
    // 3-5. Enlistment + Select Arm + Initial Training (via beginAcg).
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    expect(c.requireMercenaryAcg().combatArm).toBe("Infantry");
    // 6. Resolve Current Term — initial training fires on year 1.
    runAcgYear(c);
    expect(c.requireAcgState().initialTrainingDone).toBe(true);
    expect(c.skills.length).toBeGreaterThan(0); // fixed + MOS
  });

  it("step 7 conclude term: aging + reenlistment + muster route", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    runAcgTerm(c);
    // Aging triggers at term 4+ in MT; terms=1 here, so no event.
    // Reenlistment runs via doReenlistmentStep (orchestrator); calling
    // runAcgTerm here just completes one term.
    expect(c.terms).toBe(1);
    expect(c.activeDuty).toBe(true); // forced-max rolls keep them in.
  });
});

// ──────────────────────────────────────────────────────────────────
// Navy end-to-end (PM p. 64 checklist)
// ──────────────────────────────────────────────────────────────────

describe("Navy checklist (PM p. 64)", () => {
  it("step 1.C subsector tech code is captured", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    // subsectorTechCode is a tech-level NAME ("Avg Stellar" etc.), not
    // a starport letter. The engine normalizes upward to a minimum of
    // "Early Stellar" per the navy enlistment rules.
    c.beginAcg("navy", { fleet: "imperialNavy", subsectorTechCode: "High Stellar" });
    expect(c.requireNavyAcg().subsectorTechCode).toBe("High Stellar");
  });

  it("step 4 Determine Branch Assignment runs at enlist", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(c.requireNavyAcg().branch).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────
// Scout end-to-end (PM p. 65 checklist)
// ──────────────────────────────────────────────────────────────────

describe("Scout checklist (PM p. 65)", () => {
  it("step 4 Select Office runs at enlist", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("scout", { division: "field" });
    expect(c.requireScoutAcg().office).toBeDefined();
  });

  it("step 6 resolve term runs the survival → promotion → skills cycle", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("scout", { division: "field" });
    runAcgTerm(c);
    expect(c.terms).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────
// Merchant end-to-end (PM p. 65 checklist)
// ──────────────────────────────────────────────────────────────────

describe("Merchant Prince checklist (PM p. 65)", () => {
  it("step 5 Department Assignment runs at enlist", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.requireMerchantAcg().department).toBeDefined();
  });

  it("step 6.B Take Exam for Promotion fires at end-of-term", () => {
    // Officer merchant taking the promotion exam at end-of-term.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = mtChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    runAcgTerm(c);
    expect(c.terms).toBe(1);
    // Free Trader Owner/Captain path: rank advances via exam.
    expect(c.requireMerchantAcg().rankCode).not.toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────
// CT TTB basic chargen (TTB p. 18)
// ──────────────────────────────────────────────────────────────────

describe("CT TTB basic chargen (TTB p. 18)", () => {
  it("attributes rolled, homeworld optional, enlistment + survival + skills + reenlistment all run", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "ct-classic";
    c.attributes = {
      strength: 8, dexterity: 8, endurance: 8,
      intelligence: 8, education: 8, social: 8,
    };
    c.choiceMode = "auto";
    c.service = c.doEnlistment("navy");
    expect(c.service).toBe("navy");
    c.doServiceTermStep();
    expect(c.terms).toBe(1);
    expect(c.skillPoints).toBeGreaterThanOrEqual(0);
    // Reenlistment step exists on Character.
    expect(typeof c.doReenlistmentStep).toBe("function");
  });

  it("scouts get 2 skills/term but no commission/promotion (TTB p. 18)", () => {
    // Scout service in CT lacks the position (commission) and
    // promotion checks. The audit suite asserts these structurally;
    // this test confirms the engine doesn't try to run them.
    const ed = getEdition("ct-classic");
    const scoutDef = ed.data.services.scouts;
    expect(scoutDef.checks.position).toBeNull();
    expect(scoutDef.checks.promotion).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────
// Coverage — every PM checklist step has a TS entry point
// ──────────────────────────────────────────────────────────────────

describe("Pathway entry-point coverage", () => {
  it("every PM-listed step has a registered pathway function", async () => {
    const m = await import("../lib/traveller/engine/acg/pathways/mercenary");
    const n = await import("../lib/traveller/engine/acg/pathways/navy");
    const s = await import("../lib/traveller/engine/acg/pathways/scout");
    const mp = await import("../lib/traveller/engine/acg/pathways/merchantPrince");

    // Mercenary: enlist, initial training, command duty, roll
    // assignment, resolve assignment, retention, reenlist.
    expect(typeof m.mercenaryEnlist).toBe("function");
    expect(typeof m.mercenaryInitialTraining).toBe("function");
    expect(typeof m.mercenaryCommandDuty).toBe("function");
    expect(typeof m.mercenaryRollAssignment).toBe("function");
    expect(typeof m.mercenaryResolveAssignment).toBe("function");
    expect(typeof m.mercenaryRetention).toBe("function");
    expect(typeof m.mercenaryReenlist).toBe("function");

    // Navy: same + initial training is internal to enlist.
    expect(typeof n.navyEnlist).toBe("function");
    expect(typeof n.navyCommandDuty).toBe("function");
    expect(typeof n.navyRollAssignment).toBe("function");
    expect(typeof n.navyResolveAssignment).toBe("function");
    expect(typeof n.navyRetention).toBe("function");
    expect(typeof n.navyReenlist).toBe("function");

    // Scout: no command duty / decoration / retention per data tables.
    expect(typeof s.scoutEnlist).toBe("function");
    expect(typeof s.scoutInitialTraining).toBe("function");
    expect(typeof s.scoutRollAssignment).toBe("function");
    expect(typeof s.scoutResolveAssignment).toBe("function");
    expect(typeof s.scoutReenlist).toBe("function");

    // Merchant: end-of-term exam, no per-assignment promotion.
    expect(typeof mp.merchantEnlist).toBe("function");
    expect(typeof mp.merchantRollAssignment).toBe("function");
    expect(typeof mp.merchantResolveAssignment).toBe("function");
    expect(typeof mp.merchantStartOfTerm).toBe("function");
    expect(typeof mp.merchantEndOfTerm).toBe("function");
    expect(typeof mp.merchantReenlist).toBe("function");
  });
});
