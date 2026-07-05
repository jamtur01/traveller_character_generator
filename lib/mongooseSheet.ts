// Fill the official Mongoose Traveller 2022 character sheet (the fillable
// AcroForm PDF in public/mongoose-character-sheet.pdf) for a Mongoose-model
// character. jsPDF cannot fill an existing form, so this uses pdf-lib. The
// field names below come from the template's AcroForm (420 fields); the
// skill-layout sets mirror the sheet's printed skill grid, not a game rule.

import { PDFDocument, PDFName, PDFBool, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getEdition } from "@/lib/traveller/editions";
import { characteristicDm } from "@/lib/traveller/core";
import { numCommaSep, safeFilename, titleize, toWinAnsi } from "@/lib/traveller/formatting";
import { careerLabel, assignmentLabel, rankTitleFor } from "@/lib/traveller/engine/mongoose/labels";

/** Sheet skills laid out with three numbered specialty slots (`<Skill> N
 *  Modifier` + `<Skill> Specialism N`). Matches the printed skill grid. */
const NUMBERED_SKILLS: ReadonlySet<string> = new Set([
  "Animals", "Art", "Athletics", "Drive", "Electronics", "Engineer", "Flyer",
  "Gun Combat", "Gunner", "Heavy Weapons", "Language", "Melee", "Pilot",
  "Profession", "Science", "Seafarer", "Tactics",
]);

/** Sheet skills with a single `<Skill> Modifier` field (no specialty slots). */
const SIMPLE_SKILLS: ReadonlySet<string> = new Set([
  "Admin", "Advocate", "Astrogation", "Broker", "Carouse", "Deception",
  "Diplomat", "Explosives", "Gambler", "Investigate", "Jack-of-All-Trades",
  "Leadership", "Mechanic", "Medic", "Navigation", "Persuade", "Recon",
  "Stealth", "Steward", "Streetwise", "Survival", "Vacc Suit",
]);

/** Engine skill-name spellings that differ from the sheet's field names. */
const FIELD_NAME_OVERRIDE: Readonly<Record<string, string>> = {
  "Jack-of-all-Trades": "Jack-of-All-Trades",
};

/** Characteristic -> sheet field label (note the sheet uses "Intellect"). */
const CHAR_FIELDS: readonly (readonly [AttributeKey, string])[] = [
  ["strength", "Strength"], ["dexterity", "Dexterity"], ["endurance", "Endurance"],
  ["intelligence", "Intellect"], ["education", "Education"], ["social", "Social"],
];

/** Connection relation -> sheet field group name. */
const CONNECTION_LABEL: Readonly<Record<string, string>> = {
  ally: "Ally", contact: "Contact", rival: "Rival", enemy: "Enemy",
};

const MAX_CAREER_ROWS = 5;
const MAX_SKILL_SLOTS = 3;
const MAX_CONNECTION_ROWS = 6;
const MAX_EQUIPMENT_ROWS = 8;

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** Split "Gun Combat (slug)" -> { base: "Gun Combat", specialty: "slug" }. */
function parseSkill(name: string): { base: string; specialty: string | null } {
  const m = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return m
    ? { base: m[1]!.trim(), specialty: m[2]!.trim() }
    : { base: name.trim(), specialty: null };
}

/** Map the character's skills onto the sheet's skill grid, overflowing extras
 *  (unknown skills or a 4th specialty of one base) into the Skill/Ability list. */
function mapSkills(ch: Character, out: Record<string, string>): [string, number][] {
  const slotUsed: Record<string, number> = {};
  const overflow: [string, number][] = [];
  for (const [name, level] of ch.skills) {
    const { base, specialty } = parseSkill(name);
    const field = FIELD_NAME_OVERRIDE[base] ?? base;
    if (NUMBERED_SKILLS.has(field)) {
      const slot = (slotUsed[field] ?? 0) + 1;
      if (slot > MAX_SKILL_SLOTS) { overflow.push([name, level]); continue; }
      slotUsed[field] = slot;
      out[`${field} ${slot} Modifier`] = String(level);
      if (specialty) out[`${field} Specialism ${slot}`] = titleize(specialty);
    } else if (SIMPLE_SKILLS.has(field)) {
      out[`${field} Modifier`] = String(level);
    } else {
      overflow.push([name, level]);
    }
  }
  return overflow;
}

/** Extra skills that don't fit the named grid go in the generic list. */
function mapSkillOverflow(overflow: readonly [string, number][], out: Record<string, string>): void {
  overflow.slice(0, 11).forEach(([name, level], i) => {
    out[`Skill/Ability ${i + 1}`] = name;
    out[`Skill/Ability DM ${i + 1}`] = String(level);
  });
}

/** The five career-history rows: career, assignment (as notes), terms, rank title. */
function mapCareers(ch: Character, out: Record<string, string>): void {
  const history = ch.mongooseState?.history ?? [];
  history.slice(0, MAX_CAREER_ROWS).forEach((rec, i) => {
    const n = i + 1;
    out[`Career ${n}`] = careerLabel(ch, rec.career);
    out[`Career Notes ${n}`] = assignmentLabel(ch, rec.career, rec.assignment);
    out[`Career Term ${n}`] = String(rec.terms);
    const title = rankTitleFor(ch, rec.career, rec.assignment, rec.finalRank, rec.commissioned);
    if (title) out[`Career Rank ${n}`] = title;
  });
}

/** Turn a connection's engine source-note into a clean sheet note (the engine
 *  tracks no name — the player fills that in). */
function connectionNote(note: string): string {
  if (note === "muster benefit") return "Gained while mustering out";
  return note || "Gained during a career";
}

/** Allies / Contacts / Rivals / Enemies — every connection gets a visible row
 *  (clean source note; the player supplies the name). */
function mapConnections(ch: Character, out: Record<string, string>): void {
  const counts: Record<string, number> = {};
  for (const conn of ch.mongooseState?.connections ?? []) {
    const label = CONNECTION_LABEL[conn.relation];
    if (!label) continue;
    const n = (counts[conn.relation] ?? 0) + 1;
    counts[conn.relation] = n;
    if (n > MAX_CONNECTION_ROWS) continue;
    out[`${label} Notes ${n}`] = connectionNote(conn.note);
  }
}

/** Cash, pension, ship shares, and remaining benefits as equipment lines. */
function mapBenefits(ch: Character, out: Record<string, string>): void {
  out["Cash on Hand"] = numCommaSep(ch.credits);
  const shares: string[] = [];
  let equip = 0;
  for (const b of ch.benefits) {
    if (/pension/i.test(b)) {
      const m = b.match(/Cr\s*([\d,]+)/i);
      if (m) out["Annual Pension"] = m[1]!;
      continue;
    }
    if (/ship share/i.test(b)) { shares.push(b); continue; }
    equip += 1;
    if (equip <= MAX_EQUIPMENT_ROWS) out[`Equipment Type ${equip}`] = b;
  }
  if (shares.length > 0) out["Ship Shares"] = shares.join(", ");
}

/** A concise career outline for the History & Background box: one line per
 *  career (assignment, terms, final rank) plus a muster-out summary — an
 *  outline for the player to build on, not a step-by-step log. */
function historyBackground(ch: Character): string {
  const history = ch.mongooseState?.history ?? [];
  if (history.length === 0) return "";
  const lines = history.map((rec) => {
    const career = careerLabel(ch, rec.career);
    const asg = assignmentLabel(ch, rec.career, rec.assignment);
    const terms = `${rec.terms} term${rec.terms === 1 ? "" : "s"}`;
    const title = rankTitleFor(ch, rec.career, rec.assignment, rec.finalRank, rec.commissioned);
    return `${career} (${asg}) - ${terms}${title ? `, rose to ${title}` : ""}.`;
  });
  const spoils = ch.credits > 0 ? [`Cr${numCommaSep(ch.credits)}`] : [];
  spoils.push(...ch.benefits);
  if (spoils.length > 0) lines.push(`Mustered out with ${spoils.join(", ")}.`);
  return lines.join("\n");
}

/** Build the AcroForm text-field values for a Mongoose character. Pure: no PDF
 *  dependency, so the mapping is unit-testable on its own. */
export function mongooseSheetFields(ch: Character): Record<string, string> {
  const out: Record<string, string> = {};
  out["Name"] = ch.name;
  out["Age"] = String(ch.age);
  out["Species"] = "Human";
  const bands = getEdition(ch.editionId).data.mongoose!.characteristicDmBands;
  for (const [key, label] of CHAR_FIELDS) {
    out[label] = String(ch.attributes[key]);
    out[`${label} DM`] = signed(characteristicDm(ch.attributes[key], bands));
  }
  mapSkillOverflow(mapSkills(ch, out), out);
  mapCareers(ch, out);
  mapConnections(ch, out);
  mapBenefits(ch, out);
  const background = historyBackground(ch);
  if (background) out["History & Background"] = background;
  return out;
}

// Section-block styling sampled from the template: the gray section-header bar
// (#747174) with a right-end bevel, a green accent tab, and a pale-blue field
// box — matching the sheet's "HISTORY & BACKGROUND"-style blocks. pdf-lib has
// no Arial Narrow / Bebas Neue, so Helvetica stands in for the titles.
const HEADER_GRAY = rgb(0.455, 0.443, 0.455);
const FIELD_BLUE = rgb(0.906, 0.929, 0.965);
const ACCENT_GREEN = rgb(0.49, 0.7, 0.26);
const BOX_LINE = rgb(0.72, 0.72, 0.72);
const HISTORY_INK = rgb(0.12, 0.12, 0.12);
const HIST_MARGIN = 40;
const HIST_BAR_H = 26;
const HIST_BODY = 9;
const HIST_LINE = 12.5;

/** Wrap a line into pieces that fit maxW at the given font size. */
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const trial = cur ? `${cur} ${word}` : word;
    if (cur && font.widthOfTextAtSize(trial, size) > maxW) {
      out.push(cur);
      cur = word;
    } else {
      cur = trial;
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [""];
}

/** Add a history page styled like the sheet's section blocks: a pale-blue field
 *  box under a gray, right-beveled header bar with a green accent tab. Returns
 *  the page and the first body baseline. */
function addHistoryPage(
  pdf: PDFDocument, size: { width: number; height: number }, bold: PDFFont, cont: boolean,
): { page: PDFPage; top: number } {
  const page = pdf.addPage([size.width, size.height]);
  const innerW = size.width - HIST_MARGIN * 2;
  const barY = size.height - HIST_MARGIN - HIST_BAR_H;
  page.drawRectangle({
    x: HIST_MARGIN, y: HIST_MARGIN, width: innerW, height: barY - HIST_MARGIN,
    color: FIELD_BLUE, borderColor: BOX_LINE, borderWidth: 1,
  });
  page.drawSvgPath(`M 0 0 L ${innerW} 0 L ${innerW - 14} ${HIST_BAR_H} L 0 ${HIST_BAR_H} Z`, {
    x: HIST_MARGIN, y: barY + HIST_BAR_H, color: HEADER_GRAY,
  });
  page.drawRectangle({ x: HIST_MARGIN + 4, y: barY - 15, width: 5, height: 12, color: ACCENT_GREEN });
  page.drawText(cont ? "SERVICE HISTORY (CONTINUED)" : "SERVICE HISTORY", {
    x: HIST_MARGIN + 14, y: barY + 8, size: 13, font: bold, color: rgb(1, 1, 1),
  });
  return { page, top: barY - 16 };
}

/** Append the full service history on fresh landscape pages styled like the
 *  sheet's blocks — the CT/MT-style history detail the fillable sheet lacks. */
async function drawHistoryPages(pdf: PDFDocument, ch: Character): Promise<void> {
  const raw = ch.renderHistory("verbose");
  if (raw.length === 0) return;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = pdf.getPage(0).getSize();
  const maxW = size.width - HIST_MARGIN * 2 - 12;
  const lines = raw.flatMap((line) => wrapText(toWinAnsi(line), font, HIST_BODY, maxW));
  let cursor = addHistoryPage(pdf, size, bold, false);
  let y = cursor.top;
  for (const line of lines) {
    if (y < HIST_MARGIN + HIST_LINE) {
      cursor = addHistoryPage(pdf, size, bold, true);
      y = cursor.top;
    }
    cursor.page.drawText(line, { x: HIST_MARGIN + 6, y, size: HIST_BODY, font, color: HISTORY_INK });
    y -= HIST_LINE;
  }
}

/** Fill the fillable template bytes with a Mongoose character's data and return
 *  the saved PDF bytes. NeedAppearances is set (and pdf-lib appearance
 *  generation skipped) because the template has a rich-text field pdf-lib cannot
 *  regenerate; PDF viewers render the field values from NeedAppearances. */
export async function fillMongooseSheet(
  template: Uint8Array, ch: Character,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(template);
  const form = pdf.getForm();
  const valid = new Set(form.getFields().map((f) => f.getName()));
  for (const [name, value] of Object.entries(mongooseSheetFields(ch))) {
    if (!valid.has(name) || value === "") continue;
    const field = form.getTextField(name);
    if (value.includes("\n")) field.enableMultiline();
    field.setText(value);
  }
  await drawHistoryPages(pdf, ch);
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return pdf.save({ updateFieldAppearances: false });
}

/** Fetch the official template from /public, fill it, and trigger a download. */
export async function downloadMongooseSheet(ch: Character): Promise<void> {
  const res = await fetch("/mongoose-character-sheet.pdf");
  if (!res.ok) throw new Error(`Mongoose sheet template fetch failed: ${res.status}`);
  const template = new Uint8Array(await res.arrayBuffer());
  const filled = await fillMongooseSheet(template, ch);
  const blob = new Blob([filled as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(ch.name) || "traveller"}-mongoose-character.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
