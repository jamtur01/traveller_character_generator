// String/number formatting helpers shared across the sheet, the PDF, and the
// page UI.

import type { AttributeKey } from "./types";

export function numCommaSep(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
