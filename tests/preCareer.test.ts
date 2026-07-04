// Pre-career options tests. Verify each option (College, Naval/Military/
// Merchant Academy, Medical School, Flight School) applies the correct
// admission/success/honors mechanics, awards the right skills, sets
// commissions and auto-enlistment pathways, and ages the character on
// failure per the MT Players' Manual p. 47.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";

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

/** Exact level of a skill (not the array index that checkSkill returns).
 *  Returns -1 if the skill is absent. */
function skillLevel(c: Character, skill: string): number {
  return c.skills.find(([n]) => n === skill)?.[1] ?? -1;
}

describe("doPreCareer: College", () => {
  it("max rolls → admitted + graduated + honors + commissioned (NOTC)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("college");
    expect(r.graduated).toBe(true);
    expect(r.honors).toBe(true);
    // OTC checked first; if successful, NOTC is skipped.
    expect(r.commissioned).toBe(true);
    expect(r.autoEnlistPathway).not.toBeNull();
  });

  it("min rolls → admission fails, character may proceed", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgCandidate(5);
    const r = c.doPreCareer("college");
    expect(r.graduated).toBe(false);
    expect(r.honors).toBe(false);
    expect(r.commissioned).toBe(false);
    expect(r.autoEnlistPathway).toBeNull();
  });

  it("Honors graduation awards a brownie point", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    expect(c.browniePoints).toBe(0);
    const r = c.doPreCareer("college");
    expect(r.honors).toBe(true);
    // 1 BP for graduation + 1 BP for honors.
    expect(c.browniePoints).toBeGreaterThanOrEqual(2);
  });

  it("Honors graduation raises Education to 10 or +1, whichever greater", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(8);
    c.attributes.education = 8;
    const r = c.doPreCareer("college");
    expect(r.honors).toBe(true);
    // After honors with Edu starting at 8, target is max(10, 9) = 10.
    expect(c.attributes.education).toBeGreaterThanOrEqual(10);
  });
});

describe("doPreCareer: Naval Academy", () => {
  it("max rolls → graduates with honors + auto-commission in Navy", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("navalAcademy");
    expect(r.graduated).toBe(true);
    expect(r.commissioned).toBe(true);
    expect(r.autoEnlistPathway).toBe("navy");
  });

  it("Graduates with max rolls receive Vacc Suit-1, Navigation-1, Engineering-1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("navalAcademy");
    // 4+ on 1D for each of Vacc Suit, Navigation, Engineering. With
    // forced-high Math.random the 1D = 6 so all pass at level 1.
    expect(skillLevel(c, "Vacc Suit")).toBe(1);
    expect(skillLevel(c, "Navigation")).toBe(1);
    expect(skillLevel(c, "Engineering")).toBe(1);
  });

  it("Rrev11: admission failure does NOT age — character tries another path", () => {
    // freshAcgCandidate(5) has Soc 5 → fails the new Soc 8+ gate too. Bump
    // social to 9 so admission roll itself fails (with mocked-low rolls).
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgCandidate(5);
    c.attributes.social = 9;
    const startAge = c.age;
    c.doPreCareer("navalAcademy");
    expect(c.age).toBe(startAge);
  });

  it("Rrev11: Soc 7 character cannot apply to Naval Academy (Soc 8+ gate)", () => {
    const c = freshAcgCandidate(7);
    c.attributes.social = 7;
    const r = c.doPreCareer("navalAcademy");
    expect(r.admitted).toBe(false);
    expect(r.notes.join(" ")).toMatch(/Social Standing 8\+/);
  });
});

describe("doPreCareer: Military Academy", () => {
  it("Graduates always receive Combat Rifleman (level 1 from automatic skills)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("militaryAcademy");
    expect(r.graduated).toBe(true);
    expect(skillLevel(c, "Combat Rifleman")).toBe(1);
    expect(r.autoEnlistPathway).toBe("mercenary");
  });

  it("Honors graduates may then attend Medical School and graduate it", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r1 = c.doPreCareer("militaryAcademy");
    expect(r1.honors).toBe(true);
    const r2 = c.doPreCareer("medicalSchool");
    // Medical school admission requires honors prereq — military academy
    // honors qualifies. With max rolls the admission + success rolls pass.
    expect(r2.admitted).toBe(true);
    expect(r2.graduated).toBe(true);
  });
});

describe("doPreCareer: Medical School", () => {
  it("Graduates receive Medical-3, Admin, +1 Education (after college honors)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    // Start with a lower Edu so the +1 from medical doesn't cap at 15.
    const c = freshAcgCandidate(9);
    c.doPreCareer("college");
    const startEdu = c.attributes.education;
    const r = c.doPreCareer("medicalSchool");
    expect(r.graduated).toBe(true);
    // Medical-3 is the automatic skill grant; honors adds another +1 for
    // Medical-4. With max rolls the character also makes honors here, so
    // assert "at least Medical-3" — the next test pins the honors case.
    expect(c.checkSkillLevel("Medical", 3)).toBe(true);
    expect(skillLevel(c, "Admin")).toBe(1);
    expect(c.attributes.education).toBe(Math.min(15, startEdu + 1));
  });

  it("Honors graduates add Medical + Computer skills (after college honors)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("college");
    const r = c.doPreCareer("medicalSchool");
    expect(r.honors).toBe(true);
    expect(skillLevel(c, "Computer")).toBe(1);
    expect(skillLevel(c, "Medical")).toBe(4);
  });

  it("Honors-gate (R5): rejects medical school without honors prereq", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("medicalSchool");
    expect(r.admitted).toBe(false);
    expect(r.graduated).toBe(false);
  });

  it("Medical graduates receive automatic O3 direct commission (R4)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("college");
    const r = c.doPreCareer("medicalSchool");
    expect(r.graduated).toBe(true);
    expect(r.commissioned).toBe(true);
    expect(c.acgState?.rankCode).toBe("O3");
  });
});

describe("doPreCareer: Flight School", () => {
  it("Naval Academy honors + Flight School (max rolls): Ship's Boat-1, Navigation-2, Pilot-3", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    // Flight School admission requires Naval Academy honors or commission;
    // run Naval Academy first to satisfy the prereq. Naval Academy grants
    // Navigation-1, Flight School adds another point.
    c.doPreCareer("navalAcademy");
    const r = c.doPreCareer("flightSchool");
    expect(r.graduated).toBe(true);
    expect(skillLevel(c, "Ship's Boat")).toBe(1);
    expect(skillLevel(c, "Navigation")).toBe(2);
    expect(skillLevel(c, "Pilot")).toBe(3); // 1D-3+max die roll → 3
  });
});

describe("doPreCareer: error cases", () => {
  it("throws when not in ACG mode", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    expect(() => c.doPreCareer("college")).toThrow(/ACG mode/);
  });
});

describe("Pre-career chain: College honors → Medical school", () => {
  it("Honors college graduate can attempt and complete Medical School", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const college = c.doPreCareer("college");
    expect(college.honors).toBe(true);
    const med = c.doPreCareer("medicalSchool");
    expect(med.graduated).toBe(true);
    expect(c.checkSkillLevel("Medical", 3)).toBe(true);
  });
});

describe("R2: pre-career graduates age correctly", () => {
  it("College graduate is age 22 (entered at 18, +4 years)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const startAge = c.age;
    c.doPreCareer("college");
    expect(c.age).toBe(startAge + 4);
  });

  it("Naval Academy graduate is age 22", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const startAge = c.age;
    const r = c.doPreCareer("navalAcademy");
    expect(r.graduated).toBe(true);
    expect(c.age).toBe(startAge + 4);
  });

  it("Military Academy graduate is age 22", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const startAge = c.age;
    const r = c.doPreCareer("militaryAcademy");
    expect(r.graduated).toBe(true);
    expect(c.age).toBe(startAge + 4);
  });

  it("Medical School graduate ages another 4 years to age 26", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("college"); // 18 → 22
    const ageBefore = c.age;
    const r = c.doPreCareer("medicalSchool");
    expect(r.graduated).toBe(true);
    expect(c.age).toBe(ageBefore + 4);
  });

  it("Flight School graduate ages 1 year (short specialty)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("navalAcademy");
    const ageBefore = c.age;
    const r = c.doPreCareer("flightSchool");
    expect(r.graduated).toBe(true);
    expect(c.age).toBe(ageBefore + 1);
  });
});

describe("R3: pre-career failure short-term outcomes (revised by Rrev11)", () => {
  it("Naval Academy SUCCESS failure (admitted, washed out): +1 year, drafted Navy, short term", () => {
    // Sequence: admission roll pass, success roll fail.
    // freshAcgCandidate constructor consumed 12 Math.random calls. Set the
    // mock after construction so the first calls are the admission.
    const c = freshAcgCandidate(8); // Soc 8 to pass the gate
    c.attributes.education = 12;
    const startAge = c.age;
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      if (call <= 2) return 0.999; // admission rolls high
      return 0;                    // success rolls low
    });
    const r = c.doPreCareer("navalAcademy");
    expect(r.admitted).toBe(true);
    expect(r.graduated).toBe(false);
    expect(c.age).toBe(startAge + 1);
    expect(c.acgState?.preCareerDraftedInto).toBe("navy");
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });

  it("Rrev11: Naval Academy ADMISSION failure: no aging, no draft", () => {
    const c = freshAcgCandidate(9); // Soc 9 → passes gate but rolls might fail
    const startAge = c.age;
    vi.spyOn(Math, "random").mockReturnValue(0); // admission rolls min → fail
    const r = c.doPreCareer("navalAcademy");
    expect(r.admitted).toBe(false);
    expect(c.age).toBe(startAge);
    expect(c.acgState?.preCareerDraftedInto).toBeFalsy();
    expect(c.acgState?.preCareerFirstTermShort).toBeFalsy();
  });

  it("Military Academy success failure: +1 year, drafted Army", () => {
    // Build the character first (constructor rolls attrs), then install
    // the mock so the call counter starts at the admission roll.
    const c = freshAcgCandidate(2);
    c.attributes.strength = 12; // pass admission DM
    c.attributes.social = 6;    // meet the Soc 6+ prereq gate
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => (i++ < 2 ? 0.999 : 0));
    const startAge = c.age;
    const r = c.doPreCareer("militaryAcademy");
    expect(r.admitted).toBe(true);
    expect(r.graduated).toBe(false);
    expect(c.age).toBe(startAge + 1);
    expect(c.acgState?.preCareerDraftedInto).toBe("army");
  });

  it("College failure: short term flag set, no draft (free enlistment)", () => {
    // Build the character first (constructor rolls attributes), THEN set the
    // mock so the call counter starts at the admission roll.
    const c = freshAcgCandidate(2);
    c.attributes.education = 12;
    c.attributes.intelligence = 2;
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      if (call === 1) return 0.5;   // admission die 1 → 4
      if (call === 2) return 0.999; // admission die 2 → 6, total 10 + DM+2 = 12 ≥ 9 pass
      return 0;                     // success and everything else low → fail
    });
    c.doPreCareer("college");
    expect(c.acgState?.preCareerDraftedInto).toBeFalsy();
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });
});

describe("R1: pre-career state preserved into beginAcg", () => {
  it("honorsGraduations survive beginAcg", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("college");
    const honorsBefore = [...(c.acgState?.honorsGraduations ?? [])];
    c.beginAcg("mercenary");
    expect(c.acgState?.honorsGraduations).toEqual(honorsBefore);
  });

  it("schoolsAttended survive beginAcg even without commission", () => {
    // Manually establish post-college non-commissioned state, then beginAcg.
    const c = freshAcgCandidate(7);
    c.acgState = {
      pathway: "mercenary", combatArm: "", branch: "", mos: "",
      rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, injuredThisYear: false, perYear: {},
      perTerm: { promotedThisTerm: false },
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: ["college"], decorations: [], browniePoints: 1,
      browniePointsSpent: 0, decorationDmStrategy: 0,
    };
    const schoolsBefore = [...(c.acgState?.schoolsAttended ?? [])];
    c.beginAcg("mercenary");
    expect(c.acgState?.schoolsAttended).toContain("college");
    expect(c.acgState?.schoolsAttended).toEqual(schoolsBefore);
  });

  it("brownie points from pre-career survive beginAcg", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("college");
    const bpBefore = c.acgState?.browniePoints ?? 0;
    expect(bpBefore).toBeGreaterThan(0);
    c.beginAcg("mercenary");
    expect(c.acgState?.browniePoints).toBe(bpBefore);
  });
});

describe("Rrev2: pre-career draft & short-term flags are consumed by beginAcg", () => {
  it("preCareerDraftedInto=navy overrides chosen pathway to navy", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "auto";
    c.acgState = {
      pathway: "mercenary", combatArm: "", branch: "", mos: "",
      rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, injuredThisYear: false, perYear: {},
      perTerm: { promotedThisTerm: false },
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      preCareerDraftedInto: "navy",
      preCareerFirstTermShort: true,
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    c.beginAcg("mercenary");
    expect(c.service).toBe("navy");
    expect(c.acgPathway).toBe("navy");
    expect(c.drafted).toBe(true);
    expect(c.acgState?.preCareerFirstTermShort).toBe(true);
  });

  it("preCareerDraftedInto=army overrides to mercenary/army", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "auto";
    c.acgState = {
      pathway: "navy", fleet: "imperialNavy", branch: "",
      rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, injuredThisYear: false, perYear: {},
      perTerm: { promotedThisTerm: false },
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      preCareerDraftedInto: "army",
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    c.beginAcg("navy");
    expect(c.service).toBe("army");
    expect(c.acgPathway).toBe("mercenary");
  });
});

describe("Rrev6: service is set even when beginAcg pathway queues a choice", () => {
  it("interactive Navy enlistment with pending choice still leaves service=navy", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "interactive";
    c.attributes.social = 9; // triggers navy branch choice
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    c.beginAcg("navy", { fleet: "imperialNavy" });
    // The branch choice may be pending, but service must already be set.
    expect(c.service).toBe("navy");
  });
});

describe("R5: honors gates", () => {
  it("Flight School rejects non-commissioned college honors graduates", () => {
    // Manually build state: college honors but no commission. Bypass dice.
    const c = freshAcgCandidate(12);
    c.acgState = {
      pathway: "mercenary", combatArm: "", branch: "", mos: "",
      rankCode: "E1", isOfficer: false, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, injuredThisYear: false, perYear: {},
      perTerm: { promotedThisTerm: false },
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: ["college"], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      honorsGraduations: ["college"],
    };
    const r = c.doPreCareer("flightSchool");
    expect(r.admitted).toBe(false);
    expect(r.notes.join(" ")).toMatch(/Flight School requires/);
  });

  it("Flight School admits Naval Academy graduates without honors", () => {
    // Manually build state: graduated Naval Academy, no honors.
    const c = freshAcgCandidate(12);
    c.acgState = {
      pathway: "mercenary", combatArm: "", branch: "", mos: "",
      rankCode: "O1", isOfficer: true, year: 1,
      currentAssignment: null, inCommand: false, justRetained: false,
      retainedAssignment: null, injuredThisYear: false, perYear: {},
      perTerm: { promotedThisTerm: false },
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: ["navalAcademy"], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      honorsGraduations: [],
      preCareerCommission: true,
    };
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const r = c.doPreCareer("flightSchool");
    expect(r.admitted).toBe(true);
  });
});
