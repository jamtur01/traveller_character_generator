// String/number formatting helpers shared across the sheet, the PDF, and the
// page UI.

import type { AttributeKey } from "./types";

export function numCommaSep(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Combining diacritical marks block (U+0300..U+036F). Built from a string
// literal with Unicode escapes so the regex is robust against editor
// normalization (a literal /[̀-ͯ]/ would break if anyone normalized the file).
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036F]", "g");

/** Sanitize a character name into a safe download filename stem. */
export function safeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-zA-Z0-9-_. ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function intToOrdinal(i: number): string {
  switch (i) {
    case 1: return "first";
    case 2: return "second";
    case 3: return "third";
    case 4: return "fourth";
    case 5: return "fifth";
    case 6: return "sixth";
    case 7: return "seventh";
    case 8: return "eighth";
    case 9: return "ninth";
    case 10: return "tenth";
    default: return i + "th";
  }
}

const EHEX = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

/** Extended hex (CT eHex notation) — skips I and O to avoid confusion. */
export function extendedHex(val: number): string {
  if (val < 0) return "0";
  if (val < EHEX.length) return EHEX[val]!;
  return "?";
}

/** Turn a bare engine id/key into a display label: split camelCase and
 *  snake/kebab boundaries, then capitalize each word ("freeTrader" ->
 *  "Free Trader", "serviceSkills" -> "Service Skills", "strength" ->
 *  "Strength"). Fallback for options that have no JSON displayName; prefer a
 *  declared displayName where one exists. */
export function titleize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function attrShort(k: AttributeKey): string {
  return ATTR_SHORT[k];
}

const ATTR_SHORT: Record<AttributeKey, string> = {
  strength: "Str",
  dexterity: "Dex",
  endurance: "End",
  intelligence: "Int",
  education: "Edu",
  social: "Soc",
};

// jsPDF's base-14 fonts and pdf-lib's StandardFonts use WinAnsi (CP1252). A
// character outside that set makes jsPDF encode the whole string as UTF-16
// (garbage on the sheet) and makes pdf-lib's drawText throw. Keep
// WinAnsi-encodable chars, fold the symbols the engine can emit to ASCII, and
// drop anything else so a stray glyph degrades gracefully.
const CP1252_HIGH: Record<number, true> = {
  0x20ac: true, 0x201a: true, 0x0192: true, 0x201e: true, 0x2026: true,
  0x2020: true, 0x2021: true, 0x02c6: true, 0x2030: true, 0x0160: true,
  0x2039: true, 0x0152: true, 0x017d: true, 0x2018: true, 0x2019: true,
  0x201c: true, 0x201d: true, 0x2022: true, 0x2013: true, 0x2014: true,
  0x02dc: true, 0x2122: true, 0x0161: true, 0x203a: true, 0x0153: true,
  0x017e: true, 0x0178: true,
};
const GLYPH_FOLD: Record<string, string> = {
  "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21d2": "=>",
  "\u2264": "<=", "\u2265": ">=", "\u2212": "-", "\u2208": " in ",
  "\u2248": "~", "\u2260": "!=",
};

/** Fold a string to WinAnsi (CP1252): keep encodable chars, map known symbols
 *  to ASCII, drop the rest, so PDF text renders instead of breaking. */
export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7e || (cp >= 0xa0 && cp <= 0xff) || CP1252_HIGH[cp]) {
      out += ch;
    } else {
      out += GLYPH_FOLD[ch] ?? "?";
    }
  }
  return out;
}
