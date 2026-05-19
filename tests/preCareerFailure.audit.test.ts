// Pre-career failure consequences audit (PM p. 47, Rrev2).
//
// Per-school washout aging + draft routing is covered in
// tests/preCareer.test.ts ("R3: pre-career failure short-term outcomes").
// This file picks up the downstream consequences not exercised there:
//   - beginAcg consumes preCareerDraftedInto and overrides pathway/service
//   - First term runs 3 years (not 4) and the flag is consumed
//   - Second term runs the normal 4 years
//   - Flight School washout drafts navy + sets the short-term flag
//     (the only success-failure case not already exercised in preCareer.test.ts)

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { runAcgTerm } from "../lib/traveller/engine/runners/acg";

afterEach(() => { vi.restoreAllMocks(); });

function freshAcgCandidate(attrs = 12): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.attributes = {
    strength: attrs, dexterity: attrs, endurance: attrs,
    intelligence: attrs, education: attrs, social: attrs,
  };
  c.useAcg = true;
  return c;
}

describe("beginAcg consumes draft flag (PM p. 47 Rrev2)", () => {
  function drafted(into: "army" | "navy" | "marines"): Character {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "auto";
    c.acgState = {
      pathway: "mercenary", rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      preCareerDraftedInto: into,
      preCareerFirstTermShort: true,
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    return c;
  }

  it("draft=navy → navy pathway + service, drafted flag set", () => {
    const c = drafted("navy");
    c.beginAcg("mercenary"); // chosen pathway is overridden
    expect(c.acgPathway).toBe("navy");
    expect(c.service).toBe("navy");
    expect(c.drafted).toBe(true);
  });

  it("draft=army → mercenary pathway + army service", () => {
    const c = drafted("army");
    c.beginAcg("navy");
    expect(c.acgPathway).toBe("mercenary");
    expect(c.service).toBe("army");
    expect(c.drafted).toBe(true);
  });

  it("draft=marines → mercenary pathway + marines service", () => {
    const c = drafted("marines");
    c.beginAcg("scout");
    expect(c.acgPathway).toBe("mercenary");
    expect(c.service).toBe("marines");
    expect(c.drafted).toBe(true);
  });

  it("preCareerFirstTermShort survives the beginAcg state reset", () => {
    const c = drafted("navy");
    c.beginAcg("mercenary");
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });
});

describe("First term runs at 3 years with preCareerFirstTermShort (PM p. 47)", () => {
  it("3-year first term: yearsServed = 3, partialTerms = 1, flag consumed", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "auto";
    c.showHistory = "none";
    c.acgState = {
      pathway: "mercenary", rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      preCareerDraftedInto: "army",
      preCareerFirstTermShort: true,
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999); // pass every roll
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    const yearsBefore = c.acgState!.yearsServed ?? 0;
    runAcgTerm(c);
    const yearsServed = (c.acgState!.yearsServed ?? 0) - yearsBefore;
    expect(yearsServed).toBe(3);
    expect(c.acgState!.partialTerms ?? 0).toBeGreaterThanOrEqual(1);
    expect(c.acgState!.preCareerFirstTermShort).toBeFalsy();
    expect(c.terms).toBe(1);
  });

  it("Second term (no flag) runs 4 years", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "auto";
    c.showHistory = "none";
    c.acgState = {
      pathway: "mercenary", rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      preCareerDraftedInto: "army",
      preCareerFirstTermShort: true,
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    runAcgTerm(c); // first term: 3 years
    const yearsAfterFirst = c.acgState!.yearsServed ?? 0;
    runAcgTerm(c); // second term: 4 years
    const yearsServedSecond = (c.acgState!.yearsServed ?? 0) - yearsAfterFirst;
    expect(yearsServedSecond).toBe(4);
    expect(c.terms).toBe(2);
  });
});

describe("Flight School washout drafts navy short-term (PM p. 47)", () => {
  it("Naval Academy honors → Flight School washout: drafted navy, short term", () => {
    // Build a Naval Academy honors graduate (auto-admits Flight School).
    const c = freshAcgCandidate(12);
    c.acgState = {
      pathway: "navy", rankCode: "O1", isOfficer: true, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: ["navalAcademy"], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      honorsGraduations: ["navalAcademy"],
      preCareerCommission: true,
    };
    vi.spyOn(Math, "random").mockReturnValue(0); // success roll fails
    const r = c.doPreCareer("flightSchool");
    expect(r.graduated).toBe(false);
    expect(c.acgState?.preCareerDraftedInto).toBe("navy");
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });
});
