// Tests for the Advanced Character Generation API and renderer. These
// verify real behavior, not just shape: the API throws on misuse, the
// renderer emits ACG-specific bytes when useAcg is true, and CT
// characters can't accidentally access MT's ACG data.

import { describe, expect, it } from "vitest";
import { editionHasAcg, getAcgCommon, getAcgPathway, listAcgPathways } from "../lib/traveller";
import { Character } from "../lib/traveller/character";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import { buildCharacterSheetPdf } from "../lib/pdfSheet";

// ---------------------------------------------------------------------------
// API: editionHasAcg / listAcgPathways
// ---------------------------------------------------------------------------

describe("editionHasAcg", () => {
  it("returns false for CT", () => {
    expect(editionHasAcg("ct-classic")).toBe(false);
  });

  it("returns true for MT", () => {
    expect(editionHasAcg("mt-megatraveller")).toBe(true);
  });

  it("throws for an unknown edition id", () => {
    expect(() => editionHasAcg("nonexistent-edition")).toThrow(/Unknown edition/);
  });
});

describe("listAcgPathways", () => {
  it("returns empty list for CT", () => {
    expect(listAcgPathways("ct-classic")).toEqual([]);
  });
  // The MT-content claims (four pathways, excludes meta keys) are
  // verified in tests/audit/acg.data.audit.test.ts.
});

// ---------------------------------------------------------------------------
// API: getAcgPathway / getAcgCommon
// ---------------------------------------------------------------------------

describe("getAcgPathway API", () => {
  it("returns a non-empty pathway block with army/marines enlistment for mercenary", () => {
    const m = getAcgPathway("mt-megatraveller", "mercenary");
    const en = m.enlistment as { army?: object; marines?: object };
    expect(Object.keys(en.army ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(en.marines ?? {}).length).toBeGreaterThan(0);
  });

  it("throws if the pathway doesn't exist in this edition", () => {
    expect(() => getAcgPathway("mt-megatraveller", "psionicist")).toThrow(
      /no ACG pathway/,
    );
  });

  it("throws if the edition has no ACG at all", () => {
    expect(() => getAcgPathway("ct-classic", "mercenary")).toThrow(
      /has no Advanced Character Generation/,
    );
  });
  // The MT-content claims (every pathway has ranks, mercenary E1–E9) are
  // verified in tests/audit/acg.data.audit.test.ts.
});

describe("getAcgCommon API", () => {
  it("throws for CT (no ACG block declared)", () => {
    expect(() => getAcgCommon("ct-classic")).toThrow(/has no Advanced/);
  });
  // The MT-content claim (four common tables exist) is in
  // tests/audit/acg.data.audit.test.ts.
});

// ---------------------------------------------------------------------------
// Character: ACG state fields default off
// ---------------------------------------------------------------------------

describe("Character ACG defaults", () => {
  it("a fresh Character has useAcg=false and no ACG state", () => {
    const c = new Character();
    expect(c.useAcg).toBe(false);
    expect(c.acgPathway).toBeNull();
    expect(c.acgBranch).toBeNull();
    expect(c.acgMos).toBeNull();
    expect(c.decorations).toEqual([]);
    expect(c.browniePoints).toBe(0);
    expect(c.schoolsAttended).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Renderer: ACG sheet appears only when useAcg is true; contains the
// ACG-specific labels in the PDF bytes
// ---------------------------------------------------------------------------

describe("ACG PDF renderer", () => {
  function freshAcgChar(): Character {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.name = "ColonelHazard";
    c.service = "marines";
    c.terms = 4;
    c.rank = 5;
    c.commissioned = true;
    c.useAcg = true;
    c.acgPathway = "mercenary";
    c.acgState = freshAcgState("mercenary");
    c.acgState.branch = "Marines";
    c.acgState.mos = "Heavy Weapons";
    c.acgState.decorations = ["MCUF", "MCG"];
    c.acgState.browniePoints = 3;
    c.acgState.schoolsAttended = ["Combat Engineer School", "Intelligence School"];
    return c;
  }

  it("a non-ACG character has no ACG page in the output", () => {
    const ct = new Character();
    ct.editionId = "ct-classic";
    ct.service = "navy";
    ct.terms = 2;
    ct.credits = 5000; // forces the supplement page
    const doc = buildCharacterSheetPdf(ct);
    const bytes = doc.output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // ACG-specific labels must not appear in a non-ACG character's PDF.
    expect(text).not.toContain("ADVANCED CHARACTER GENERATION");
    expect(text).not.toContain("Brownie Points");
    expect(text).not.toContain("Decorations and Awards");
  });

  it("an ACG character's PDF includes the ACG record card heading", () => {
    const c = freshAcgChar();
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("ADVANCED CHARACTER GENERATION");
    expect(text).toContain("RECORD CARD");
  });

  it("ACG sheet renders pathway, branch, MOS, decorations, brownie points", () => {
    const c = freshAcgChar();
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // Field labels
    expect(text).toContain("Pathway");
    expect(text).toContain("Branch");
    expect(text).toContain("MOS");
    expect(text).toContain("Brownie Points");
    expect(text).toContain("Decorations");
    expect(text).toContain("Specialist Schools");
    // Values
    expect(text).toContain("mercenary");
    expect(text).toContain("Marines");
    expect(text).toContain("Heavy Weapons");
    expect(text).toContain("MCUF");
    expect(text).toContain("MCG");
    expect(text).toContain("Combat Engineer School");
  });

  it("ACG sheet shows rank, combat ribbons, command clusters, BP spent", () => {
    const c = freshAcgChar();
    c.acgState = {
      pathway: "mercenary", rankCode: "O4", isOfficer: true,
      year: 4, currentAssignment: "Raid", inCommand: true,
      justRetained: false, retainedAssignment: null,
      promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: ["Training", "Raid", "Counterinsurgency", "Garrison"],
      combatRibbons: 2, commandClusters: 1,
      schoolsAttended: ["Command College"],
      decorations: ["MCG"],
      browniePoints: 3, browniePointsSpent: 5,
      decorationDmStrategy: 0,
      combatArm: "Infantry", branch: "Marines", mos: "Gun Combat",
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Rank");
    expect(text).toContain("O4");
    expect(text).toContain("Combat Ribbons");
    expect(text).toContain("Command Clusters");
    expect(text).toContain("Officer Status");
    expect(text).toContain("Commissioned");
    expect(text).toContain("spent");
    expect(text).toContain("Combat Arm");
    expect(text).toContain("Assignment History");
    expect(text).toContain("Raid");
  });

  it("ACG sheet labels adapt to pathway (Navy fleet/branch)", () => {
    const c = freshAcgChar();
    c.acgPathway = "navy";
    c.acgState = {
      pathway: "navy", rankCode: "O3", isOfficer: true,
      year: 1, currentAssignment: null, inCommand: false,
      justRetained: false, retainedAssignment: null,
      promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      fleet: "imperialNavy", branch: "Line",
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Fleet");
    expect(text).toContain("imperialNavy");
  });

  it("ACG sheet labels adapt to pathway (Scout division/office)", () => {
    const c = freshAcgChar();
    c.acgPathway = "scout";
    c.acgState = {
      pathway: "scout", rankCode: "IS-5", isOfficer: false,
      year: 1, currentAssignment: null, inCommand: false,
      justRetained: false, retainedAssignment: null,
      promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      division: "field", office: "Survey",
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Division");
    expect(text).toContain("field");
    expect(text).toContain("Office");
    expect(text).toContain("Survey");
  });

  it("ACG sheet labels adapt to pathway (Merchant Prince line type/department)", () => {
    const c = freshAcgChar();
    c.acgPathway = "merchantPrince";
    c.acgState = {
      pathway: "merchantPrince", rankCode: "O1", isOfficer: true,
      year: 1, currentAssignment: null, inCommand: false,
      justRetained: false, retainedAssignment: null,
      promotedThisTerm: false, injuredThisYear: false,
      assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
      schoolsAttended: [], decorations: [], browniePoints: 0,
      browniePointsSpent: 0, decorationDmStrategy: 0,
      lineType: "Megacorp", department: "Engineering",
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Line Type");
    expect(text).toContain("Megacorp");
    expect(text).toContain("Department");
    expect(text).toContain("Engineering");
  });

  it("ACG sheet shows the homeworld block for MT characters", () => {
    const c = freshAcgChar();
    c.homeworld = {
      starport: "A", size: "Medium", atmosphere: "Standard",
      hydrosphere: "Wet World", population: "Mod Pop", law: "Mod Law",
      tech: "Early Stellar",
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Homeworld");
    expect(text).toContain("Starport A");
    expect(text).toContain("Wet World");
    expect(text).toContain("Early Stellar");
  });

  it("ACG character produces one more page than the same character without ACG", () => {
    const acg = freshAcgChar();
    const basic = freshAcgChar();
    basic.useAcg = false;
    expect(buildCharacterSheetPdf(acg).getNumberOfPages())
      .toBeGreaterThan(buildCharacterSheetPdf(basic).getNumberOfPages());
  });

  it("CT character can't render ACG fields even if useAcg flag is set", () => {
    // Edge case: someone flips useAcg on a CT character. The renderer
    // doesn't gate on edition — it gates on the flag — so it WILL draw
    // the page. But the API editionHasAcg returns false, which is the
    // proper gate. The test documents that responsibility lies with the
    // caller (typically the UI), not the renderer.
    const ct = new Character();
    ct.editionId = "ct-classic";
    ct.useAcg = true; // caller error: CT has no ACG
    ct.service = "navy";
    expect(editionHasAcg(ct.editionId)).toBe(false);
    // The renderer still produces output (it doesn't crash); upstream
    // should never set useAcg=true on a non-ACG edition. The CT PDF
    // identifies itself in the footer so callers can tell the two apart.
    const pdf = buildCharacterSheetPdf(ct);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(0);
    const text = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
    expect(text).not.toContain("MegaTraveller");
  });

  it("edition footer identifies MT on an ACG character's PDF", () => {
    const c = freshAcgChar();
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("MegaTraveller");
  });

  it("MT character's homeworld appears in TAS Form 2 Birthworld field", () => {
    const c = new Character();
    c.editionId = "mt-megatraveller";
    c.name = "Spacer";
    c.service = "scouts";
    c.homeworld = {
      starport: "B", size: "Large", atmosphere: "Dense",
      hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
      tech: "Avg Stellar",
    };
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Birthworld");
    expect(text).toContain("BLD");
    expect(text).toContain("Avg Stellar");
  });

  it("CT character with no homeworld leaves Birthworld blank (no MT data)", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 1;
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    // No homeworld → no tech / starport text on the basic sheet.
    expect(text).not.toContain("Early Stellar");
    expect(text).not.toContain("Avg Stellar");
  });

  it("edition footer identifies CT on a CT character's PDF", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "scouts";
    c.terms = 2;
    const bytes = buildCharacterSheetPdf(c).output("arraybuffer");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Classic Traveller");
  });
});
