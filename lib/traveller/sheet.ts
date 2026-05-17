// Single source of truth for character sheet text formatting + ship type
// rendering + benefit aggregation. Used by `Character.toString`, the PDF
// renderer, and the React UI.

import { numCommaSep } from "./formatting";
import type { Character } from "./character";
import { getEdition } from "./editions";

const SHEET_WIDTH = 60;

function padBetween(left: string, right: string, width: number): string {
  if (!right) return left;
  const gap = Math.max(2, width - left.length - right.length);
  return left + " ".repeat(gap) + right;
}

function wrapList(items: string[], width: number, indent = ""): string {
  if (items.length === 0) return "";
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < items.length; i++) {
    const piece = items[i] + (i === items.length - 1 ? "." : ", ");
    const candidate = current === "" ? indent + piece : current + piece;
    if (candidate.length > width && current !== "") {
      lines.push(current.trimEnd());
      current = indent + piece;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines.join("\n");
}

/** Canonical ship-type display name for a benefit string, sourced from
 *  the edition's benefitDetails[name].displayName. Falls back to the
 *  raw benefit string if no override is declared. Free Trader gets
 *  mortgage status appended. */
export function formatBenefit(b: string, ch: Character): string {
  const details = (getEdition(ch.editionId).data as {
    benefitDetails?: Record<string, { displayName?: string; firstReceiptMortgageYears?: number }>;
  }).benefitDetails;
  const entry = details?.[b];
  if (!entry) return b;
  const display = entry.displayName ?? b;
  // Mortgage suffix for any ship whose entry declares
  // firstReceiptMortgageYears (Free Trader, Far Trader, Fat Trader,
  // Seeker, Yacht, Lab Ship, Safari Ship in MT).
  if (entry.firstReceiptMortgageYears) {
    if (ch.mortgage === 0) return `${display} (paid off)`;
    if (ch.mortgage === entry.firstReceiptMortgageYears) {
      return `${display} (new with a ${entry.firstReceiptMortgageYears}-year mortgage)`;
    }
    return `${display} (${ch.mortgage} years of payments remaining)`;
  }
  return display;
}

/** Aggregate repeat benefits TTB-style (e.g., "2 High Passage"). */
export function aggregateBenefits(ch: Character): string[] {
  const counts = new Map<string, number>();
  for (const b of ch.benefits) counts.set(b, (counts.get(b) ?? 0) + 1);
  return [...counts.keys()].sort().map((b) => {
    const n = counts.get(b)!;
    const label = formatBenefit(b, ch);
    return n > 1 ? `${n} ${label}` : label;
  });
}

/** The TTB-style canonical character sheet text (no service history). */
export function formatCharacterSheet(ch: Character): string {
  const def = ch.serviceDef();
  const memberPrefix = ch.service === "other" ? "" : def.memberName + " ";
  const rankPrefix = def.ranks[ch.rank] ? def.ranks[ch.rank] + " " : "";
  const titlePrefix = ch.attributes.social > 10 ? `${ch.getNobleTitle()} ` : "";
  const deceasedMark = ch.deceased ? "† " : "";

  const headerLeft = `${deceasedMark}${memberPrefix}${rankPrefix}${titlePrefix}${ch.name} ${ch.getAttrString()}`;
  const headerRight = `Age ${ch.age}`;
  const line1 = padBetween(headerLeft, headerRight, SHEET_WIDTH);

  const termsText = `${ch.terms} term${ch.terms === 1 ? "" : "s"}`;
  const cashText = ch.deceased ? "" : `Cr${numCommaSep(ch.credits)}`;
  const line2 = padBetween(termsText, cashText, SHEET_WIDTH);

  let out = `${line1}\n${line2}\n`;

  if (ch.skills.length > 0) {
    const items = ch.skills.map(([n, l]) => `${n}-${l}`).sort();
    out += wrapList(items, SHEET_WIDTH) + "\n";
  }
  if (ch.benefits.length > 0) {
    out += wrapList(aggregateBenefits(ch), SHEET_WIDTH) + "\n";
  }

  return out;
}
