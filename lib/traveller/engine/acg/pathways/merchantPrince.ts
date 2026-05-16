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
//     Officers attempt a once-per-term examination (start-of-term) against
//     the next rank's target in ranksAndPromotions, with the examDm carried
//     from Special Duty schools applied and reset.
//     Enlisted advance one rank automatically per 4-year term (manual p. 60:
//     "Enlisted personnel are promoted every four years").
//   - Reenlistment: 4+ (DM +1 if officer).

import type { Character } from "../../../character";
import { getEdition } from "../../../editions";
import { roll } from "../../../random";
import {
  applyDmRules, applyStructuredDms, labelToColumnKey,
  parseResolutionTarget, rollVsTarget,
  type StructuredDm,
} from "../tables";
import { awardBrownie } from "../awards";
import { tryMitigate } from "../browniePoints";
import { applyAcgSkillCell } from "./mercenary";

const PATHWAY = "merchantPrince";

interface MerchantData {
  enlistment: {
    columns: string[];
    rows: Array<{
      typeOfLine: string;
      minimumStarport: string;
      lineSize: "Large" | "Small" | null;
      target: string | number;
    }>;
    dms?: StructuredDm[];
  };
  departmentAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  availablePositions: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  specificAssignment: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: Array<string | StructuredDm>;
  }>;
  ranksAndPromotions: Record<string, { enlisted?: unknown[]; officer?: unknown[]; promotion?: Record<string, unknown> }>;
  skillTables: Record<string, { columns: string[]; rows: Array<Record<string, unknown>> }>;
  specialDuty: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  specialDutyResolution?: Record<string, {
    throw?: string;
    skills?: string[];
    effect?: string;
  }>;
  reenlistment: { target: number; dms: StructuredDm[] };
}

const ASSIGNMENT_COL_MAP: Record<string, string> = {
  "Route": "route",
  "Charter": "charter",
  "Exploratory Trade": "exploratory",
  "Speculative Trade": "speculative",
  "No Business": "route",
  "Smuggling": "speculative",
  "Piracy": "speculative",
};

function lineSizeFor(data: MerchantData, lineType: string): "Large" | "Small" | "FreeTrader" {
  const row = data.enlistment.rows.find((r) => r.typeOfLine === lineType);
  if (!row) return "Small";
  if (row.lineSize === null) return "FreeTrader";
  return row.lineSize;
}

function assignmentColumnFor(lineSize: "Large" | "Small" | "FreeTrader"): string {
  if (lineSize === "Large") return "largeLine";
  if (lineSize === "Small") return "smallLine";
  return "freeTrader";
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
    const dm = applyStructuredDms(data.enlistment.dms, ch);
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
  const size = lineSizeFor(data, ch.acgState!.lineType ?? "");
  if (size === "FreeTrader") {
    ch.acgState!.department = "Free Trader";
    return;
  }
  const lineCol = size === "Large" ? "largeMerchantLine" : "smallMerchantLine";
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
  const size = lineSizeFor(data, ch.acgState!.lineType ?? "");
  const lineCol = assignmentColumnFor(size);
  // DMs from JSON, filtered by column (largeLine/smallLine/freeTrader).
  const dm = (data.specificAssignment.dms ?? [])
    .filter((d) => !d.column || d.column === lineCol)
    .reduce((acc, d) => {
      const rest: StructuredDm = { ...d };
      delete rest.column;
      return acc + applyStructuredDms([rest], ch);
    }, 0);
  // Row 13 is reachable: a natural 12 plus a +1 DM hits 13. The
  // specificAssignment table includes rows for die ∈ [2,13]; do not truncate.
  const r = Math.max(2, Math.min(13, roll(2) + dm));
  const row = data.specificAssignment.rows.find((row) => row.die === r);
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
  // "Special" routes through the Special Duty table (manual p. 60-63).
  if (assignment === "Special") {
    merchantSpecialAssignment(ch);
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
  // Free Trader characters resolve against the freeTraderTrade table regardless
  // of department (Free Traders are a single-department service).
  const useFreeTraderTable = ch.acgState!.lineType === "Free Trader";
  const resolutionTable = useFreeTraderTable
    ? (data.assignmentResolution.freeTraderTrade ?? resTable)
    : resTable;
  const colKey = ASSIGNMENT_COL_MAP[assignment] ?? labelToColumnKey(assignment);
  if (!resolutionTable.columns.includes(colKey)) {
    ch.verboseHistory(`Merchant: assignment "${assignment}" → column "${colKey}" not in ${deptKey}`);
    return;
  }
  // The merchant resolution rows are Survival / Skills / Bonus (not the
  // standard Survival/Decoration/Promotion/Skills shape). Parse directly.
  const survRow = resolutionTable.rows.find((r) => String(r.result).toLowerCase() === "survival");
  const skillRow = resolutionTable.rows.find((r) => String(r.result).toLowerCase() === "skills");
  const bonusRow = resolutionTable.rows.find((r) => String(r.result).toLowerCase() === "bonus");

  const survDm = applyDmRules(resolutionTable.dms, ch, "survival");
  const skillDm = applyDmRules(resolutionTable.dms, ch, "skills");
  const bonusDm = applyDmRules(resolutionTable.dms, ch, "bonus");

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
  const size = lineSizeFor(data, ch.acgState!.lineType ?? "");
  if (size === "FreeTrader") return;
  const col = size === "Large" ? "largeLine" : "smallLine";
  const row = data.availablePositions.rows.find((r) => r.department === ch.acgState!.department);
  if (!row) return;
  const target = parseResolutionTarget(row[col]).target;
  const dm = applyStructuredDms(data.availablePositions.dms, ch);
  const r = roll(2);
  // Reset any prior temporary effective rank before evaluating this year.
  ch.acgState!.effectiveRankCode = null;
  if (typeof target === "number" && r + dm < target) {
    // No position available — serve one rank lower for this year's skill
    // column selection (manual p. 60). The permanent rank is unchanged.
    const m = ch.acgState!.rankCode.match(/^O(\d+)$/);
    if (m) {
      const cur = parseInt(m[1]!, 10);
      const lower = Math.max(0, cur - 1);
      ch.acgState!.effectiveRankCode = lower === 0 ? "O0" : `O${lower}`;
      ch.verboseHistory(
        `No ${ch.acgState!.department} position (roll ${r} + ${dm} vs ${target}+); ` +
        `serving as ${ch.acgState!.effectiveRankCode} this year.`,
      );
    } else {
      ch.verboseHistory(`No ${ch.acgState!.department} position; rank unchanged.`);
    }
  }
}

function merchantRollSkill(ch: Character): void {
  const data = dataFor(ch);
  const tables = Object.keys(data.skillTables);
  if (tables.length === 0) return;
  // Interactive: let the player pick the table. Auto: round-robin by year.
  if (ch.choiceMode === "interactive" && tables.length > 1) {
    ch.pickOrDefer({
      kind: "merchantSkillTable",
      label: "Merchant: choose which skill table to roll on this year.",
      options: tables,
      onResolve: (c, key) => merchantRollFromTable(c, key),
    });
    return;
  }
  const tableKey = tables[(ch.acgState!.year - 1) % tables.length]!;
  merchantRollFromTable(ch, tableKey);
}

function merchantRollFromTable(ch: Character, tableKey: string): void {
  const data = dataFor(ch);
  const table = data.skillTables[tableKey];
  if (!table) return;
  const r = roll(1);
  const row = table.rows.find((row) => row.die === r);
  if (!row) return;
  // Use the effective rank (temporary demotion) for column selection where
  // applicable; for now we simply take the first non-die column value, but
  // the rank-down setter is observable for future column-specific logic.
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
  // Bonus per manual p. 60: throw on the merchants Cash Mustering Out
  // table, receive half the amount. Uses the basic merchants service's
  // musterCash[] which is already the source-of-truth cash table.
  const merchants = ch.editionService("merchants" as never);
  if (!merchants) return;
  const idx = Math.min(7, Math.max(1, roll(1)));
  const fullAmount = merchants.musterCash[idx] ?? 0;
  const cash = Math.floor(fullAmount / 2);
  if (cash <= 0) return;
  ch.credits += cash;
  ch.musterLog.push(`Cr${cash} bonus (in-service)`);
  ch.verboseHistory(`Merchant bonus: Cr${cash} (half of Cr${fullAmount})`);
}

function transferMerchantLine(ch: Character, dir: "up" | "down"): void {
  const data = dataFor(ch);
  const order = data.enlistment.rows.map((r) => r.typeOfLine);
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
  const dm = applyStructuredDms(data.specialDuty.dms, ch);
  const r = Math.max(1, Math.min(7, roll(1) + dm));
  const row = data.specialDuty.rows.find((row) => row.die === r);
  if (!row) return;
  const col = ch.acgState!.isOfficer ? "officers" : "deckHands";
  const sa = row[col];
  if (typeof sa !== "string") return;
  ch.acgState!.schoolsAttended.push(sa);
  ch.history.push(`Merchant Special Duty: ${sa}`);
  awardBrownie(ch, 1, `Special Duty: ${sa}`);
  applyMerchantSpecialDutyResult(ch, sa);
}

function applyMerchantSpecialDutyResult(ch: Character, sa: string): void {
  const data = dataFor(ch);
  // Two terminal effects don't appear in specialDutyResolution: Commission
  // (grant rank O0 → enlisted becomes officer) and Department Test (allow
  // promotion examination this term).
  if (sa === "Commission") {
    if (!ch.acgState!.isOfficer) {
      ch.acgState!.isOfficer = true;
      ch.acgState!.rankCode = ch.acgState!.lineType === "Free Trader" ? "O1" : "O0";
      ch.commissioned = true;
      ch.history.push(`Commissioned to rank ${ch.acgState!.rankCode}.`);
    }
    return;
  }
  if (sa === "Department Test") {
    ch.acgState!.canTakeDeptTest = true;
    return;
  }
  const key = labelToColumnKey(sa);
  const res = data.specialDutyResolution?.[key];
  if (!res) return;
  if (res.throw && res.skills) {
    const tgt = parseInt(res.throw, 10);
    const awarded: string[] = [];
    for (const skill of res.skills) {
      if (roll(1) >= tgt) {
        ch.addSkill(skill, 1);
        awarded.push(skill);
      }
    }
    if (awarded.length > 0) ch.history.push(`${sa}: ${awarded.join(", ")}`);
  }
  // Department transfer effects (manual p. 60-61).
  if (res.effect) {
    const transfer = res.effect.match(/Transfer to (\w+)/i);
    if (transfer) {
      ch.acgState!.department = transfer[1]!;
      ch.history.push(`Transferred to ${transfer[1]} department.`);
    }
    if (/DM \+1 on (?:the )?exam/i.test(res.effect)) {
      ch.acgState!.examDm = (ch.acgState!.examDm ?? 0) + 1;
    }
  }
}

/** Retention is Navy-only in MT. Kept as a no-op for back-compat. */
export function merchantRetention(ch: Character, _assignment: string): void {
  if (ch.acgState) {
    ch.acgState.justRetained = false;
    ch.acgState.retainedAssignment = null;
  }
}

export function merchantReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const dm = applyStructuredDms(data.reenlistment.dms, ch);
  const r = roll(2);
  if (r === 12) {
    ch.mandatoryReenlistment = true;
    return true;
  }
  return r + dm >= data.reenlistment.target;
}

export function merchantStartOfTerm(ch: Character): void {
  // Enlisted ranks advance every 4 years (per manual p. 60).
  if (!ch.acgState!.isOfficer && ch.terms > 0) {
    const code = ch.acgState!.rankCode;
    const m = code.match(/^E(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      ch.acgState!.rankCode = `E${n + 1}`;
    }
    return;
  }
  // Officers: yearly promotion exam runs at start of term (manual p. 61).
  // Exam target is the next rank's exam throw from ranksAndPromotions data.
  attemptMerchantPromotionExam(ch);
  // Reset per-term examDm bonus.
  ch.acgState!.examDm = 0;
}

function attemptMerchantPromotionExam(ch: Character): void {
  const data = dataFor(ch);
  if (!ch.acgState!.isOfficer) return;
  // Need data for the officer rank ladder + targets.
  const officerLadder = data.ranksAndPromotions as Record<string, {
    officer?: Array<[string, string, string, string | null]>;
  }>;
  // ranksAndPromotions has per-line-type blocks; pick the line.
  const size = lineSizeFor(data, ch.acgState!.lineType ?? "");
  const key = size === "Large" ? "largeMerchantLine"
    : size === "Small" ? "smallMerchantLine" : "freeTraders";
  const ladder = officerLadder[key]?.officer;
  if (!Array.isArray(ladder)) return;
  const codes = ladder.map((r) => r[0]);
  const idx = codes.indexOf(ch.acgState!.rankCode);
  if (idx < 0 || idx >= codes.length - 1) return;
  const nextRow = ladder[idx + 1]!;
  const targetStr = nextRow[2];
  const target = parseInt(String(targetStr).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(target)) return;
  const penalty = ch.acgState!.nextPromotionPenalty ?? 0;
  const dm = (ch.acgState!.examDm ?? 0) + penalty;
  if (penalty < 0) ch.acgState!.nextPromotionPenalty = 0;
  const r = roll(2);
  ch.verboseHistory(
    `Merchant exam (rank ${codes[idx]}→${codes[idx + 1]}): ${r} + ${dm} vs ${target}+` +
    (penalty ? ` (reprimand penalty ${penalty})` : ""),
  );
  if (r + dm >= target) {
    ch.acgState!.rankCode = nextRow[0] as string;
    ch.history.push(`Promoted to ${nextRow[1]}.`);
    // Skill granted on promotion (column 3 in the ladder rows, when set).
    const skillGrant = nextRow[3];
    if (typeof skillGrant === "string") {
      const m = skillGrant.match(/^(.+?)-(\d+)$/);
      if (m) ch.addSkill(m[1]!, parseInt(m[2]!, 10));
    }
  }
}

/** Hook called by the engine just before mustering out. Free Trader
 *  Owner/Captains (rank O5+ in the Free Trader ladder) leave with a
 *  free trader ship as an automatic benefit (manual p. 61). */
export function merchantFinalizeMuster(ch: Character): void {
  if (!ch.acgState) return;
  if (ch.acgState.lineType !== "Free Trader") return;
  const m = ch.acgState.rankCode.match(/^O(\d+)$/);
  if (!m) return;
  const n = parseInt(m[1]!, 10);
  if (n < 5) return;
  if (ch.acgState.freeTraderShipEarned) return;
  ch.acgState.freeTraderShipEarned = true;
  ch.benefits.push("Free Trader");
  ch.musterLog.push("Free Trader ship (Owner/Captain)");
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
