// Teeth-tests for this session's Mongoose sheet + choice-UX work:
//   1. mongooseSheetFields — the pure AcroForm field mapping (DM signs, numbered
//      specialty split, simple-skill path, career-history rank-title resolution,
//      comma-grouped cash, pension parse, connection notes).
//   2. fillMongooseSheet — the official fillable PDF actually receives the values
//      (skipped when the copyrighted template is absent, e.g. in CI).
//   3. currentRankTitle / rankTitleFor — rank title resolved from FINISHED-career
//      history (career nulled at muster-out) and the rankless-career null case.
//   4. describeEffectBundle — chooseEffect option labels: decline, single, joined.
//   5. Choice progress counts — the interactive muster-benefit and per-term
//      skill-table prompts carry a { current, total } progress cursor, and the
//      muster options are the raw resolution values (unchanged by the display work).

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { Character } from "@/lib/traveller/character";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { mongooseSheetFields, fillMongooseSheet } from "@/lib/mongooseSheet";
import { currentRankTitle, rankTitleFor } from "@/lib/traveller/engine/mongoose/labels";
import { describeEffectBundle } from "@/lib/traveller/engine/mongoose/effects";
import type { MongooseEffect } from "@/lib/traveller/engine/mongoose/types";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions, ChargenSnapshot } from "@/lib/traveller/chargen/session";

const TEMPLATE = "public/mongoose-character-sheet.pdf";

const ENLIST: EnlistOptions = {
  verbose: false, preferredService: "random", acgService: "army", acgCombatArm: "",
  acgFleet: "imperialNavy", acgDivision: "field", acgLineType: "", acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

/** A finished Mongoose character with a spread of skill shapes, a career-history
 *  record (career nulled at muster-out, as the engine leaves it), a pension
 *  benefit, and one connection — the mapping's whole surface in one fixture. */
function sheetChar(): Character {
  const c = new Character({
    attributes: {
      strength: 10, dexterity: 8, endurance: 7, intelligence: 12, education: 6, social: 4,
    },
  });
  c.editionId = "mongoose-2e";
  c.chargenModelId = "mongoose";
  c.age = 38;
  c.credits = 50000;
  c.mongooseState = freshMongooseState();
  c.mongooseState.history = [
    { career: "navy", assignment: "lineCrew", terms: 2, finalRank: 0, commissioned: false },
  ];
  c.mongooseState.connections = [{ relation: "ally", note: "war buddy" }];
  c.benefits = ["Pension Cr10000/year"];
  c.skills.push(["Gun Combat (slug)", 2]); // numbered specialty -> N Modifier + Specialism N
  c.skills.push(["Pilot", 1]);             // numbered, bare (no specialism)
  c.skills.push(["Admin", 1]);             // simple skill -> Modifier
  c.skills.push(["Jack-of-all-Trades", 0]); // engine spelling -> "Jack-of-All-Trades" field
  return c;
}

/** A fully-generated Mongoose character (non-interactive, seeded) — its event
 *  log is populated, which is what the appended SERVICE HISTORY page renders. */
function generatedChar(seed: number): Character {
  let snap = session.startCareer({
    edition: "mongoose-2e", verbose: false, interactiveMode: false,
    supportsInteractive: false, useAcg: false, acgPathway: "", seed,
  });
  snap = session.enlist(snap, ENLIST);
  for (let i = 0; i < 3 && snap.phase === "term"; i++) snap = session.runTerm(snap);
  if (snap.phase === "term") snap = session.attemptMusterOut(snap); // leave career
  if (snap.phase === "career") snap = session.attemptMusterOut(snap); // finish
  return snap.character;
}

// --- Group 1: mongooseSheetFields — the pure field mapping -------------------
describe("mongooseSheetFields maps a Mongoose character onto the sheet grid", () => {
  it("copies identity fields and the fixed species", () => {
    const c = sheetChar();
    const f = mongooseSheetFields(c);
    expect(f["Name"]).toBe(c.name);
    expect(f["Age"]).toBe("38"); // numeric age stringified into the text field
    expect(f["Species"]).toBe("Human");
  });

  it("emits signed characteristic DMs from the edition's DM bands", () => {
    const f = mongooseSheetFields(sheetChar());
    expect(f["Strength"]).toBe("10");
    expect(f["Strength DM"]).toBe("+1"); // 9-11 band -> +1
    expect(f["Intellect"]).toBe("12"); // sheet labels INT "Intellect"
    expect(f["Intellect DM"]).toBe("+2"); // 12-14 band -> +2
    expect(f["Social DM"]).toBe("-1"); // 3-5 band -> -1 (signed, not "1")
  });

  it("splits a numbered specialty into slot + specialism and keeps bare/simple skills apart", () => {
    const f = mongooseSheetFields(sheetChar());
    expect(f["Gun Combat 1 Modifier"]).toBe("2");
    expect(f["Gun Combat Specialism 1"]).toBe("Slug"); // engine lower-case specialty Title-cased
    expect(f["Pilot 1 Modifier"]).toBe("1"); // numbered but bare -> no specialism field
    expect(f["Pilot Specialism 1"]).toBeUndefined();
    expect(f["Admin Modifier"]).toBe("1"); // simple skill -> single Modifier field
    expect(f["Jack-of-All-Trades Modifier"]).toBe("0"); // engine spelling remapped, level 0 kept
  });

  it("resolves the career-history row incl. the rank-ladder title", () => {
    const f = mongooseSheetFields(sheetChar());
    expect(f["Career 1"]).toBe("Navy"); // career displayName
    expect(f["Career Notes 1"]).toBe("Line/Crew"); // assignment displayName
    expect(f["Career Term 1"]).toBe("2");
    expect(f["Career Rank 1"]).toBe("Crewman"); // navy enlisted rank 0 title
  });

  it("comma-groups cash, parses the pension, and records the connection note", () => {
    const f = mongooseSheetFields(sheetChar());
    expect(f["Cash on Hand"]).toBe("50,000");
    expect(f["Annual Pension"]).toBe("10000"); // parsed out of "Pension Cr10000/year"
    expect(f["Ally Notes 1"]).toBe("war buddy");
  });
});

// --- Group 2: fillMongooseSheet — the fillable PDF integration --------------
describe("fillMongooseSheet writes the values into the official AcroForm", () => {
  it.skipIf(!existsSync(TEMPLATE))(
    "fills the template and the reloaded form reads the character's data",
    async () => {
      const c = sheetChar();
      const bytes = new Uint8Array(await readFile(TEMPLATE));
      const out = await fillMongooseSheet(bytes, c);
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getFields().length).toBe(420);
      expect(form.getTextField("Name").getText()).toBe(c.name);
      expect(form.getTextField("Strength").getText()).toBe("10");
      expect(form.getTextField("Gun Combat 1 Modifier").getText()).toBe("2");
    },
  );
});

// --- Group 3: rank title from finished-career history ------------------------
describe("rank title resolves from finished-career history", () => {
  it("currentRankTitle reads history.at(-1) once the live career is nulled", () => {
    const c = sheetChar();
    c.mongooseState!.career = null; // muster-out state: career survives only in history
    expect(c.mongooseState!.career).toBeNull();
    expect(currentRankTitle(c)).toBe("Crewman");
  });

  it("rankTitleFor returns null for a rankless career/assignment rung", () => {
    // Drifter/Wanderer has no titled ranks (Core p.28) — the caller renders a
    // blank, never "Rank 0". A non-null here means an invented title.
    expect(rankTitleFor(sheetChar(), "drifter", "wanderer", 0, false)).toBeNull();
  });
});

// --- Group 4: describeEffectBundle — chooseEffect option labels --------------
describe("describeEffectBundle renders chooseEffect option labels", () => {
  it("an empty bundle is the decline branch", () => {
    expect(describeEffectBundle([])).toBe("Decline");
  });

  it("a single effect is described on its own", () => {
    const eff: readonly MongooseEffect[] = [{ kind: "gainSkill", skill: "Investigate", level: 1 }];
    expect(describeEffectBundle(eff)).toBe("Investigate 1");
  });

  it("a multi-effect bundle joins the describers with ' + '", () => {
    const eff: readonly MongooseEffect[] = [
      { kind: "gainSkill", skill: "Investigate", level: 1 },
      { kind: "modifyCharacteristic", characteristic: "endurance", delta: 1 },
    ];
    expect(describeEffectBundle(eff)).toBe("Investigate 1 + END +1");
  });
});

// --- Group 5: interactive choice progress counts ----------------------------
interface CapturedMuster {
  progress: { current: number; total: number };
  options: readonly string[];
}

/** Drive a seeded interactive Mongoose run one term deep, then voluntarily
 *  muster out, capturing the FIRST musterRoll benefit prompt and the first
 *  per-term skill-table prompt. Deterministic: the session re-executes off a
 *  seeded RNG, so no Math.random pinning is needed and nothing leaks. */
function driveToMuster(seed: number): { muster: CapturedMuster | null; skillTable: { current: number; total: number } | null } {
  let snap: ChargenSnapshot = session.startCareer({
    edition: "mongoose-2e", verbose: false, interactiveMode: true,
    supportsInteractive: true, useAcg: false, acgPathway: "", seed,
  });
  snap = session.enlist(snap, ENLIST);
  let muster: CapturedMuster | null = null;
  let skillTable: { current: number; total: number } | null = null;
  for (let guard = 0; guard < 400; guard++) {
    const c = snap.character;
    if (c.pendingChoices.length > 0) {
      const pc = c.pendingChoices[0]!;
      if (pc.kind === "musterRoll" && !muster && pc.progress) {
        muster = { progress: { ...pc.progress }, options: [...pc.options] as string[] };
      }
      if (pc.kind === "mongooseSkillTable" && !skillTable && pc.progress) {
        skillTable = { ...pc.progress };
      }
      snap = session.resolvePending(snap, pc.id, 0).snapshot;
      continue;
    }
    if (snap.phase === "end" || (muster && skillTable)) break;
    if (snap.phase === "term") {
      snap = c.terms >= 1 ? session.attemptMusterOut(snap) : session.runTerm(snap);
    } else if (snap.phase === "career") {
      snap = session.attemptMusterOut(snap);
    } else {
      snap = session.musterChoice(snap, "benefit");
    }
  }
  return { muster, skillTable };
}

describe("interactive choices carry a display progress cursor", () => {
  it("the muster-benefit prompt counts current/total and keeps the raw options", () => {
    const { muster } = driveToMuster(1);
    expect(muster, "seed 1 must reach a voluntary muster-benefit prompt").not.toBeNull();
    expect(muster!.progress.current).toBe(1); // first of the sequence
    expect(muster!.progress.total).toBeGreaterThanOrEqual(1);
    // Options are the raw resolution values, untouched by the display work.
    expect(muster!.options).toEqual(["Cash", "Material Benefits"]);
  });

  it("the per-term skill-table prompt carries a progress cursor", () => {
    const { skillTable } = driveToMuster(1);
    expect(skillTable, "seed 1 must reach a skill-table prompt").not.toBeNull();
    expect(skillTable!.current).toBe(1);
    expect(skillTable!.total).toBeGreaterThanOrEqual(1);
  });
});

// --- Group 6: round-2 sheet fidelity (specialty case, history box, page 3) ---
describe("round-2 sheet fidelity edits land on the sheet", () => {
  it("Title-cases a skill specialty on the sheet", () => {
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
      },
    });
    c.editionId = "mongoose-2e";
    c.chargenModelId = "mongoose";
    c.mongooseState = freshMongooseState();
    c.skills.push(["Melee (blade)", 1]); // engine stores the specialty lower-case
    const f = mongooseSheetFields(c);
    expect(f["Melee 1 Modifier"]).toBe("1");
    expect(f["Melee Specialism 1"]).toBe("Blade"); // Title-cased for the sheet, not "blade"
  });

  it("writes a career-outline line into the History & Background box", () => {
    const f = mongooseSheetFields(sheetChar());
    // "<Career> (<Assignment>) - <n> terms" for the navy/lineCrew, 2-term history.
    expect(f["History & Background"]).toMatch(/Navy \(Line\/Crew\) - 2 terms/);
  });

  it.skipIf(!existsSync(TEMPLATE))(
    "appends the SERVICE HISTORY page (reloaded PDF has >= 3 pages)",
    async () => {
      const c = generatedChar(9876); // a run with a populated event log
      const bytes = new Uint8Array(await readFile(TEMPLATE));
      const out = await fillMongooseSheet(bytes, c);
      const pdf = await PDFDocument.load(out);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3); // 2 template pages + history
    },
  );
});
