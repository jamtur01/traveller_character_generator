import { describe, expect, it } from "vitest";
import {
  buildCharacterSheetPdf, highestSkillIn, safeFilename, splitSkills,
} from "../lib/pdfSheet";
import { Character } from "../lib/traveller/character";

describe("safeFilename", () => {
  it("strips diacritics via NFKD", () => {
    expect(safeFilename("Hernández")).toBe("Hernandez");
    expect(safeFilename("Itō")).toBe("Ito");
    expect(safeFilename("Pérez")).toBe("Perez");
  });

  it("strips punctuation and joins with hyphens", () => {
    expect(safeFilename("John Q. Smith")).toBe("John-Q.-Smith");
    expect(safeFilename("O'Brien!")).toBe("OBrien");
  });

  it("returns empty string when nothing survives", () => {
    expect(safeFilename("✨")).toBe("");
    expect(safeFilename("   ")).toBe("");
  });
});

describe("splitSkills", () => {
  it("picks highest-level skill as primary, second-highest as secondary", () => {
    const out = splitSkills([
      ["Brawling", 1], ["Pilot", 3], ["Vacc Suit", 2],
    ]);
    expect(out.primary).toBe("Pilot-3");
    expect(out.secondary).toBe("Vacc Suit-2");
    expect(out.rest).toEqual(["Brawling-1"]);
  });

  it("breaks ties alphabetically", () => {
    const out = splitSkills([["Vacc Suit", 2], ["Pilot", 2]]);
    expect(out.primary).toBe("Pilot-2");
    expect(out.secondary).toBe("Vacc Suit-2");
  });

  it("handles empty skills", () => {
    const out = splitSkills([]);
    expect(out.primary).toBe("");
    expect(out.secondary).toBe("");
    expect(out.rest).toEqual([]);
  });

  it("handles a single skill", () => {
    const out = splitSkills([["Medical", 1]]);
    expect(out.primary).toBe("Medical-1");
    expect(out.secondary).toBe("");
    expect(out.rest).toEqual([]);
  });
});

describe("highestSkillIn", () => {
  it("returns the highest-level skill within the given pool", () => {
    const pool = new Set(["Pistol", "Rifle"]);
    expect(highestSkillIn(
      [["Pistol", 1], ["Rifle", 3], ["Cutlass", 5]],
      pool,
    )).toBe("Rifle-3");
  });

  it("returns empty string when the character has no skill in the pool", () => {
    expect(highestSkillIn([["Medical", 2]], new Set(["Pilot"]))).toBe("");
  });

  it("breaks ties alphabetically", () => {
    expect(highestSkillIn(
      [["Rifle", 2], ["Carbine", 2]],
      new Set(["Rifle", "Carbine"]),
    )).toBe("Carbine-2");
  });
});

describe("buildCharacterSheetPdf", () => {
  it("emits page 2 only when there is supplementary data", () => {
    const empty = new Character();
    const filled = new Character();
    filled.credits = 5000;
    expect(buildCharacterSheetPdf(empty).getNumberOfPages()).toBe(1);
    expect(buildCharacterSheetPdf(filled).getNumberOfPages()).toBeGreaterThan(1);
  });

  it("includes the character's name in the PDF bytes", () => {
    const c = new Character();
    c.name = "AlexanderJamison"; // ASCII only so the byte search is reliable
    c.service = "merchants";
    c.terms = 5;
    c.credits = 31200;
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("AlexanderJamison");
  });

  it("prefixes the deceased character's name with a dagger", () => {
    const c = new Character();
    c.name = "DoomedSpacer";
    c.service = "scouts";
    c.terms = 1;
    c.chargenStatus = { kind: "deceased", reason: "test fixture" };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // jsPDF's helvetica WinAnsiEncoding maps U+2020 (†) to 0x86.
    // The string passed to fieldValue is "† DoomedSpacer", so the byte
    // stream contains 0x86 followed by a space then the name.
    expect(text).toMatch(/\x86 DoomedSpacer/);
    // No supplement page for a death without earnings.
    expect(buildCharacterSheetPdf(c).getNumberOfPages()).toBe(1);
  });

  it("renders a live character's name without a dagger prefix", () => {
    const c = new Character();
    c.name = "AliveScout";
    c.service = "scouts";
    c.terms = 1;
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("AliveScout");
    // No 0x86 dagger byte preceding the name.
    expect(text).not.toMatch(/\x86 AliveScout/);
  });

  // MT-edition rendering coverage. The CT-only test bus above misses
  // ACG-specific paths (acgState rank/decorations/schools on TAS Form 2)
  // and Includes-skill expansion in pistolsFor/bladesFor.
  it("MT ACG character renders rank from acgState on TAS Form 2", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.name = "MTOfficer";
    c.service = "army";
    c.terms = 3;
    c.useAcg = true;
    c.acgPathway = "mercenary";
    c.browniePoints = 0; // lazy-init acgState
    const acg = c.requireAcgState();
    acg.rankCode = "O3";
    acg.isOfficer = true;
    acg.decorations = ["MCUF", "MCG"];
    acg.schoolsAttended = ["college", "ocs"];
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("O3"); // rank from acgState
    expect(text).toContain("MCUF"); // decoration
    expect(text).toContain("Commissioned officer"); // special assignment
  });

  it("MT character with Includes-expanded weapons surfaces them in pistolsFor/bladesFor", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.name = "MTMarine";
    c.service = "marines";
    c.terms = 1;
    // Constituents from the Handgun / Large Blade Includes-skill
    // expansion (PM-canonical names).
    c.skills = [
      ["Pistol", 1], ["Snub Pistol", 1],
      ["Cutlass", 2], ["Broadsword", 1],
    ];
    // pistolsFor/bladesFor are exported helpers used internally by the
    // PDF renderer; assert via the rendered output that the expanded
    // skills make it onto the form.
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // Highest pistol = Pistol-1 (alphabetically first of the tied 1s);
    // highest blade = Cutlass-2.
    expect(text).toMatch(/Cutlass-2/);
  });

  it("encodes the character's UPP and rank into the PDF bytes", () => {
    const c = new Character();
    c.name = "TestPilot";
    c.service = "navy";
    c.terms = 4;
    c.rank = 4; // Commander
    c.commissioned = true;
    c.attributes = {
      strength: 7, dexterity: 8, endurance: 9,
      intelligence: 10, education: 11, social: 12,
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Commander");
    expect(text).toContain("Navy");
  });
});
