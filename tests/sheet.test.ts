import { describe, expect, it } from "vitest";
import { formatCharacterSheet } from "../lib/traveller";
import { Character } from "../lib/traveller/character";

function jamison(): Character {
  // Reconstruct the TTB worked example (page 31).
  const c = new Character();
  c.showHistory = "none";
  c.attributes = {
    strength: 7, dexterity: 7, endurance: 9,
    intelligence: 12, education: 9, social: 9,
  };
  c.service = "merchants";
  c.name = "Alexander Jamison";
  c.gender = "male";
  c.age = 38;
  c.terms = 5;
  c.credits = 31200;
  c.rank = 5;
  c.commissioned = true;
  c.skills = [
    ["Dagger", 1], ["Cutlass", 1], ["Vacc Suit", 1], ["Pilot", 2],
    ["Body Pistol", 1], ["SMG", 1], ["Electronics", 3],
  ];
  c.benefits = ["Free Trader"];
  c.mortgage = 10;
  c.endedAsRetired = true;
  c.chargenStatus = { kind: "retired", reason: "test fixture" };
  return c;
}

describe("formatCharacterSheet — TTB Jamison", () => {
  it("renders the canonical first line with rank and age right-aligned", () => {
    const out = formatCharacterSheet(jamison());
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/Merchant Captain Alexander Jamison 779C99\s+Age 38/);
  });

  it("renders terms and credits on line 2", () => {
    const out = formatCharacterSheet(jamison());
    expect(out.split("\n")[1]).toMatch(/^5 terms\s+Cr31,200$/);
  });

  it("lists all seven Jamison skills (sorted, dash-level, period at end)", () => {
    const out = formatCharacterSheet(jamison());
    expect(out).toContain("Body Pistol-1");
    expect(out).toContain("Cutlass-1");
    expect(out).toContain("Dagger-1");
    expect(out).toContain("Electronics-3");
    expect(out).toContain("Pilot-2");
    expect(out).toContain("SMG-1");
    expect(out).toContain("Vacc Suit-1");
    // Sorted alphabetically — Body Pistol comes before Cutlass.
    const skillBlock = out.split("\n").slice(2).join("\n");
    expect(skillBlock.indexOf("Body Pistol-1")).toBeLessThan(
      skillBlock.indexOf("Cutlass-1"),
    );
  });

  it("renders the Free Trader benefit with Type A prefix and mortgage remaining", () => {
    const out = formatCharacterSheet(jamison());
    expect(out).toContain("Type A Free Trader (10 years of payments remaining)");
  });
});

describe("formatCharacterSheet — passages aggregate", () => {
  it("collapses repeated passages into 'N <type>'", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.name = "Test";
    c.benefits = ["High Passage", "High Passage", "Low Passage"];
    const out = formatCharacterSheet(c);
    expect(out).toContain("2 High Passage");
    expect(out).toContain("Low Passage.");
  });
});

describe("formatCharacterSheet — deceased characters", () => {
  it("marks deceased with †, hides cash, still lists skills + benefits", () => {
    const c = new Character();
    c.showHistory = "none";
    c.service = "navy";
    c.name = "Doomed Spacer";
    c.chargenStatus = { kind: "deceased", reason: "test fixture" };
    c.terms = 2;
    c.credits = 0;
    c.skills = [["Vacc Suit", 1]];
    c.benefits = ["Low Passage"];
    const out = formatCharacterSheet(c);
    expect(out).toMatch(/^† /);
    expect(out).not.toMatch(/Cr0/);
    // The character earned these — show them even though they died.
    expect(out).toContain("Vacc Suit-1");
    expect(out).toContain("Low Passage");
  });
});
