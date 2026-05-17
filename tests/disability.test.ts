// F2/F3: PM p. 16 disability conditions (lines 939-943) force muster-out.
// Thresholds are in data/editions/mt-megatraveller.json rules.disability.

import { describe, expect, it } from "vitest";
import { Character } from "../lib/traveller/character";

function makeMt(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 7, dexterity: 7, endurance: 7,
    intelligence: 7, education: 7, social: 7,
  };
  c.service = "army";
  c.activeDuty = true;
  c.terms = 5;
  c.showHistory = "none";
  return c;
}

describe("MT disability rule (F2/F3)", () => {
  it("age 66+ triggers disability", () => {
    const c = makeMt();
    c.age = 66;
    expect(c.isDisabled().disabled).toBe(true);
    expect(c.isDisabled().reasons.join(" ")).toMatch(/age/);
  });

  it("Strength = 1 triggers disability", () => {
    const c = makeMt();
    c.age = 40;
    c.attributes.strength = 1;
    expect(c.isDisabled().disabled).toBe(true);
    expect(c.isDisabled().reasons.join(" ")).toMatch(/strength/);
  });

  it("Dex = 1 triggers disability", () => {
    const c = makeMt();
    c.age = 40;
    c.attributes.dexterity = 1;
    expect(c.isDisabled().disabled).toBe(true);
  });

  it("End = 1 triggers disability", () => {
    const c = makeMt();
    c.age = 40;
    c.attributes.endurance = 1;
    expect(c.isDisabled().disabled).toBe(true);
  });

  it("sum of physicals ≤ 10 triggers disability", () => {
    const c = makeMt();
    c.age = 40;
    c.attributes.strength = 3;
    c.attributes.dexterity = 3;
    c.attributes.endurance = 4; // sum 10
    expect(c.isDisabled().disabled).toBe(true);
    expect(c.isDisabled().reasons.join(" ")).toMatch(/sum/);
  });

  it("sum of physicals 11 is NOT disabled", () => {
    const c = makeMt();
    c.age = 40;
    c.attributes.strength = 4;
    c.attributes.dexterity = 3;
    c.attributes.endurance = 4; // sum 11
    expect(c.isDisabled().disabled).toBe(false);
  });

  it("doReenlistmentStep forces muster on disability", () => {
    const c = makeMt();
    c.age = 66;
    c.activeDuty = true;
    c.doReenlistmentStep();
    expect(c.activeDuty).toBe(false);
    expect(c.history.some((h) => /disability/.test(h))).toBe(true);
  });

  it("disabled characters with 5+ terms still retire (cash DM)", () => {
    const c = makeMt();
    c.age = 66;
    c.terms = 6;
    c.doReenlistmentStep();
    expect(c.retired).toBe(true);
  });

  it("CT has no disability rule (no rules.disability block)", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.attributes.strength = 1;
    c.age = 80;
    expect(c.isDisabled().disabled).toBe(false);
  });
});
