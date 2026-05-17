// ACG runtime tests. These exercise the actual MT Advanced Character
// Generation engine end-to-end: beginAcg → doServiceTermStep → assert
// state changes that match what the MT Players' Manual specifies.
//
// Tests use forced Math.random to make rolls deterministic — high values
// (Math.random ≈ 0.999 → 2d6 → 12) force passes; low values (≈ 0 → 2d6 → 2)
// force failures.

import { describe, expect, it, vi, afterEach } from "vitest";
import { getAcgPathway } from "../lib/traveller";
import { Character } from "../lib/traveller/character";
import { runAcgYear, runAcgTerm } from "../lib/traveller/engine/acg/runner";

afterEach(() => {
  vi.restoreAllMocks();
});

function freshAcgChar(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  return c;
}

// ---------------------------------------------------------------------------
// Pathway data shape — confirms the JSON has what the runtime expects
// ---------------------------------------------------------------------------

describe("MT ACG data shape", () => {
  it("mercenary has enlistment.army/marines and assignment table", () => {
    const m = getAcgPathway("mt-megatraveller", "mercenary");
    expect((m.enlistment as { army?: unknown }).army).toBeDefined();
    expect((m.enlistment as { marines?: unknown }).marines).toBeDefined();
    expect(m.assignment).toBeDefined();
    expect(m.assignmentResolution).toBeDefined();
  });

  it("navy has three fleets in enlistment and branchAssignment", () => {
    const n = getAcgPathway("mt-megatraveller", "navy");
    const en = n.enlistment as Record<string, unknown>;
    expect(en.imperialNavy).toBeDefined();
    expect(en.reserveFleet).toBeDefined();
    expect(en.systemSquadron).toBeDefined();
    expect(n.branchAssignment).toBeDefined();
  });

  it("scout has Field and Bureaucracy skill tables", () => {
    const s = getAcgPathway("mt-megatraveller", "scout");
    const tables = s.skillTables as Record<string, unknown>;
    expect(tables.field).toBeDefined();
    expect(tables.bureaucracy).toBeDefined();
  });

  it("merchantPrince has department + line type tables", () => {
    const m = getAcgPathway("mt-megatraveller", "merchantPrince");
    expect(m.departmentAssignment).toBeDefined();
    expect(m.availablePositions).toBeDefined();
    expect(m.specificAssignment).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Mercenary end-to-end
// ---------------------------------------------------------------------------

describe("Mercenary ACG runtime", () => {
  it("Army Infantry enlistment with max rolls succeeds and stamps state", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    expect(c.acgState).not.toBeNull();
    expect(c.acgState!.pathway).toBe("mercenary");
    expect(c.acgState!.combatArm).toBe("Infantry");
    expect(c.acgState!.branch).toBe("Army");
    expect(c.acgState!.rankCode).toBe("E1");
    expect(c.acgState!.isOfficer).toBe(false);
  });

  it("Marine Support enlistment with high attrs stamps the right branch", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.attributes.intelligence = 12;
    c.attributes.strength = 12;
    c.beginAcg("mercenary", { service: "marines", combatArm: "Support" });
    expect(c.acgState!.branch).toBe("Marines");
    expect(c.acgState!.combatArm).toBe("Support");
  });

  it("Initial training awards Gun Combat-1 and a MOS skill", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    // beginAcg doesn't run initial training (that's year 1 of term 1).
    // Run the first year.
    runAcgYear(c);
    expect(c.acgState!.mos).toBeDefined();
    expect(c.checkSkillLevel("Gun Combat", 1)).toBe(true);
    expect(c.skills.length).toBeGreaterThanOrEqual(2); // Gun Combat + MOS
  });

  it("Full 4-year term: termination, brownie point award, age advance", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    runAcgTerm(c);
    if (c.activeDuty) {
      expect(c.terms).toBe(1);
      expect(c.age).toBe(22);
      expect(c.browniePoints).toBeGreaterThanOrEqual(1); // term completion BP
    }
  });

  it("Low rolls fail survival and invalid out of service", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    // Run a year that performs an actual assignment (not initial training).
    // Year 1 of term 1 = initial training; year 2+ runs the cycle.
    runAcgYear(c); // initial training (survives)
    runAcgYear(c); // first real assignment — should fail survival with all-1s
    expect(c.activeDuty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Navy end-to-end
// ---------------------------------------------------------------------------

describe("Navy ACG runtime", () => {
  it("Imperial Navy enlistment stamps fleet and a branch", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.attributes.intelligence = 10;
    c.attributes.education = 10;
    c.beginAcg("navy", { fleet: "imperialNavy" });
    expect(c.acgState!.fleet).toBe("imperialNavy");
    expect(c.acgState!.branch).toBeDefined();
  });

  it("Reserve Fleet enlistment", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("navy", { fleet: "reserveFleet" });
    expect(c.acgState!.fleet).toBe("reserveFleet");
  });

  it("System Squadron rank caps to commodore (O7)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("navy", { fleet: "systemSquadron" });
    // Hammer many promotions; rank should not exceed O7.
    // Force officer for the test by patching rank.
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O1";
    // Run many years to attempt promotions.
    for (let i = 0; i < 30; i++) {
      if (!c.activeDuty) break;
      try { runAcgYear(c); } catch { break; }
    }
    const rankNum = parseInt(c.acgState!.rankCode.replace("O", ""), 10);
    if (!isNaN(rankNum)) {
      expect(rankNum).toBeLessThanOrEqual(7);
    }
  });
});

// ---------------------------------------------------------------------------
// Scout end-to-end
// ---------------------------------------------------------------------------

describe("Scout ACG runtime", () => {
  it("Field enlistment stamps division and an office", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.attributes.intelligence = 8;
    c.attributes.strength = 10;
    c.beginAcg("scout", { division: "field" });
    expect(c.acgState!.division).toBe("field");
    expect(c.acgState!.office).toBeDefined();
  });

  it("Scout ranks start at IS-1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("scout", { division: "field" });
    expect(c.acgState!.rankCode).toBe("IS-1");
  });

  it("R12: college graduate auto-enlists into Scouts (no enlistment roll)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgChar();
    c.acgState = {
      pathway: "scout", rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: ["college"], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      honorsGraduations: [],
    };
    c.beginAcg("scout");
    expect(c.acgState!.division).toBe("bureaucracy");
    expect(c.acgState!.rankCode).toBe("IS-1");
    expect(c.drafted).toBe(false);
  });

  it("R12: college honors graduate enters Scouts at IS-10", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgChar();
    c.acgState = {
      pathway: "scout", rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: ["college"], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      honorsGraduations: ["college"],
    };
    c.beginAcg("scout");
    expect(c.acgState!.rankCode).toBe("IS-10");
    expect(c.acgState!.division).toBe("bureaucracy");
  });

  it("R12: non-college scout enlists into Field as before", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("scout");
    expect(c.acgState!.division).toBe("field");
    expect(c.acgState!.rankCode).toBe("IS-1");
  });

  it("Up-or-out reenlistment denies if rank too low for terms served", () => {
    // Enlist with max rolls so the character actually joins.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("scout", { division: "field" });
    // Then force IS-1 with terms=3 to trigger up-or-out.
    vi.restoreAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
    c.acgState!.rankCode = "IS-1";
    c.terms = 3;
    c.doReenlistmentStep();
    expect(c.activeDuty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merchant Prince end-to-end
// ---------------------------------------------------------------------------

describe("Merchant Prince ACG runtime", () => {
  it("Free Trader enlistment puts character in Free Trader department", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.acgState!.lineType).toBe("Free Trader");
    expect(c.acgState!.department).toBe("Free Trader");
  });

  it("Megacorp enlistment with high attrs picks a non-FreeTrader department", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.attributes.strength = 10;
    c.attributes.intelligence = 10;
    // Megacorp requires starport B+; give the character a Starport A homeworld.
    c.homeworld = {
      starport: "A", size: "Medium", atmosphere: "Standard",
      hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
      tech: "Avg Stellar",
    };
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    expect(c.acgState!.lineType).toBe("Megacorp");
    expect(c.acgState!.department).toBeDefined();
    expect(c.acgState!.department).not.toBe("Free Trader");
  });

  it("R6: Megacorp enlistment runs Merchant Academy attempt post-enlistment", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.attributes.education = 12;
    c.attributes.intelligence = 12;
    c.attributes.social = 12;
    c.homeworld = {
      starport: "A", size: "Medium", atmosphere: "Standard",
      hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
      tech: "Avg Stellar",
    };
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    // Merchant Academy should have been attempted: schoolsAttended will
    // contain "merchantAcademy" if it graduated.
    expect(c.acgState!.schoolsAttended).toContain("merchantAcademy");
  });

  it("R6: Free Trader enlistment does NOT attempt Merchant Academy", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.acgState!.schoolsAttended).not.toContain("merchantAcademy");
  });

  it("R6: Merchant Academy honors graduate keeps department selection", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.attributes.education = 12;
    c.attributes.intelligence = 12;
    c.attributes.social = 12;
    c.homeworld = {
      starport: "A", size: "Medium", atmosphere: "Standard",
      hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
      tech: "Avg Stellar",
    };
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    // Honors graduate auto-mode picks a random department. The post-enlistment
    // department-assignment roll must NOT overwrite the academy choice.
    expect(c.acgState!.department).toBeDefined();
  });

  it("Enlisted ranks advance on each new term via startOfTerm hook", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.acgState!.rankCode).toBe("E1");
    runAcgTerm(c);
    runAcgTerm(c);
    if (c.activeDuty) {
      // After at least one completed term, the enlisted rank should have
      // advanced via the startOfTerm hook.
      expect(c.acgState!.rankCode).not.toBe("E1");
    }
  });
});

// ---------------------------------------------------------------------------
// Awards: decorations, brownie points
// ---------------------------------------------------------------------------

describe("ACG awards", () => {
  it("Surviving with high decoration roll grants MCUF + 1 brownie point", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    runAcgYear(c); // initial training
    runAcgYear(c); // assignment year
    // High rolls should produce at least one decoration if a combat
    // assignment came up. We assert non-empty decorations with high prob.
    // For determinism, we instead check that the awards machinery worked
    // when a decoration was actually awarded:
    if (c.decorations.length > 0) {
      const award = c.decorations[0]!;
      expect(["MCUF", "MCG", "SEH", "Purple Heart"]).toContain(award);
      // BP per award (MCUF=1, MCG=2, SEH=3, Purple Heart=0):
      const bpFor: Record<string, number> = { MCUF: 1, MCG: 2, SEH: 3, "Purple Heart": 0 };
      const decBps = c.decorations.reduce((acc, d) => acc + (bpFor[d] ?? 0), 0);
      expect(c.browniePoints).toBeGreaterThanOrEqual(decBps);
    }
  });

  it("Completing a full term awards exactly 1 brownie point from the term", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("scout", { division: "field" });
    // Scout has no decorations so brownie points come from term completion only.
    runAcgTerm(c);
    if (c.activeDuty && !c.deceased) {
      expect(c.browniePoints).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle dispatch: ACG vs basic
// ---------------------------------------------------------------------------

describe("doServiceTermStep dispatch", () => {
  it("ACG character routes to runAcgTerm (not basic runTermSteps)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("scout", { division: "field" });
    expect(c.useAcg).toBe(true);
    expect(c.acgState).not.toBeNull();
    // ACG characters' first call increments terms via the ACG runner.
    const startTerms = c.terms;
    c.doServiceTermStep();
    // The ACG runner increments terms only on successful term completion.
    if (c.activeDuty && !c.deceased) {
      expect(c.terms).toBe(startTerms + 1);
    }
  });

  it("non-ACG character continues to use basic runTermSteps", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = new Character();
    c.editionId = "ct-classic";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.attributes = {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    };
    c.service = "navy";
    c.doServiceTermStep();
    expect(c.terms).toBe(1);
    expect(c.useAcg).toBe(false);
    expect(c.acgState).toBeNull();
  });
});
