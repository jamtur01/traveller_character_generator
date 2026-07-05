import { describe, it, expect } from "vitest";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";
import { buildCharacterSheetPdf } from "@/lib/pdfSheet";
import { formatCharacterSheet } from "@/lib/traveller/sheet";

const ENLIST: EnlistOptions = {
  verbose: false, preferredService: "random", acgService: "army", acgCombatArm: "",
  acgFleet: "imperialNavy", acgDivision: "field", acgLineType: "", acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

function generate(seed: number): session.ChargenSnapshot {
  let s = session.startCareer({
    edition: "mongoose-2e", verbose: false, interactiveMode: false,
    supportsInteractive: false, useAcg: false, acgPathway: "", seed,
  });
  s = session.enlist(s, ENLIST);
  for (let i = 0; i < 3 && s.phase === "term"; i++) s = session.runTerm(s);
  if (s.phase === "term") s = session.attemptMusterOut(s);
  if (s.phase === "career") s = session.attemptMusterOut(s);
  return s;
}

describe("Mongoose character sheet + PDF", () => {
  it("renders the text sheet with decimal characteristics (no hex UPP, no crash)", () => {
    const c = generate(9876).character;
    const sheet = formatCharacterSheet(c);
    expect(sheet).toContain(c.name);
    expect(sheet).toMatch(/Age \d+/);
    // Decimal characteristics: the header ends with six space-separated numbers.
    const header = sheet.split("\n")[0]!;
    expect(header).toMatch(/(\d+ ){5}\d+/);
  });

  it("builds a valid PDF for a mongoose character without crashing", () => {
    const c = generate(9876).character;
    const doc = buildCharacterSheetPdf(c);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("Character.toString() works for a mongoose character", () => {
    const c = generate(4242).character;
    expect(() => c.toString()).not.toThrow();
    expect(c.toString()).toContain(c.name);
  });
});
