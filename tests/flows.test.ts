// Integration-style tests that exercise multi-step flows. Dice are mocked so
// the outcomes are deterministic.

import { afterEach, describe, expect, it, vi } from "vitest";
import { s } from "../lib/traveller";
import { Character } from "../lib/traveller/character";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Force Math.random() to a value that makes d6 = `v`. Caller must restore. */
function pinD6(v: number) {
  vi.spyOn(Math, "random").mockReturnValue((v - 1) / 6 + 0.0001);
}

/** Force 2d6 to a specific roll (mock each half of the roll separately). */
function pin2D6(a: number, b: number) {
  const values = [(a - 1) / 6 + 0.0001, (b - 1) / 6 + 0.0001];
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++ % values.length] ?? 0);
}

/** Queue specific d6 results for successive Math.random() calls. */
function pinRolls(...d6s: number[]) {
  const values = d6s.map((v) => (v - 1) / 6 + 0.0001);
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0);
}

describe("doEnlistment", () => {
  it("auto-enrolls Soc 10+ characters into Nobility when service is random", () => {
    const c = new Character();
    c.showHistory = "none";
    c.attributes.social = 11;
    const svc = c.doEnlistment("");
    expect(svc).toBe("nobles");
    expect(c.history.some((h) => h.includes("auto-enrolled"))).toBe(true);
  });

  it("auto-enrolls Soc 10+ when method explicitly 'random'", () => {
    const c = new Character();
    c.showHistory = "none";
    c.attributes.social = 15;
    expect(c.doEnlistment("random")).toBe("nobles");
  });

  it("does not auto-enroll Soc 9 into Nobility", () => {
    const c = new Character();
    c.showHistory = "none";
    c.attributes.social = 9;
    // Mock applied AFTER construction so the constructor's attribute rolls
    // aren't poisoned by our pinned values.
    pin2D6(6, 6); // any random service should succeed with a 12
    const svc = c.doEnlistment("random");
    expect(svc).not.toBe("nobles");
    vi.restoreAllMocks();
  });

  it("drafts on failed enlistment", () => {
    const c = new Character();
    c.showHistory = "none";
    c.attributes = {
      strength: 5, dexterity: 5, endurance: 5,
      intelligence: 5, education: 5, social: 5,
    };
    pin2D6(1, 1); // 2 on 2d6 fails Navy's 8+ throw
    c.doEnlistment("navy");
    expect(c.drafted).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("doServiceTermStep order", () => {
  it("rolls survival BEFORE commission/promotion (TTB checklist order)", () => {
    // Build the character WITHOUT a mock (so the constructor's dice consume
    // real Math.random), THEN pin specific rolls for the term step.
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 12, education: 12, social: 12,
    };
    // First 2d6 (survival) → 12. Second 2d6 (commission) → 2.
    // Under WRONG order: commission rolls 12 → passes, survival rolls 2+2=4 → dies.
    // Under TTB order: survival rolls 12 → passes, commission rolls 2+1=3 → fails.
    // The expected end state distinguishes the two orderings.
    pinRolls(6, 6, 1, 1);
    c.doServiceTermStep();
    expect(c.deceased).toBe(false);
    expect(c.commissioned).toBe(false);
    expect(c.rank).toBe(0);
    vi.restoreAllMocks();
  });

  it("dying short-circuits the rest of the term (no commission, no promotion)", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 1, education: 12, social: 12,
    };
    // Survival rolls 2 (no Intel DM at Int 1) → fails. If commission ran
    // first, the 12 in slots 3-4 would commission them before death.
    pinRolls(1, 1, 6, 6, 6, 6);
    c.doServiceTermStep();
    expect(c.deceased).toBe(true);
    expect(c.commissioned).toBe(false);
    expect(c.rank).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("doReenlistmentStep", () => {
  it("mandatory reenlist on roll 12 even past 7 terms", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.terms = 8;
    pin2D6(6, 6); // 12
    c.doReenlistmentStep();
    expect(c.activeDuty).toBe(true);
    expect(c.mandatoryReenlistment).toBe(true);
    expect(c.history.some((h) => h.includes("Mandatory reenlistment"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("clears mandatoryReenlistment when the next term is served", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.terms = 2;
    c.enterMandatoryReenlist();
    // Pin survival pass (12) and commission fail (2) so the term resolves.
    pinRolls(6, 6, 1, 1);
    c.doServiceTermStep();
    expect(c.mandatoryReenlistment).toBe(false);
    expect(c.terms).toBe(3);
    vi.restoreAllMocks();
  });

  it("retires at terms >= 7 with non-12 roll", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.terms = 7;
    pin2D6(3, 3); // 6
    c.doReenlistmentStep();
    expect(c.activeDuty).toBe(false);
    expect(c.retired).toBe(true);
    vi.restoreAllMocks();
  });

  it("bureaucrat inverse rule: low roll keeps them in service", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "bureaucrats";
    c.terms = 3;
    pin2D6(1, 1); // 2 — below the leave threshold of 3
    c.doReenlistmentStep();
    expect(c.activeDuty).toBe(true);
    expect(c.history.some((h) => h.includes("Held over"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("bureaucrat inverse rule: high roll releases them", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "bureaucrats";
    c.terms = 3;
    pin2D6(3, 3); // 6 — at or above the leave threshold of 3
    c.doReenlistmentStep();
    expect(c.activeDuty).toBe(false);
    expect(c.history.some((h) => h.includes("Released from service"))).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("cascade prefer-known", () => {
  it("returns a weapon the character already knows when one is in-pool", () => {
    const c = new Character();
    c.service = "marines";
    c.skills = [["Cutlass", 1]];
    // First call: this is the FIRST blade benefit, so cascade picks Cutlass
    // (preferring the known weapon) and records the +0 ownership. The skill
    // level stays at 1 because addSkill(name, 0) is a no-op level-wise.
    c.doBladeBenefit();
    expect(c.bladeBenefit).toBe("Cutlass");
    expect(c.skills.find(([n]) => n === "Cutlass")?.[1]).toBe(1);
    // Second call: bladeBenefit already set, this bumps skill by 1.
    c.doBladeBenefit();
    expect(c.skills.find(([n]) => n === "Cutlass")?.[1]).toBe(2);
  });
});

describe("musterCash bounds", () => {
  it("clamps row index past 7 down to row 7", () => {
    const c = new Character();
    c.service = "navy";
    pinD6(6); // d6=6 + dm=5 = 11 → clamps to 7
    c.musterOutCash(5);
    expect(c.credits).toBe(s.navy.musterCash[7]);
    vi.restoreAllMocks();
  });

  it("clamps row index below 1 up to row 1", () => {
    const c = new Character();
    c.service = "navy";
    pinD6(1); // d6=1 + dm=-5 = -4 → clamps to 1
    c.musterOutCash(-5);
    expect(c.credits).toBe(s.navy.musterCash[1]);
    vi.restoreAllMocks();
  });
});
