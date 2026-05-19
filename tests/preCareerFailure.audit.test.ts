// Pre-career failure consequences audit (PM p. 47, Rrev2).
//
// When a pre-career success roll fails (admitted but washed out), the
// engine must:
//   - Age the character +1 year and set preCareerFirstTermShort = true
//   - Naval Academy → drafted into navy
//   - Military / Merchant Academy → drafted into army
//   - Flight School → drafted into navy (reports for duty short-term)
//   - College → first term short, no draft (free enlistment)
// On the first term:
//   - termLength is 3 (not 4), yearsServed advances by 3
//   - partialTerms bumps by 1 (3-year terms don't count as full muster)
//   - The flag is consumed so the second term runs at 4 years
// Admission roll failure (school didn't accept you) is distinct:
//   - No aging, no draft, no short term — the character may attempt
//     another option or enlist normally.
// Draft override on beginAcg consumes preCareerDraftedInto:
//   - "navy" → pathway=navy, service=navy, drafted=true
//   - "army" → pathway=mercenary, service=army, drafted=true
//   - "marines" → pathway=mercenary, service=marines, drafted=true

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

describe("Success-failure: aging +1 year (PM p. 47)", () => {
  function washOut(c: Character, opt: Parameters<Character["doPreCareer"]>[0]): void {
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      // First 2 rolls = admission (pass); subsequent = success (fail).
      return call <= 2 ? 0.999 : 0;
    });
    c.doPreCareer(opt);
  }

  it("Naval Academy washout: age +1", () => {
    const c = freshAcgCandidate(10);
    const startAge = c.age;
    washOut(c, "navalAcademy");
    expect(c.age).toBe(startAge + 1);
  });

  it("Military Academy washout: age +1", () => {
    const c = freshAcgCandidate(10);
    c.attributes.social = 6;
    const startAge = c.age;
    washOut(c, "militaryAcademy");
    expect(c.age).toBe(startAge + 1);
  });
});

describe("Success-failure draft routing (PM p. 47)", () => {
  function washOut(c: Character, opt: Parameters<Character["doPreCareer"]>[0]): void {
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      return call <= 2 ? 0.999 : 0;
    });
    c.doPreCareer(opt);
  }

  it("Naval Academy → preCareerDraftedInto=navy", () => {
    const c = freshAcgCandidate(10);
    washOut(c, "navalAcademy");
    expect(c.acgState?.preCareerDraftedInto).toBe("navy");
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });

  it("Military Academy → preCareerDraftedInto=army", () => {
    const c = freshAcgCandidate(10);
    c.attributes.social = 6;
    washOut(c, "militaryAcademy");
    expect(c.acgState?.preCareerDraftedInto).toBe("army");
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });

  it("College washout → short term only, no draft", () => {
    const c = freshAcgCandidate(10);
    c.attributes.education = 12;
    c.attributes.intelligence = 2; // force success fail
    washOut(c, "college");
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
    expect(c.acgState?.preCareerDraftedInto).toBeFalsy();
  });
});

describe("Admission-denial: no draft, no aging (PM p. 47 Rrev11)", () => {
  it("Naval Academy admission failure leaves no draft flag and no aging", () => {
    const c = freshAcgCandidate(8); // meets Soc 8+ gate
    c.attributes.education = 2;     // tank admission DM
    const startAge = c.age;
    vi.spyOn(Math, "random").mockReturnValue(0); // admission rolls min → fail
    const r = c.doPreCareer("navalAcademy");
    expect(r.admitted).toBe(false);
    expect(c.age).toBe(startAge);
    expect(c.acgState?.preCareerDraftedInto).toBeFalsy();
    expect(c.acgState?.preCareerFirstTermShort).toBeFalsy();
  });
});

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
