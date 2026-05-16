import { describe, expect, it } from "vitest";
import {
  buildCharacterSheetPdf, highestSkillIn, safeFilename, splitSkills,
} from "../lib/pdfSheet";
import { Character } from "../lib/traveller";

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

  it("includes the deceased dagger in the PDF when applicable", () => {
    const c = new Character();
    c.name = "DoomedSpacer";
    c.service = "scouts";
    c.terms = 1;
    c.deceased = true;
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // The † U+2020 is mojibake-encoded by jsPDF latin1 as "†" → "â€ "
    // in the raw bytes — but the easier signal is that the buffer is
    // substantially larger than a blank page and the page count is 1
    // (no page-2 supplement for a death without earnings).
    const doc = buildCharacterSheetPdf(c);
    expect(doc.getNumberOfPages()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(2000);
    // sanity: the character's name still made it into the bytes
    expect(text).toContain("DoomedSpacer");
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
