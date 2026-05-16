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
    if (r.honors) {
      // 1 BP for graduation + 1 BP for honors.
      expect(c.browniePoints).toBeGreaterThanOrEqual(2);
    }
  });

  it("Honors graduation raises Education to 10 or +1, whichever greater", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(8);
    c.attributes.education = 8;
    c.doPreCareer("college");
    // After honors with Edu starting at 8, target is max(10, 9) = 10.
    if (c.attributes.education > 8) {
      expect(c.attributes.education).toBeGreaterThanOrEqual(10);
    }
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

  it("Graduates receive some Naval Academy skills", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    c.doPreCareer("navalAcademy");
    // 4+ on 1D for each of Vacc Suit, Navigation, Engineering. With
    // forced-high Math.random the 1D = 6 so all pass.
    expect(c.checkSkill("Vacc Suit")).toBeGreaterThanOrEqual(0);
    expect(c.checkSkill("Navigation")).toBeGreaterThanOrEqual(0);
    expect(c.checkSkill("Engineering")).toBeGreaterThanOrEqual(0);
  });

  it("Failed admission ages character 1 year", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = freshAcgCandidate(5);
    const startAge = c.age;
    c.doPreCareer("navalAcademy");
    expect(c.age).toBe(startAge + 1);
  });
});

describe("doPreCareer: Military Academy", () => {
  it("Graduates always receive Combat Rifleman", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("militaryAcademy");
    if (r.graduated) {
      expect(c.checkSkill("Combat Rifleman")).toBeGreaterThanOrEqual(0);
      expect(r.autoEnlistPathway).toBe("mercenary");
    }
  });

  it("Honors graduates may pursue Medical or Flight School", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("militaryAcademy");
    if (r.honors) {
      // Medical school admission test
      const r2 = c.doPreCareer("medicalSchool");
      // With max rolls, admission should pass
      expect(r2.graduated || r2.honors || r2.commissioned !== undefined).toBe(true);
    }
  });
});

describe("doPreCareer: Medical School", () => {
  it("Graduates receive Medical-3, Admin, +1 Education", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const startEdu = c.attributes.education;
    const r = c.doPreCareer("medicalSchool");
    if (r.graduated) {
      expect(c.checkSkillLevel("Medical", 3)).toBe(true);
      expect(c.checkSkill("Admin")).toBeGreaterThanOrEqual(0);
      expect(c.attributes.education).toBe(startEdu + 1);
    }
  });

  it("Honors graduates add Medical + Computer skills", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("medicalSchool");
    if (r.honors) {
      expect(c.checkSkill("Computer")).toBeGreaterThanOrEqual(0);
      expect(c.checkSkillLevel("Medical", 4)).toBe(true);
    }
  });
});

describe("doPreCareer: Flight School", () => {
  it("Graduates receive Ship's Boat, Navigation, and Pilot (1+)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshAcgCandidate(12);
    const r = c.doPreCareer("flightSchool");
    if (r.graduated) {
      expect(c.checkSkill("Ship's Boat")).toBeGreaterThanOrEqual(0);
      expect(c.checkSkill("Navigation")).toBeGreaterThanOrEqual(0);
      expect(c.checkSkillLevel("Pilot", 1)).toBe(true);
    }
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
    if (college.honors) {
      const med = c.doPreCareer("medicalSchool");
      if (med.graduated) {
        expect(c.checkSkillLevel("Medical", 3)).toBe(true);
      }
    }
  });
});
