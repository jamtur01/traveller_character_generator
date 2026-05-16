// Merchant Prince pathway. Per MT Players' Manual pp. 60-63.
//
// Merchant Prince has the most distinct structure of the four pathways:
//   - Enlistment chooses a line type (Megacorp / Sector-wide / Subsector-
//     wide / Interface / Fledgling / Free Trader). Larger lines have
//     stricter starport requirements.
//   - No initial training year.
//   - Department assignment (Purser/Sales/Engineering/Deck for large/small
//     lines; Free Trader characters are in the Free Trader department).
//   - Each year:
//     1. Specific assignment (Route/Charter/Speculative/Exploratory for
//        large/small/free trader; plus Smuggling/Piracy/No Business for
//        Free Trader). Roll can also yield Transfer Up/Down (line change).
//     2. Available Position check (officers only) — may demote to a
//        lower rank for the assignment.
//     3. Resolve: survival → skills → bonus (no decoration, no promotion
//        through assignment; promotions are tested separately).
//   - Promotions are tested by examination, not per-assignment rolls.
//     We simplify to: every 4-year term, enlisted advance by one rank;
//     officers test for promotion based on examination targets.
//   - Reenlistment: 4+ (DM +1 if officer).

import type { Character } from "../../../character";
import { getEdition } from "../../../editions";
import { roll } from "../../../random";
import {
  applyDmRules, labelToColumnKey, parseResolutionTarget, rollVsTarget,
} from "../tables";
import { awardBrownie } from "../awards";
import { tryMitigate } from "../browniePoints";
import { applyAcgSkillCell } from "./mercenary";

const PATHWAY = "merchantPrince";

interface MerchantData {
  enlistment: { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] };
  departmentAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  availablePositions: { columns: string[]; rows: Array<Record<string, unknown>> };
  specificAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  assignmentResolution: Record<string, { columns: string[]; rows: Array<Record<string, unknown>>; dms?: string[] }>;
  ranksAndPromotions: Record<string, { enlisted?: unknown[]; officer?: unknown[]; promotion?: Record<string, unknown> }>;
  skillTables: Record<string, { columns: string[]; rows: Array<Record<string, unknown>> }>;
  specialDuty: { columns: string[]; rows: Array<Record<string, unknown>> };
  specialDutyResolution?: Record<string, unknown>;
  reenlistment: { target: number; dms: string[] };
}

function dataFor(ch: Character): MerchantData {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) throw new Error("Merchant Prince pathway requires ACG data");
  return acg.merchantPrince as MerchantData;
}

export function merchantEnlist(
  ch: Character,
  lineType: string,
): void {
  const data = dataFor(ch);
  ch.acgState!.lineType = lineType;
  const row = data.enlistment.rows.find((r) => r.typeOfLine === lineType);
  if (!row) {
    throw new Error(`Unknown merchant line type "${lineType}"`);
  }
  const parsed = parseResolutionTarget(row.target);
  if (parsed.target === "auto") {
    ch.history.push(`Automatic enlistment with ${lineType}.`);
  } else if (typeof parsed.target === "number") {
    let dm = 0;
    // DMs from JSON.dms: "If Str 7+, DM +1. If Int 6+, DM +2"
    if (ch.attributes.strength >= 7) dm += 1;
    if (ch.attributes.intelligence >= 6) dm += 2;
    const r = roll(2);
    ch.verboseHistory(`Merchant enlist (${lineType}): ${r} + ${dm} vs ${parsed.target}`);
    if (r + dm < parsed.target) {
      throw new Error(`Merchant enlistment failed (${r + dm} vs ${parsed.target})`);
    }
    ch.history.push(`Enlisted in ${lineType} merchant line.`);
  }
  ch.acgState!.rankCode = "E1";
  ch.acgState!.isOfficer = false;

  // Department assignment.
  merchantAssignDepartment(ch);
}

function merchantAssignDepartment(ch: Character): void {
  const data = dataFor(ch);
  const lineCol = ch.acgState!.lineType === "Free Trader"
    ? null
    : (["Megacorp", "Sector-wide", "Subsector-wide"].includes(ch.acgState!.lineType ?? ""))
      ? "largeMerchantLine" : "smallMerchantLine";
  if (lineCol === null) {
    ch.acgState!.department = "Free Trader";
    return;
  }
  const r = roll(1);
  const row = data.departmentAssignment.rows.find((row) => row.die === r);
  if (!row) { ch.acgState!.department = "Purser"; return; }
  ch.acgState!.department = String(row[lineCol] ?? "Purser");
  ch.verboseHistory(`Merchant department: ${ch.acgState!.department}`);
}

export function merchantRollAssignment(ch: Character): string {
  const data = dataFor(ch);
  if (ch.acgState!.justRetained && ch.acgState!.retainedAssignment) {
    const retained = ch.acgState!.retainedAssignment;
    ch.acgState!.justRetained = false;
    ch.acgState!.retainedAssignment = null;
    return retained;
  }
  const lineCol = ch.acgState!.lineType === "Free Trader" ? "freeTrader"
    : (["Megacorp", "Sector-wide", "Subsector-wide"].includes(ch.acgState!.lineType ?? ""))
      ? "largeLine" : "smallLine";
  let dm = 0;
  // DMs: If Edu 6-, DM -1; rank O4+, DM +1. Free Trader: If SOC5-, DM +1.
  if (ch.attributes.education <= 6) dm -= 1;
  if (ch.acgState!.isOfficer && ch.acgState!.rankCode.startsWith("O") &&
      parseInt(ch.acgState!.rankCode.replace("O", ""), 10) >= 4) dm += 1;
  if (lineCol === "freeTrader" && ch.attributes.social <= 5) dm += 1;
  const r = Math.max(2, Math.min(13, roll(2) + dm));
  const dieKey = r > 12 ? 12 : r;
  const row = data.specificAssignment.rows.find((row) => row.die === dieKey);
  if (!row) return "Route";
  return String(row[lineCol] ?? "Route");
}

export function merchantResolveAssignment(ch: Character, assignment: string): void {
  if (assignment === "Transfer Up") {
    transferMerchantLine(ch, "up");
    // Reroll specific assignment in the new line. Recurse once.
    const next = merchantRollAssignment(ch);
    if (next !== "Transfer Up" && next !== "Transfer Down") {
      merchantResolveAssignment(ch, next);
    }
    return;
  }
  if (assignment === "Transfer Down") {
    transferMerchantLine(ch, "down");
    const next = merchantRollAssignment(ch);
    if (next !== "Transfer Up" && next !== "Transfer Down") {
      merchantResolveAssignment(ch, next);
    }
    return;
  }
  // Available Position check (officers only).
  if (ch.acgState!.isOfficer) {
    merchantCheckAvailablePosition(ch);
  }

  const data = dataFor(ch);
  const deptKey = labelToColumnKey(ch.acgState!.department ?? "Deck");
  const resTable = data.assignmentResolution[deptKey];
  if (!resTable) {
    ch.verboseHistory(`Merchant: no resolution sub-table for department ${ch.acgState!.department}`);
    return;
  }
  const colKey = labelToColumnKey(assignment);
  if (!resTable.columns.includes(colKey)) {
    ch.verboseHistory(`Merchant: assignment "${assignment}" not in resolution columns of ${deptKey}`);
    return;
  }
  // The merchant resolution rows are Survival / Skills / Bonus (not the
  // standard Survival/Decoration/Promotion/Skills shape). Parse directly.
  const survRow = resTable.rows.find((r) => String(r.result).toLowerCase() === "survival");
  const skillRow = resTable.rows.find((r) => String(r.result).toLowerCase() === "skills");
  const bonusRow = resTable.rows.find((r) => String(r.result).toLowerCase() === "bonus");

  const survDm = applyDmRules(resTable.dms, ch, "survival");
  const skillDm = applyDmRules(resTable.dms, ch, "skills");
  const bonusDm = applyDmRules(resTable.dms, ch, "bonus");

  if (survRow) {
    const target = parseResolutionTarget(survRow[colKey]).target;
    const sv = rollVsTarget(target, survDm);
    ch.verboseHistory(`Merchant ${assignment} survival: ${sv.roll} + ${survDm} vs ${target}`);
    if (!sv.success) {
      const mit = tryMitigate(ch, {
        rollName: "survival",
        rollValue: sv.roll,
        dm: survDm,
        target: typeof target === "number" ? target : 0,
        margin: sv.margin,
        consequence: "Mustered out of merchant service",
      });
      if (mit.newMargin < 0) {
        ch.history.push("Failed survival; mustered out of merchant service.");
        ch.activeDuty = false;
        return;
      }
    }
  }
  if (skillRow) {
    const target = parseResolutionTarget(skillRow[colKey]).target;
    const sk = rollVsTarget(target, skillDm);
    if (sk.success) merchantRollSkill(ch);
  }
  if (bonusRow) {
    const target = parseResolutionTarget(bonusRow[colKey]).target;
    const bn = rollVsTarget(target, bonusDm);
    if (bn.success) merchantAwardBonus(ch);
  }

  ch.acgState!.assignmentHistory.push(assignment);
}

function merchantCheckAvailablePosition(ch: Character): void {
  const data = dataFor(ch);
  const isLarge = ["Megacorp", "Sector-wide", "Subsector-wide"]
    .includes(ch.acgState!.lineType ?? "");
  const col = ch.acgState!.lineType === "Free Trader"
    ? null
    : (isLarge ? "largeLine" : "smallLine");
  if (col === null) return;
  const row = data.availablePositions.rows.find((r) => r.department === ch.acgState!.department);
  if (!row) return;
  const target = parseResolutionTarget(row[col]).target;
  let dm = 0;
  if (ch.attributes.intelligence >= 9) dm += 1;
  if (ch.attributes.education >= 9) dm += 1;
  const r = roll(2);
  if (typeof target === "number" && r + dm < target) {
    // No position available — serve one rank lower for this assignment.
    ch.verboseHistory(`No ${ch.acgState!.department} position; serving one rank lower.`);
    // We don't permanently demote — this affects only this year's skill
    // table selection. For now we record it in verboseHistory.
  }
}

function merchantRollSkill(ch: Character): void {
  const data = dataFor(ch);
  // Pick a column from skillTables (service/department/life — player choice).
  // Simplification: round-robin between them based on year.
  const tables = Object.keys(data.skillTables);
  const tableKey = tables[(ch.acgState!.year - 1) % tables.length]!;
  const table = data.skillTables[tableKey]!;
  const r = roll(1);
  const row = table.rows.find((row) => row.die === r);
  if (!row) return;
  // Take the first non-die column value.
  for (const col of table.columns) {
    if (col === "die") continue;
    const v = row[col];
    if (typeof v === "string") {
      applyAcgSkillCell(ch, v);
      return;
    }
  }
}

function merchantAwardBonus(ch: Character): void {
  // Bonus: one throw on the Cash Mustering Out table, receive half the
  // amount shown. We use the basic service's musterCash for the
  // character's department-equivalent service.
  const cash = Math.max(0, roll(1) - 1) * 5000; // crude approximation
  ch.credits += cash;
  ch.musterLog.push(`Cr${cash} bonus (in-service)`);
  ch.verboseHistory(`Merchant bonus: Cr${cash}`);
}

function transferMerchantLine(ch: Character, dir: "up" | "down"): void {
  const order = ["Megacorp", "Sector-wide", "Subsector-wide",
    "Interface", "Fledgling", "Free Trader"];
  const idx = order.indexOf(ch.acgState!.lineType ?? "");
  if (idx < 0) return;
  const newIdx = dir === "up"
    ? Math.max(0, idx - 1)
    : Math.min(order.length - 1, idx + 1);
  if (newIdx === idx) return;
  ch.acgState!.lineType = order[newIdx]!;
  ch.history.push(`Transferred ${dir} to ${order[newIdx]}.`);
}

export function merchantSpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  if (!data.specialDuty) return;
  const r = roll(1);
  const row = data.specialDuty.rows.find((row) => row.die === r);
  if (!row) return;
  const col = ch.acgState!.isOfficer ? "officers" : "deckHands";
  const sa = row[col];
  if (typeof sa !== "string") return;
  ch.acgState!.schoolsAttended.push(sa);
  ch.history.push(`Merchant Special Duty: ${sa}`);
  awardBrownie(ch, 1, `Special Duty: ${sa}`);
}

export function merchantRetention(ch: Character, assignment: string): void {
  if (ch.acgState!.justRetained) {
    ch.acgState!.justRetained = false;
    return;
  }
  // Manual: no explicit retention rule for merchants. We use the same
  // 1D=6 rule as the other pathways for consistency.
  const r = roll(1);
  if (r === 6 && assignment !== "Transfer Up" && assignment !== "Transfer Down") {
    ch.acgState!.retainedAssignment = assignment;
    ch.acgState!.justRetained = true;
  } else {
    ch.acgState!.retainedAssignment = null;
  }
}

export function merchantReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  let dm = 0;
  if (ch.acgState!.isOfficer) dm += 1;
  const r = roll(2);
  if (r === 12) {
    ch.mandatoryReenlistment = true;
    return true;
  }
  return r + dm >= data.reenlistment.target;
}

export function merchantStartOfTerm(ch: Character): void {
  // Enlisted ranks advance every 4 years (per manual).
  if (!ch.acgState!.isOfficer && ch.terms > 0) {
    const code = ch.acgState!.rankCode;
    const m = code.match(/^E(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      ch.acgState!.rankCode = `E${n + 1}`;
    }
  }
}

export function getMerchantPrincePathway() {
  return {
    pathway: PATHWAY,
    enlist: merchantEnlist,
    rollAssignment: merchantRollAssignment,
    resolveAssignment: merchantResolveAssignment,
    specialAssignment: merchantSpecialAssignment,
    retention: merchantRetention,
    reenlist: merchantReenlist,
    startOfTerm: merchantStartOfTerm,
  };
}
