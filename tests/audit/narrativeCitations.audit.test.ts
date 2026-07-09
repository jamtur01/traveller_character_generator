// Citation audit — every shipped narrative blurb carries an in-JSON citation.
//
// The label/narrative/blurb work (commits bc21a3e assignment narratives, 1f78320
// service/career blurbs) lifts prose verbatim from the rulebooks and logs it to
// history. A narrative with no sibling citation is either invented or drifted
// from the source — both silent corruptions of the character log. This audit
// reads the on-disk edition JSON directly (never through an accessor, so it pins
// the shipped data) and asserts EVERY narrative carries a non-empty citation
// that references a page number:
//
//   1. advancedCharacterGeneration.<pathway>.assignmentNarratives  (mt-megatraveller)
//        — object-level $rule / $comment sibling covers its entries.
//   2. services.*.description                                      (ct + mt)
//        — per-service $description sibling.
//   3. mongoose.careers.*.description                              (mongoose-2e)
//        — per-career $description sibling.
//   4. mongoose.careers.*.assignments[].description               (mongoose-2e)
//        — career-level $assignmentDescriptions sibling.
//
// Teeth: add a narrative with no citation, or blank a citation, and the
// matching row reddens. The count guards (>=12 CT services, >=13 mongoose
// careers) keep the audit from passing vacuously if the described set vanishes.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A citation is a non-empty string that names a source page (contains a
 *  digit), rejecting a blank or placeholder ("TODO") sibling. */
function isPageCitation(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0 && /\d/.test(v);
}

function loadEdition(id: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(__dirname, `../../data/editions/${id}.json`), "utf8"),
  );
  if (!isRecord(raw)) throw new Error(`edition ${id} JSON is not an object`);
  return raw;
}

const MT = loadEdition("mt-megatraveller");
const CT = loadEdition("ct-classic");
const MG = loadEdition("mongoose-2e");

// ---------------------------------------------------------------------------
// 1. MT ACG assignment narratives.
// ---------------------------------------------------------------------------

const ACG_PATHWAYS = ["mercenary", "navy", "scout", "merchantPrince"] as const;

function acgAssignmentNarratives(pathway: string): Record<string, unknown> {
  const acg = MT.advancedCharacterGeneration;
  if (!isRecord(acg)) throw new Error("mt advancedCharacterGeneration missing");
  const pw = acg[pathway];
  if (!isRecord(pw)) throw new Error(`mt acg.${pathway} missing`);
  const narr = pw.assignmentNarratives;
  if (!isRecord(narr)) throw new Error(`mt acg.${pathway}.assignmentNarratives missing`);
  return narr;
}

describe("assignmentNarratives carry a sibling citation (MT ACG)", () => {
  for (const pathway of ACG_PATHWAYS) {
    it(`acg.${pathway}.assignmentNarratives is cited ($rule/$comment with a page)`, () => {
      const narr = acgAssignmentNarratives(pathway);
      const cited = isPageCitation(narr.$rule) || isPageCitation(narr.$comment);
      expect(cited, `acg.${pathway}.assignmentNarratives needs a $rule/$comment page citation`)
        .toBe(true);
    });

    it(`every acg.${pathway}.assignmentNarratives entry is a narrative string`, () => {
      const narr = acgAssignmentNarratives(pathway);
      for (const [key, value] of Object.entries(narr)) {
        if (key.startsWith("$")) continue; // citation sibling, not a narrative
        expect(typeof value, `acg.${pathway}.assignmentNarratives["${key}"] must be a string`)
          .toBe("string");
        expect(String(value).trim().length).toBeGreaterThan(0);
      }
    });
  }

  it("the pathways that describe assignments (scout, merchant) actually ship entries", () => {
    // Non-vacuous guard: mercenary/navy are documented gaps (citation only),
    // but scout + merchant DO carry per-assignment narratives — if those
    // entries disappear this audit must not silently pass.
    const entryCount = (pathway: string): number =>
      Object.keys(acgAssignmentNarratives(pathway)).filter((k) => !k.startsWith("$")).length;
    expect(entryCount("scout")).toBeGreaterThan(0);
    expect(entryCount("merchantPrince")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Service descriptions (CT CotI services; MT has none — documented gap).
// ---------------------------------------------------------------------------

function describedServices(edition: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const services = edition.services;
  if (!isRecord(services)) throw new Error("edition.services missing");
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const [key, svc] of Object.entries(services)) {
    if (isRecord(svc) && svc.description !== undefined) out.push([key, svc]);
  }
  return out;
}

describe("service descriptions carry a sibling $description citation", () => {
  it("every CT service with a description is cited (CotI blurbs)", () => {
    const described = describedServices(CT);
    // CotI ships 12 described character types; the six TTB core services carry
    // none (documented gap). Guard the count so a data wipe can't pass vacuously.
    expect(described.length).toBeGreaterThanOrEqual(12);
    for (const [key, svc] of described) {
      expect(isPageCitation(svc.$description), `ct services.${key}.$description`)
        .toBe(true);
    }
  });

  it("MT services ship no per-service description (documented gap, not uncited data)", () => {
    // The lock is the inverse: MT deliberately carries NO service blurbs, so
    // there is nothing to leave uncited. If MT ever gains one it MUST be cited,
    // which the loop below enforces.
    for (const [key, svc] of describedServices(MT)) {
      expect(isPageCitation(svc.$description), `mt services.${key}.$description`)
        .toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Mongoose career + assignment descriptions.
// ---------------------------------------------------------------------------

function mongooseCareers(): Array<[string, Record<string, unknown>]> {
  const mongoose = MG.mongoose;
  if (!isRecord(mongoose)) throw new Error("mongoose block missing");
  const careers = mongoose.careers;
  if (!isRecord(careers)) throw new Error("mongoose.careers missing");
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const [key, career] of Object.entries(careers)) {
    if (isRecord(career)) out.push([key, career]);
  }
  return out;
}

describe("mongoose career descriptions carry a sibling $description citation", () => {
  it("every career with a description is cited", () => {
    const careers = mongooseCareers();
    let described = 0;
    for (const [key, career] of careers) {
      if (career.description === undefined) continue;
      described++;
      expect(isPageCitation(career.$description), `mongoose careers.${key}.$description`)
        .toBe(true);
    }
    // 13 shipped career intros (Core pp.22-45).
    expect(described).toBeGreaterThanOrEqual(13);
  });

  it("every career whose assignments carry descriptions has a $assignmentDescriptions citation", () => {
    let describedCareers = 0;
    for (const [key, career] of mongooseCareers()) {
      const assignments = career.assignments;
      if (!Array.isArray(assignments)) continue;
      const anyDescribed = assignments.some(
        (a) => isRecord(a) && a.description !== undefined,
      );
      if (!anyDescribed) continue;
      describedCareers++;
      expect(
        isPageCitation(career.$assignmentDescriptions),
        `mongoose careers.${key}.$assignmentDescriptions`,
      ).toBe(true);
      // Each described assignment is a non-empty narrative string.
      for (const a of assignments) {
        if (!isRecord(a) || a.description === undefined) continue;
        expect(typeof a.description).toBe("string");
        expect(String(a.description).trim().length).toBeGreaterThan(0);
      }
    }
    expect(describedCareers).toBeGreaterThanOrEqual(13);
  });
});
