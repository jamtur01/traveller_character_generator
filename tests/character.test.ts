import { describe, expect, it } from "vitest";
import { extendedHex } from "../lib/traveller";
import { Character, cloneCharacter } from "../lib/traveller/character";

describe("cloneCharacter", () => {
  it("produces a new top-level object that is still a Character", () => {
    const a = new Character();
    const b = cloneCharacter(a);
    expect(b).not.toBe(a);
    expect(b instanceof Character).toBe(true);
  });

  it("deep-copies attributes/skills/benefits/events/musterLog", () => {
    const a = new Character();
    a.skills = [["Pilot", 1]];
    a.benefits = ["High Passage"];
    a.events = [{ kind: "raw", level: "simple", text: "Enlisted" }];
    a.musterLog = ["Cr5,000 cash"];

    const b = cloneCharacter(a);
    b.attributes.strength = 99;
    b.skills.push(["Vacc Suit", 1]);
    b.benefits.push("Low Passage");
    b.events.push({ kind: "raw", level: "simple", text: "Another" });
    b.musterLog.push("Another");

    expect(a.attributes.strength).not.toBe(99);
    expect(a.skills).toHaveLength(1);
    expect(a.benefits).toHaveLength(1);
    expect(a.events).toHaveLength(1);
    expect(a.musterLog).toHaveLength(1);
  });

  it("copies all scalar Character state (rank, credits, ship, TAS, mortgage, etc.)", () => {
    const a = new Character();
    a.terms = 5;
    a.credits = 50000;
    a.rank = 4;
    a.commissioned = true;
    a.ship = true;
    a.TAS = true;
    a.mortgage = 20;
    a.retired = true;
    a.retirementPay = 4000;
    a.bladeBenefit = "Cutlass";
    a.gunBenefit = "Revolver";

    const b = cloneCharacter(a);
    expect(b.terms).toBe(5);
    expect(b.credits).toBe(50000);
    expect(b.rank).toBe(4);
    expect(b.commissioned).toBe(true);
    expect(b.ship).toBe(true);
    expect(b.TAS).toBe(true);
    expect(b.mortgage).toBe(20);
    expect(b.retired).toBe(true);
    expect(b.retirementPay).toBe(4000);
    expect(b.bladeBenefit).toBe("Cutlass");
    expect(b.gunBenefit).toBe("Revolver");
  });
});

describe("addSkill", () => {
  it("adds a new skill at level 1 by default", () => {
    const c = new Character();
    c.addSkill("Pilot");
    expect(c.skills).toContainEqual(["Pilot", 1]);
  });

  it("improves the level when the skill already exists", () => {
    const c = new Character();
    c.addSkill("Pilot");
    c.addSkill("Pilot");
    expect(c.skills.find(([n]) => n === "Pilot")?.[1]).toBe(2);
  });

  it("supports adding at level 0 (weapon-benefit ownership)", () => {
    const c = new Character();
    c.addSkill("Cutlass", 0);
    expect(c.skills).toContainEqual(["Cutlass", 0]);
  });
});

describe("improveAttribute", () => {
  it("increases by the given delta", () => {
    const c = new Character();
    c.attributes.strength = 5;
    c.improveAttribute("strength", 2);
    expect(c.attributes.strength).toBe(7);
  });

  it("clamps social standing to a minimum of 1", () => {
    const c = new Character();
    c.attributes.social = 1;
    c.improveAttribute("social", -5);
    expect(c.attributes.social).toBe(1);
  });

  it("clamps other attributes to a minimum of 0", () => {
    const c = new Character();
    c.attributes.strength = 1;
    c.improveAttribute("strength", -5);
    expect(c.attributes.strength).toBe(0);
  });
});

describe("extendedHex", () => {
  it("maps decimal 0-15 to canonical eHex", () => {
    const expected = "0123456789ABCDEF";
    for (let i = 0; i < expected.length; i++) {
      expect(extendedHex(i)).toBe(expected[i]);
    }
  });
  it("maps 16+ to G..Z skipping I and O", () => {
    expect(extendedHex(16)).toBe("G");
    expect(extendedHex(17)).toBe("H");
    expect(extendedHex(18)).toBe("J"); // no I
    expect(extendedHex(22)).toBe("N");
    expect(extendedHex(23)).toBe("P"); // no O
  });
  it("clamps negatives to '0' and overflows to '?'", () => {
    expect(extendedHex(-1)).toBe("0");
    expect(extendedHex(999)).toBe("?");
  });
});

describe("getNobleTitle", () => {
  it("returns nothing below Soc 11", () => {
    const c = new Character();
    c.attributes.social = 10;
    expect(c.getNobleTitle()).toBe("");
  });
  it("uses gendered titles at each social rank", () => {
    const c = new Character();
    c.gender = "female";
    c.attributes.social = 13;
    expect(c.getNobleTitle()).toBe("Marchioness");
    c.gender = "male";
    expect(c.getNobleTitle()).toBe("Marquis");
  });
});

describe("musterOutPay", () => {
  it("pays nothing for terms < 5", () => {
    const c = new Character();
    c.service = "navy";
    c.terms = 4;
    c.musterOutPay();
    expect(c.retirementPay).toBe(0);
    expect(c.benefits).toHaveLength(0);
  });

  it("pays Cr4,000/yr at 5 terms, Cr6,000 at 6, Cr12,000 at 9", () => {
    const table: [number, number][] = [
      [5, 4000], [6, 6000], [7, 8000], [8, 10000], [9, 12000],
    ];
    for (const [terms, pay] of table) {
      const c = new Character();
      c.service = "navy";
      c.terms = terms;
      c.musterOutPay();
      expect(c.retirementPay).toBe(pay);
    }
  });

  it("adds Cr2,000/yr per term beyond 9", () => {
    const c = new Character();
    c.service = "navy";
    c.terms = 12;
    c.musterOutPay();
    expect(c.retirementPay).toBe(18000); // 12000 + 3*2000
  });

  it("does not pay scouts or other-service characters", () => {
    for (const svc of ["scouts", "other"] as const) {
      const c = new Character();
      c.service = svc;
      c.terms = 7;
      c.musterOutPay();
      expect(c.retirementPay).toBe(0);
    }
  });
});
