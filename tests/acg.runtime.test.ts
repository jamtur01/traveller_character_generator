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

  it("Full 4-year term with max rolls: term completes, age 22, 1+ brownie point", () => {
    // Math.random=0.999 → every roll is the max. Survival, promotion,
    // skill rolls all pass; the term completes normally.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    runAcgTerm(c);
    expect(c.activeDuty).toBe(true);
    expect(c.deceased).toBe(false);
    expect(c.terms).toBe(1);
    expect(c.age).toBe(22);
    expect(c.browniePoints).toBeGreaterThanOrEqual(1); // term completion BP
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

  // System Squadron rank-cap enforcement is covered exhaustively in
  // tests/navyRankCaps.test.ts, which directly invokes navyResolveAssignment
  // with a known-promoting assignment ("Battle"). Keeping that coverage there
  // avoids depending on runAcgYear's assignment-roll randomness (max-roll
  // forced random lands on "Special Duty" which doesn't promote).
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

  it("R6: Megacorp enlistment runs Merchant Academy attempt when opted in (Rrev5)", () => {
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
    // Per Rrev5 the Academy is opt-in (PM "may apply"). Force lazy-init
    // of acgState (browniePoints setter creates it) then set the flag.
    c.browniePoints = 0;
    c.acgState!.attemptMerchantAcademy = true;
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    expect(c.acgState!.schoolsAttended).toContain("merchantAcademy");
  });

  it("Rrev5: Megacorp enlistment skips Merchant Academy by default (auto mode)", () => {
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
    // No opt-in flag → Academy is skipped in auto mode.
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    expect(c.acgState!.schoolsAttended).not.toContain("merchantAcademy");
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
    // Opt in for Rrev5 via the engine. Force lazy-init of acgState
    // (browniePoints setter creates it) and then set the flag.
    c.browniePoints = 0;
    c.acgState!.attemptMerchantAcademy = true;
    c.beginAcg("merchantPrince", { lineType: "Megacorp" });
    expect(c.acgState!.department).toBeDefined();
  });

  it("Enlisted ranks advance on each new term via startOfTerm hook", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("merchantPrince", { lineType: "Free Trader" });
    expect(c.acgState!.rankCode).toBe("E1");
    runAcgTerm(c);
    runAcgTerm(c);
    expect(c.activeDuty).toBe(true); // forced-max rolls keep them alive
    // After at least one completed term, the enlisted rank should have
    // advanced via the startOfTerm hook.
    expect(c.acgState!.rankCode).not.toBe("E1");
  });
});

// ---------------------------------------------------------------------------
// Awards: decorations, brownie points
// ---------------------------------------------------------------------------

describe("ACG awards", () => {
  it("Mercenary on a combat assignment (Raid) with max decoration roll earns SEH + BP", async () => {
    // Max roll (Math.random=0.999 → 12) against Raid decoration target 6+
    // = margin +6 → SEH (resolveDecorationTier: minMargin 6).
    // SEH awards 3 brownie points per the JSON awards table.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { mercenaryResolveAssignment } = await import(
      "../lib/traveller/engine/acg/pathways/mercenary"
    );
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    const bpBefore = c.browniePoints;
    mercenaryResolveAssignment(c, "Raid");
    expect(c.decorations).toContain("SEH");
    expect(c.browniePoints).toBe(bpBefore + 3);
  });

  it("Mercenary on Raid with mid-tier roll earns MCG and 2 BP", async () => {
    // Pin the rolls so decoration margin = +3 → MCG (minMargin 3).
    // Raid resolution order: survival → promotion → decoration → skills.
    // Setup with max rolls first so beginAcg's enlistment passes, then
    // swap the mock to the controlled sequence right before invoking
    // resolveAssignment.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { mercenaryResolveAssignment } = await import(
      "../lib/traveller/engine/acg/pathways/mercenary"
    );
    const c = freshAcgChar();
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    // Now control the rolls for the Raid resolution. Each rollVsTarget
    // uses roll(2) = 2 Math.random calls. Promotion DM is +1 (edu 9 ≥ 7).
    //   Survival:   2d6 = 12 (pass)
    //   Promotion:  2d6 = 12 + 1 = 13 (pass)
    //   Decoration: 2d6 = 9, margin +3 → MCG
    //   Skills:     2d6 = 12 (pass)
    let i = 0;
    const seq = [
      5 / 6 + 0.001, 5 / 6 + 0.001, // survival 12
      5 / 6 + 0.001, 5 / 6 + 0.001, // promotion 12
      4 / 6 + 0.001, 3 / 6 + 0.001, // decoration 5+4=9 → margin +3
      5 / 6 + 0.001, 5 / 6 + 0.001, // skills 12
    ];
    vi.restoreAllMocks();
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0.999);
    const bpBefore = c.browniePoints;
    mercenaryResolveAssignment(c, "Raid");
    expect(c.decorations).toContain("MCG");
    expect(c.decorations).not.toContain("SEH");
    expect(c.browniePoints).toBe(bpBefore + 2);
  });

  it("Completing a 4-year scout term awards exactly 1 brownie point (term completion)", () => {
    // Scouts have no decorations (no decoration column in their resolution
    // table), so BP must come from the term-completion award alone.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgChar();
    c.beginAcg("scout", { division: "field" });
    const bpBefore = c.browniePoints;
    runAcgTerm(c);
    expect(c.activeDuty).toBe(true);
    expect(c.deceased).toBe(false);
    expect(c.browniePoints).toBe(bpBefore + 1);
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
    const startTerms = c.terms;
    c.doServiceTermStep();
    expect(c.activeDuty).toBe(true);
    expect(c.deceased).toBe(false);
    expect(c.terms).toBe(startTerms + 1);
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
