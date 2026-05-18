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
import { getEdition, getAcgPathway } from "../../../editions";
import { roll } from "../../../random";
import {
  applyDmRules, applyStructuredDms, labelToColumnKey,
  parseResolutionTarget,
  type StructuredDm,
} from "../tables";
import { awardBrownie } from "../awards";
import { tryMitigate } from "../browniePoints";
import { applyAcgSkillCell } from "./mercenary";
import {
  applyOnce, markComplete, resetIfComplete, rollPhaseDice,
} from "../subStepCache";
import { recordTransfer } from "../types";
import { attemptPreCareer, applyPreCareerResult } from "../preCareer";
import { event as ev } from "../../../history";

const PATHWAY = "merchantPrince";

interface MerchantData {
  /** PM p. 63 special-duty rules: Commission grants O0 (or rank-by-
   *  line-type), with a deadline to make O1 before reverting. Deck
   *  rank-O4 holders auto-transfer departments per PM p. 61. */
  specialRules?: {
    specialDutyCommission?: {
      defaultRank?: string;
      rankByLineType?: Record<string, string>;
      passO1DeadlineYears?: number;
      revertOnDeadlineToRank?: string;
    };
    deckAutoTransferAtRank?: {
      department: string;
      rankCode: string;
      destinationDepartment: string;
    };
    reducedPassage?: unknown;
    [k: string]: unknown;
  };
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

function assignmentColumnMap(ch: Character): Record<string, string> {
  return getEdition(ch.editionId).data.advancedCharacterGeneration
    ?.merchantPrince?.assignmentColumnMap ?? {};
}

interface FreeTraderFlags {
  skipBonus?: boolean;
  narrative?: string;
}
function freeTraderAssignmentFlags(ch: Character): Record<string, FreeTraderFlags> {
  const flags = getEdition(ch.editionId).data.advancedCharacterGeneration
    ?.merchantPrince?.freeTraderAssignmentFlags;
  return (flags as Record<string, FreeTraderFlags> | undefined) ?? {};
}

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

/** Starport ordering: edition JSON `homeworld.starportOrder` lists letters
 *  worst → best (X, E, ... A). */
function starportMeets(
  ch: Character, home: string | undefined, minimum: string,
): boolean {
  if (!home) return false;
  if (!minimum || minimum.toLowerCase() === "any") return true;
  const order = (getEdition(ch.editionId).data as {
    homeworld?: { starportOrder?: string[] };
  }).homeworld?.starportOrder ?? [];
  const have = order.indexOf(home.toUpperCase());
  const want = order.indexOf(minimum.toUpperCase());
  if (have < 0 || want < 0) return true;
  return have >= want;
}

export function merchantEnlist(
  ch: Character,
  lineType: string,
): void {
  const data = dataFor(ch);
  ch.requireAcgState().lineType = lineType;
  const row = data.enlistment.rows.find((r) => r.typeOfLine === lineType);
  if (!row) {
    throw new Error(`Unknown merchant line type "${lineType}"`);
  }
  // Starport restriction (PM p. 60): "If the character's homeworld has a
  // starport type less than that shown, the individual may not enlist in
  // that merchant line."
  if (row.minimumStarport && row.minimumStarport.toLowerCase() !== "any") {
    if (!starportMeets(ch, ch.homeworld?.starport, row.minimumStarport)) {
      throw new Error(
        `Merchant line "${lineType}" requires homeworld starport ${row.minimumStarport}+; ` +
        `this character's homeworld starport is ${ch.homeworld?.starport ?? "unset"}.`,
      );
    }
  }
  const parsed = parseResolutionTarget(row.target);
  if (parsed.target === "auto") {
    ch.log(ev.enlistmentAttempt(`Merchant ${lineType} (automatic)`, 0, 0, 0, true));
  } else if (typeof parsed.target === "number") {
    const dm = applyStructuredDms(data.enlistment.dms, ch);
    const r = roll(2);
    const succeeded = r + dm >= parsed.target;
    ch.log(ev.enlistmentAttempt(`Merchant ${lineType}`, r, dm, parsed.target, succeeded));
    if (!succeeded) {
      throw new Error(`Merchant enlistment failed (${r + dm} vs ${parsed.target})`);
    }
  }
  // Preserve pre-career commission rank (e.g. Medical School O3 entering
  // Merchants as Purser Department Medic per PM p. 47). Otherwise default
  // to E1 enlisted.
  if (!ch.requireAcgState().preCareerCommission) {
    ch.requireAcgState().rankCode = "E1";
    ch.requireAcgState().isOfficer = false;
  } else if (ch.requireAcgState().schoolsAttended.includes("medicalSchool")) {
    ch.requireAcgState().department = "Purser";
    ch.log(ev.enlistmentAttempt(
      `Merchants Purser Department Medic (medical school direct commission, ${ch.requireAcgState().rankCode})`,
      0, 0, 0, true,
    ));
  }

  // PM p. 47: Merchant Academy "may" be applied for after enlistment in
  // a Megacorporation or Sector-wide line. The choice is the player's,
  // not automatic. Interactive mode queues a yes/no choice; auto mode
  // skips the Academy unless ch.acgState.attemptMerchantAcademy was
  // pre-set by the UI/caller (defaults to false).
  if (lineType === "Megacorp" || lineType === "Sector-wide") {
    offerMerchantAcademy(ch);
  }

  // Department assignment (skipped if the Academy already set it on
  // honors — the Academy's applyMerchantDepartmentSkills records the
  // pick in acgState.department, and honors graduates "may select the
  // department to which he will be assigned" per the PM).
  if (!ch.requireAcgState().department) {
    merchantAssignDepartment(ch);
  }
}

function maybeAttemptMerchantAcademy(ch: Character): void {
  const result = attemptPreCareer(ch, "merchantAcademy");
  applyPreCareerResult(ch, "merchantAcademy", result);
}

function offerMerchantAcademy(ch: Character): void {
  // Caller may have pre-flagged the choice via acgState.attemptMerchantAcademy.
  const pre = ch.acgState?.attemptMerchantAcademy;
  if (pre === true) {
    maybeAttemptMerchantAcademy(ch);
    return;
  }
  if (pre === false) return; // explicit decline
  if (ch.choiceMode === "auto") return; // default: skip in auto mode
  ch.pickOrDefer({
    kind: "cascade",
    label: "Apply for Merchant Academy? (Megacorp/Sector-wide only)",
    options: ["Apply for Merchant Academy", "Skip — proceed to department assignment"],
    preferred: ["Skip — proceed to department assignment"],
    context: { source: "merchantAcademyOptIn" },
    onResolve: (c, chosen) => {
      if (chosen.startsWith("Apply")) {
        maybeAttemptMerchantAcademy(c);
      }
    },
  });
}

function merchantAssignDepartment(ch: Character): void {
  const data = dataFor(ch);
  const size = lineSizeFor(data, ch.requireAcgState().lineType ?? "");
  if (size === "FreeTrader") {
    ch.requireAcgState().department = "Free Trader";
    return;
  }
  const lineCol = size === "Large" ? "largeMerchantLine" : "smallMerchantLine";
  const r = roll(1);
  const row = data.departmentAssignment.rows.find((row) => row.die === r);
  if (!row) { ch.requireAcgState().department = "Purser"; return; }
  ch.requireAcgState().department = String(row[lineCol] ?? "Purser");
  // acgState.department is read by subsequent assignment / skill rolls.
}

export function merchantRollAssignment(ch: Character): string {
  const acg = ch.requireAcgState();
  const data = dataFor(ch);
  if (acg.justRetained && acg.retainedAssignment) {
    const retained = acg.retainedAssignment;
    acg.justRetained = false;
    acg.retainedAssignment = null;
    return retained;
  }
  const size = lineSizeFor(data, acg.lineType ?? "");
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
  // Reset per-year sub-step cache if a prior resolveAssignment ran to
  // completion (the runner clears at year boundary, but direct test
  // invocation can call us multiple times in the same notional year).
  resetIfComplete(ch);
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
  if (ch.requireAcgState().isOfficer) {
    merchantCheckAvailablePosition(ch);
  }

  const data = dataFor(ch);
  const deptKey = labelToColumnKey(ch.requireAcgState().department ?? "Deck");
  // Free Trader characters resolve against the freeTraderTrade table regardless
  // of department (Free Traders are a single-department service).
  const useFreeTraderTable = ch.requireAcgState().lineType === "Free Trader";
  const resTable = useFreeTraderTable
    ? data.assignmentResolution.freeTraderTrade
    : data.assignmentResolution[deptKey];
  if (!resTable) {
    throw new Error(
      `Merchant: no resolution sub-table for department ` +
      `"${ch.requireAcgState().department}" (key "${deptKey}", lineType: ` +
      `"${ch.requireAcgState().lineType}", edition: ${ch.editionId}).`,
    );
  }
  const resolutionTable = resTable;
  const colKey = assignmentColumnMap(ch)[assignment] ?? labelToColumnKey(assignment);
  if (!resolutionTable.columns.includes(colKey)) {
    throw new Error(
      `Merchant: assignment "${assignment}" → column "${colKey}" not in ` +
      `department "${deptKey}" (available: ${resolutionTable.columns.join(", ")}).`,
    );
  }
  // F14: Free Trader pursuit narrative + mechanical overrides.
  const freeTraderFlags = freeTraderAssignmentFlags(ch)[assignment];
  if (freeTraderFlags?.narrative) {
    ch.log(ev.raw(`${assignment}: ${freeTraderFlags.narrative}`, "verbose"));
  }
  const skipBonus = freeTraderFlags?.skipBonus === true;
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
    const sv = rollPhaseDice(ch, "survival", target, survDm);
    applyOnce(ch, "survivalLogged", () => {
      ch.log(ev.roll(
        "Survival", sv.roll, survDm,
        typeof target === "number" ? target : 0,
        sv.success, assignment,
      ));
    });
    if (!sv.success) {
      const mit = tryMitigate(ch, {
        rollName: "survival",
        rollValue: sv.roll,
        dm: survDm,
        target: typeof target === "number" ? target : 0,
        margin: sv.margin,
        consequence: "Mustered out of Merchant service",
        onMitigated: (c) => {
          c.resumeActive();
          c.log(ev.statusChange("revived", "BP spend saved Merchant survival"));
        },
      });
      if (mit.newMargin < 0) {
        applyOnce(ch, "survivalEndChargen", () => {
          ch.endChargenRetired("mustered out of Merchant service");
        });
        return;
      }
    }
  }
  if (skillRow) {
    const target = parseResolutionTarget(skillRow[colKey]).target;
    const sk = rollPhaseDice(ch, "skills", target, skillDm);
    let skMargin = sk.margin;
    if (!sk.success) {
      const mit = tryMitigate(ch, {
        rollName: "skills",
        rollValue: sk.roll, dm: skillDm,
        target: typeof target === "number" ? target : 0,
        margin: sk.margin,
        consequence: "Earn a skill this assignment",
      });
      skMargin = mit.newMargin;
    }
    if (skMargin >= 0) {
      applyOnce(ch, "skillsApplied", () => merchantRollSkill(ch));
    }
  }
  if (bonusRow && !skipBonus) {
    const target = parseResolutionTarget(bonusRow[colKey]).target;
    const bn = rollPhaseDice(ch, "bonus", target, bonusDm);
    // Bonus rolls are like decorations in merchant service. Use the
    // decoration policy (1 BP cap) to mitigate borderline misses.
    let bnMargin = bn.margin;
    if (!bn.success) {
      const mit = tryMitigate(ch, {
        rollName: "decoration",
        rollValue: bn.roll, dm: bonusDm,
        target: typeof target === "number" ? target : 0,
        margin: bn.margin,
        consequence: "Earn Merchant bonus",
      });
      bnMargin = mit.newMargin;
    }
    if (bnMargin >= 0) {
      applyOnce(ch, "bonusApplied", () => merchantAwardBonus(ch));
    }
  }

  applyOnce(ch, "assignmentHistoryRecorded", () => {
    const acg = ch.requireAcgState();
    acg.assignmentHistory.push(assignment);
    // PM p. 61: enlisted commission exam is available "if they are
    // serving on a Route assignment" — interpreted as having had Route
    // experience during the current term. Flag is consumed in
    // merchantEndOfTerm and reset at startOfTerm.
    if (assignment === "Route") acg.routeAssignmentThisTerm = true;
  });
  markComplete(ch);
}

function merchantCheckAvailablePosition(ch: Character): void {
  const data = dataFor(ch);
  const size = lineSizeFor(data, ch.requireAcgState().lineType ?? "");
  if (size === "FreeTrader") return;
  const col = size === "Large" ? "largeLine" : "smallLine";
  const row = data.availablePositions.rows.find((r) => r.department === ch.requireAcgState().department);
  if (!row) return;
  const target = parseResolutionTarget(row[col]).target;
  const dm = applyStructuredDms(data.availablePositions.dms, ch);
  const r = roll(2);
  // Reset any prior temporary effective rank before evaluating this year.
  ch.requireAcgState().effectiveRankCode = null;
  if (typeof target === "number" && r + dm < target) {
    // No position available — serve one rank lower for this year's skill
    // column selection (manual p. 60). The permanent rank is unchanged.
    const m = ch.requireAcgState().rankCode.match(/^O(\d+)$/);
    if (m) {
      const cur = parseInt(m[1]!, 10);
      const lower = Math.max(0, cur - 1);
      ch.requireAcgState().effectiveRankCode = lower === 0 ? "O0" : `O${lower}`;
    }
    // effectiveRankCode is observable; the failed position throw is reflected
    // implicitly by the absence of a Promotion event this year.
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
  const tableKey = tables[(ch.requireAcgState().year - 1) % tables.length]!;
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
      applyAcgSkillCell(ch, v, `Merchant ${tableKey} ${col}`);
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
  const rawRoll = Math.min(7, Math.max(1, roll(1)));
  const fullAmount = merchants.musterCash[rawRoll] ?? 0;
  const cash = Math.floor(fullAmount / 2);
  if (cash <= 0) return;
  ch.credits += cash;
  ch.musterLog.push(`Cr${cash} bonus (in-service)`);
  ch.log(ev.musterCash(cash, rawRoll, 0, "Merchant in-service bonus (half)"));
}

function transferMerchantLine(ch: Character, dir: "up" | "down"): void {
  const data = dataFor(ch);
  const order = data.enlistment.rows.map((r) => r.typeOfLine);
  const idx = order.indexOf(ch.requireAcgState().lineType ?? "");
  if (idx < 0) return;
  // PM p. 60: "It is not possible to transfer up to a megacorporation."
  // The enlistment table is ordered Megacorp → ... → Free Trader (index 0
  // is Megacorp). Transfer-up lowers the index by 1; clamp at index 1 so
  // Megacorp (index 0) is unreachable via transfer.
  const lower = dir === "up" ? Math.max(1, idx - 1) : idx;
  const upper = dir === "down" ? Math.min(order.length - 1, idx + 1) : idx;
  const newIdx = dir === "up" ? lower : upper;
  if (newIdx === idx) {
    // Clamp: nothing changed (e.g., transfer-up from megacorp is blocked).
    // Absence of an ev.transferred event records the no-op.
    return;
  }
  const from = order[idx]!;
  const to = order[newIdx]!;
  recordTransfer(
    ch.requireAcgState(), "lineType", from, to,
    ch.requireAcgState().yearsServed ?? 0,
  );
  ch.requireAcgState().lineType = to;
  ch.log(ev.transferred(to, "line", from));
}

export function merchantSpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  if (!data.specialDuty) return;
  const dm = applyStructuredDms(data.specialDuty.dms, ch);
  const r = Math.max(1, Math.min(7, roll(1) + dm));
  const row = data.specialDuty.rows.find((row) => row.die === r);
  if (!row) return;
  const col = ch.requireAcgState().isOfficer ? "officers" : "deckHands";
  const sa = row[col];
  if (typeof sa !== "string") return;
  ch.requireAcgState().schoolsAttended.push(sa);
  ch.log(ev.schoolAssigned(sa, "merchantPrince"));
  awardBrownie(ch, 1, `Special Duty: ${sa}`);
  applyMerchantSpecialDutyResult(ch, sa);
}

function applyMerchantSpecialDutyResult(ch: Character, sa: string): void {
  const data = dataFor(ch);
  // Two terminal effects don't appear in specialDutyResolution: Commission
  // (grant rank O0 → enlisted becomes officer) and Department Test (allow
  // promotion examination this term).
  if (sa === "Commission") {
    if (!ch.requireAcgState().isOfficer) {
      // PM p. 63 — rank-by-line-type, deadline-to-O1, and revert behavior
      // come from merchantPrince.specialRules.specialDutyCommission in JSON.
      const rule = data.specialRules?.specialDutyCommission;
      const lineType = ch.requireAcgState().lineType ?? "";
      const rank = rule?.rankByLineType?.[lineType] ?? rule?.defaultRank ?? "O0";
      ch.requireAcgState().isOfficer = true;
      ch.requireAcgState().rankCode = rank;
      ch.commissioned = true;
      // O0 holders must pass exam for O1 within passO1DeadlineYears or
      // revert to enlisted (PM p. 63).
      if (rank === (rule?.defaultRank ?? "O0") && rule?.passO1DeadlineYears) {
        ch.requireAcgState().commissionO0DeadlineYear =
          (ch.requireAcgState().yearsServed ?? 0) + rule.passO1DeadlineYears;
      }
      ch.log(ev.promoted(ch.requireAcgState().rankCode, "Merchant commission"));
    }
    return;
  }
  if (sa === "Department Test") {
    ch.requireAcgState().canTakeDeptTest = true;
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
        ch.addSkill(skill, 1, sa);
        awarded.push(skill);
      }
    }
    // addSkill logs each skill grant individually with source=sa; no
    // duplicate summary line needed.
  }
  // Department transfer effects (manual p. 60-61).
  if (res.effect) {
    const transfer = res.effect.match(/Transfer to (\w+)/i);
    if (transfer) {
      const from = ch.requireAcgState().department ?? "";
      const to = transfer[1]!;
      recordTransfer(ch.requireAcgState(), "department", from, to,
        ch.requireAcgState().yearsServed ?? 0);
      ch.requireAcgState().department = to;
      ch.log(ev.transferred(to, "department", from));
    }
    if (/DM \+1 on (?:the )?exam/i.test(res.effect)) {
      ch.requireAcgState().examDm = (ch.requireAcgState().examDm ?? 0) + 1;
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
  const target = data.reenlistment.target;
  const keep = r === 12 || r + dm >= target;
  const dept = ch.requireAcgState().department ?? "";
  ch.log(ev.roll("Reenlistment", r, dm, target, keep, `merchant ${dept}`));
  if (r === 12) {
    ch.enterMandatoryReenlist();
    offerMerchantDepartmentChange(ch, data);
    return true;
  }
  if (keep) offerMerchantDepartmentChange(ch, data);
  return keep;
}

/** PM p. 65 Merchant checklist: at reenlistment the character may reenlist
 *  into a different department ("Reenlist in Different Branch?"). The
 *  available departments come from the line's department-assignment table
 *  (FreeTrader is fixed to the Free Trader role). Interactive mode queues
 *  a choice; auto mode keeps the current department. */
/** F13 — PM p. 61 line 3851. Adds the Reduced Passage benefit string to
 *  the character's benefits list at muster-out. Rule lives in JSON
 *  (advancedCharacterGeneration.merchantPrince.specialRules.reducedPassage). */
export function applyReducedPassageBenefit(ch: Character): void {
  const mp = getAcgPathway(ch.editionId, "merchantPrince") as MerchantData | undefined;
  const rp = mp?.specialRules?.reducedPassage as {
    appliesAfterMuster?: boolean;
    passage?: string;
    pricePercent?: number;
    conditions?: string;
  } | undefined;
  if (!rp?.appliesAfterMuster) return;
  const label = `Reduced Passage (${rp.passage ?? "Mid Psg"} at ${rp.pricePercent ?? 50}%${rp.conditions ? `, ${rp.conditions}` : ""})`;
  if (ch.benefits.includes(label)) return;
  ch.log(ev.raw(label, "simple"));
  ch.addBenefit(label);
}

function offerMerchantDepartmentChange(ch: Character, data: MerchantData): void {
  if (!ch.acgState || ch.choiceMode === "auto") return;
  const size = lineSizeFor(data, ch.acgState.lineType ?? "");
  if (size === "FreeTrader") return; // Free Traders don't change department
  const lineCol = size === "Large" ? "largeMerchantLine" : "smallMerchantLine";
  const all = new Set<string>();
  for (const row of data.departmentAssignment.rows) {
    const v = row[lineCol];
    if (typeof v === "string") all.add(v);
  }
  const current = ch.acgState.department ?? "";
  const options = [current, ...[...all].filter((d) => d !== current)];
  if (options.length <= 1) return;
  ch.pickOrDefer({
    kind: "cascade",
    label: `Reenlist in different department (current: ${current})`,
    options,
    preferred: [current],
    context: { source: "reenlist", reenlistChangeDepartment: true },
    onResolve: (c, chosen) => {
      if (chosen !== current && c.acgState) {
        c.acgState.department = chosen;
        c.log(ev.transferred(chosen, "department", current, "reenlist"));
      }
    },
  });
}

export function merchantStartOfTerm(ch: Character): void {
  // Reset per-term flags before any per-year resolution fires.
  delete ch.requireAcgState().routeAssignmentThisTerm;
  // Enlisted ranks advance every 4 years (per manual p. 60).
  if (!ch.requireAcgState().isOfficer && ch.terms > 0) {
    const code = ch.requireAcgState().rankCode;
    const m = code.match(/^E(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      ch.requireAcgState().rankCode = `E${n + 1}`;
    }
    return;
  }
  // O0 holders revert to enlisted if they haven't passed O1 within the
  // commission deadline (PM p. 63). All thresholds in JSON.
  const data = dataFor(ch);
  const rule = data.specialRules?.specialDutyCommission;
  const o0Rank = rule?.defaultRank ?? "O0";
  const revertRank = rule?.revertOnDeadlineToRank ?? "E1";
  const deadline = ch.requireAcgState().commissionO0DeadlineYear;
  if (deadline !== undefined &&
      ch.requireAcgState().rankCode === o0Rank &&
      (ch.requireAcgState().yearsServed ?? 0) >= deadline) {
    ch.requireAcgState().isOfficer = false;
    ch.requireAcgState().rankCode = revertRank;
    ch.commissioned = false;
    delete ch.requireAcgState().commissionO0DeadlineYear;
    ch.log(ev.statusChange("demoted", `failed O1 exam in time — reverted to ${revertRank}`));
    return;
  }
  // F12 PM p. 61: officers auto-transfer to the Deck department after one
  // full term in the configured rank. Rule lives in JSON.
  applyDeckAutoTransferIfDue(ch);
}

function applyDeckAutoTransferIfDue(ch: Character): void {
  if (!ch.acgState?.isOfficer) return;
  const data = dataFor(ch);
  const rule = data.specialRules?.deckAutoTransferAtRank;
  if (!rule) return;
  if (ch.acgState.rankCode !== rule.rankCode) return;
  if (ch.acgState.department === rule.destinationDepartment) return;
  // PM says "after one full term in rank O4" — we trigger at startOfTerm
  // when the rank was reached in the previous term.
  const lastPromotion = ch.acgState.assignmentHistory.length;
  void lastPromotion; // kept for future term-since-promotion tracking
  const from = ch.acgState.department ?? "";
  recordTransfer(ch.acgState, "department", from, rule.destinationDepartment,
    ch.acgState.yearsServed ?? 0);
  ch.acgState.department = rule.destinationDepartment;
  ch.log(ev.transferred(rule.destinationDepartment, "department", from));
}

/** PM p. 61 end-of-term promotion exam. Runs AFTER assignments so DMs
 *  accumulated from this term's special-duty schools (e.g. Business
 *  School's +1 to exam for O6+) apply correctly. Enlisted characters
 *  serving Route assignments may also take the exam — passing earns
 *  a commission. */
export function merchantEndOfTerm(ch: Character): void {
  if (!ch.acgState) return;
  if (ch.acgState.isOfficer) {
    attemptMerchantPromotionExam(ch);
  } else if (servedOnRouteThisTerm(ch)) {
    attemptMerchantEnlistedCommissionExam(ch);
  }
  ch.acgState.examDm = 0;
}

function servedOnRouteThisTerm(ch: Character): boolean {
  // PM p. 61: "they may be able to take if they are serving on a
  // Route assignment". Set whenever a Route assignment was rolled
  // during the current term; cleared at startOfTerm.
  return ch.acgState?.routeAssignmentThisTerm === true;
}

function attemptMerchantEnlistedCommissionExam(ch: Character): void {
  const data = dataFor(ch);
  const size = lineSizeFor(data, ch.requireAcgState().lineType ?? "");
  const officerLadder = data.ranksAndPromotions as Record<string, {
    officer?: Array<[string, string, string, string | null]>;
  }>;
  const sizeKey = size === "Large" ? "large" : size === "Small" ? "small" : "freeTrader";
  const o1 = officerLadder[sizeKey]?.officer?.[0];
  if (!o1) return;
  // Officer ladder row format: [rankCode, title, examTarget, note?].
  const target = parseInt(String(o1[2]), 10);
  if (Number.isNaN(target)) return;
  const dm = ch.requireAcgState().examDm ?? 0;
  const r = roll(2);
  ch.log(ev.roll(
    "Commission", r, dm, target, r + dm >= target, "Merchant enlisted-route exam",
  ));
  if (r + dm >= target) {
    ch.requireAcgState().isOfficer = true;
    ch.requireAcgState().rankCode = "O1";
    ch.commissioned = true;
    ch.log(ev.promoted("O1", "Route-assignment promotion exam"));
  }
}

function attemptMerchantPromotionExam(ch: Character): void {
  const data = dataFor(ch);
  if (!ch.requireAcgState().isOfficer) return;
  // Need data for the officer rank ladder + targets.
  const officerLadder = data.ranksAndPromotions as Record<string, {
    officer?: Array<[string, string, string, string | null]>;
  }>;
  // ranksAndPromotions has per-line-type blocks; pick the line.
  const size = lineSizeFor(data, ch.requireAcgState().lineType ?? "");
  const key = size === "Large" ? "largeMerchantLine"
    : size === "Small" ? "smallMerchantLine" : "freeTraders";
  const ladder = officerLadder[key]?.officer;
  if (!Array.isArray(ladder)) return;
  const codes = ladder.map((r) => r[0]);
  const idx = codes.indexOf(ch.requireAcgState().rankCode);
  if (idx < 0 || idx >= codes.length - 1) return;
  const nextRow = ladder[idx + 1]!;
  const targetStr = nextRow[2];
  const target = parseInt(String(targetStr).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(target)) return;
  const penalty = ch.requireAcgState().nextPromotionPenalty ?? 0;
  const dm = (ch.requireAcgState().examDm ?? 0) + penalty;
  if (penalty < 0) ch.requireAcgState().nextPromotionPenalty = 0;
  const r = roll(2);
  ch.log(ev.roll(
    "Promotion", r, dm, target, r + dm >= target,
    `Merchant exam (${codes[idx]}→${codes[idx + 1]})`
    + (penalty ? `, reprimand penalty ${penalty}` : ""),
  ));
  if (r + dm >= target) {
    ch.requireAcgState().rankCode = nextRow[0] as string;
    ch.log(ev.promoted(nextRow[1]));
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
  ch.log(ev.raw("Free Trader ship (Owner/Captain)", "simple"));
  ch.addBenefit("Free Trader");
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
    endOfTerm: merchantEndOfTerm,
  };
}
