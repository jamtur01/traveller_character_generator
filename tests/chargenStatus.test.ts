// Direct coverage for the ChargenStatus state machine (#3) and the
// Character.requireAcgState() helper (#6). These behaviours are
// exercised indirectly by the broader suite but not asserted; without
// these tests a refactor that, e.g., splits "set status" from "log
// ev.endGeneration" could pass the existing assertions.

import { describe, expect, it } from "vitest";
import { Character } from "../lib/traveller/character";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import { runTermSteps } from "../lib/traveller/engine/runners/basic";

function freshChar(): Character {
  const c = new Character();
  c.showHistory = "verbose";
  c.editionId = "ct-classic";
  c.service = "navy";
  return c;
}

describe("ChargenStatus atomicity (#3)", () => {
  it("endChargenRetired sets status AND logs ev.endGeneration in one operation", () => {
    const c = freshChar();
    c.endChargenRetired("test reason");
    expect(c.chargenStatus.kind).toBe("retired");
    expect(c.events.some(
      (e) => e.kind === "endGeneration" && e.reason === "retired"
        && e.note === "test reason",
    )).toBe(true);
  });

  it("endChargenDeceased sets status AND logs ev.endGeneration", () => {
    const c = freshChar();
    c.endChargenDeceased("killed in action");
    expect(c.chargenStatus.kind).toBe("deceased");
    expect(c.events.some(
      (e) => e.kind === "endGeneration" && e.reason === "deceased"
        && e.note === "killed in action",
    )).toBe(true);
  });

  it("endChargenDischarged sets status='retired' but withPension=false", () => {
    const c = freshChar();
    c.endChargenDischarged();
    expect(c.chargenStatus.kind).toBe("retired");
    expect(c.chargenStatus).toMatchObject({ withPension: false });
    expect(c.retired).toBe(false);
  });

  it("endChargenRetired respects explicit withPension=false", () => {
    const c = freshChar();
    c.terms = 5;
    c.endChargenRetired("forced", false);
    expect(c.retired).toBe(false);
  });

  it("endChargenRetired defaults to isRetirementEligible()", () => {
    const c = freshChar();
    c.terms = 5; // CT navy eligible after term 5
    c.endChargenRetired("voluntary");
    expect(c.retired).toBe(true);
  });
});

describe("isChargenEnded covers exactly the terminal states (#3)", () => {
  it("returns true for deceased / retired / mustered", () => {
    const c = freshChar();
    c.chargenStatus = { kind: "deceased", reason: "x" };
    expect(c.isChargenEnded).toBe(true);
    c.chargenStatus = { kind: "retired", reason: "x", withPension: false };
    expect(c.isChargenEnded).toBe(true);
    c.chargenStatus = { kind: "mustered" };
    expect(c.isChargenEnded).toBe(true);
  });

  it("returns false for active / shortTerm / mandatoryReenlist", () => {
    const c = freshChar();
    c.chargenStatus = { kind: "active" };
    expect(c.isChargenEnded).toBe(false);
    c.chargenStatus = { kind: "shortTerm", reason: "injured" };
    expect(c.isChargenEnded).toBe(false);
    c.chargenStatus = { kind: "mandatoryReenlist" };
    expect(c.isChargenEnded).toBe(false);
  });
});

describe("runTermSteps halts on isChargenEnded but continues on shortTerm (#3)", () => {
  it("halts after status flips to retired mid-term", () => {
    const c = freshChar();
    c.terms = 1;
    c.endChargenRetired("disability"); // status → retired
    // runTermSteps should short-circuit; skillPoints stay at 0
    runTermSteps(c);
    expect(c.skillPoints).toBe(0);
  });

  it("shortTerm does NOT halt the runner — special-duty + skills still allocate (PM p. 16)", () => {
    const c = freshChar();
    c.attributes.endurance = 9;
    c.attributes.intelligence = 9;
    c.attributes.education = 9;
    c.terms = 1;
    c.enterShortTerm("injured");
    // Status is shortTerm, not isChargenEnded — allocateSkills should fire.
    runTermSteps(c);
    expect(c.skillPoints).toBeGreaterThan(0);
  });
});

describe("Character.requireAcgState (#6)", () => {
  it("throws a clear error for non-ACG characters", () => {
    const c = freshChar();
    expect(() => c.requireAcgState()).toThrow(/non-ACG/);
  });

  it("returns the typed AcgState when set", () => {
    const c = freshChar();
    c.acgState = freshAcgState("mercenary");
    const acg = c.requireAcgState();
    expect(acg.pathway).toBe("mercenary");
    expect(acg.rankCode).toBe("E1");
  });
});
