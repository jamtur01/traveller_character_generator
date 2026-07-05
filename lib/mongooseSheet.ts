// Fill the official Mongoose Traveller 2022 character sheet (the fillable
// AcroForm PDF in public/mongoose-character-sheet.pdf) for a Mongoose-model
// character. jsPDF cannot fill an existing form, so this uses pdf-lib. The
// field names below come from the template's AcroForm (420 fields); the
// skill-layout sets mirror the sheet's printed skill grid, not a game rule.

import { PDFDocument, PDFName, PDFBool } from "pdf-lib";
import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getEdition } from "@/lib/traveller/editions";
import { characteristicDm } from "@/lib/traveller/core";
import { numCommaSep, safeFilename } from "@/lib/traveller/formatting";
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
      if (specialty) out[`${field} Specialism ${slot}`] = specialty;
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

/** Allies / Contacts / Rivals / Enemies (note only; the engine tracks no name). */
function mapConnections(ch: Character, out: Record<string, string>): void {
  const counts: Record<string, number> = {};
  for (const conn of ch.mongooseState?.connections ?? []) {
    const label = CONNECTION_LABEL[conn.relation];
    if (!label) continue;
    const n = (counts[conn.relation] ?? 0) + 1;
    counts[conn.relation] = n;
    if (n > MAX_CONNECTION_ROWS) continue;
    if (conn.note) out[`${label} Notes ${n}`] = conn.note;
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
  return out;
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
    form.getTextField(name).setText(value);
  }
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
