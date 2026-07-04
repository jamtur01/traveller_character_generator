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

import type { Character } from "@/lib/traveller/character";
import { getEdition, getAcgPathway } from "@/lib/traveller/editions";
import {
  applyDmRules, applyStructuredDms, columnDmFor, labelToColumnKey,
  parseResolutionTarget,
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import { awardBrownie, bpAwardFor } from "@/lib/traveller/engine/acg/awards";
import { runPhases, type PathwaySpec } from "@/lib/traveller/engine/acg/phaseRunner";
import { type PathwayCallbacks } from "@/lib/traveller/engine/acg/jsonPhases";
import {
  createPathwaySpecRegistry, runReenlist, offerRoleChange, clampedRoll,
  clearRetention, consumeRetainedAssignment, rollDieRow, rollSkillFromColumn,
} from "./shared";
import { requireRule } from "@/lib/traveller/editions/strict";
import type { AcgState, AssignmentResolution, ResolutionTarget } from "@/lib/traveller/engine/acg/state";
import { attemptPreCareer, applyPreCareerResult } from "@/lib/traveller/engine/acg/preCareer";
import { event as ev } from "@/lib/traveller/history";
import {
  rankNum, evaluatePredicate, buildPredicateContext,
  type PredicateContext,
} from "@/lib/traveller/engine/predicate";

const PATHWAY = "merchantPrince";

/** One row of a department rank ladder: [rankCode, title, examTarget, skillOrNote]. */
type MerchantRankRow = [string, string, string, string | null];

/** Availability rule for one merchant skill-table column (PM p. 63 skill-
 *  table notes, encoded in JSON per skill table). A column is available to a
 *  character when its department passes the department gate (`departments`
 *  whitelist / `exceptDepartments` blacklist / `allDepartments`) and its rank
 *  clears any `minRank` floor. */
interface MerchantColumnAvailability {
  allDepartments?: boolean;
  departments?: string[];
  exceptDepartments?: string[];
  minRank?: string;
}

interface MerchantSkillTable {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  columnAvailability?: Record<string, MerchantColumnAvailability>;
}

export interface MerchantData {
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
    schoolTransfer?: { noTransferAtOrAboveOfficerRank?: number };
    reducedPassage?: unknown;
    freeTraderShip?: { minOfficerRank?: string };
    /** PM p. 60 in-service Bonus: roll 1D on the named muster table and
     *  receive the amount divided by `divisor` (the printed rule is half). */
    inServiceBonus?: { fromTable?: string; divisor?: number };
    /** PM p. 60: enlisted personnel are promoted every four years,
     *  capped at rankMax (no titles exist above the starting grade). */
    enlistedAdvancement?: { enlistedAutoAdvancePerTerm?: boolean; rankMax?: string };
    [k: string]: unknown;
  };
  enlistment: {
    columns: string[];
    rows: Array<{
      typeOfLine: string;
      noTransferInto?: boolean;
      minimumStarport: string;
      lineSize: "Large" | "Small" | null;
      target: string | number;
    }>;
    startingRank: string;
    dms?: StructuredDm[];
  };
  departmentAssignment: { columns: string[]; rows: Array<Record<string, unknown>> };
  availablePositions: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
    freeTrader?: { target: string; dms?: StructuredDm[] };
  };
  specificAssignment: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  };
  assignmentResolution: Record<string, {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
  }>;
  ranksAndPromotions: Record<string, MerchantRankRow[]>;
  skillTables: Record<string, MerchantSkillTable>;
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
  /** PM p. 61: assignment belongs to the 'Free Trader Other' resolution
   *  table (No Business / Smuggling / Piracy) rather than Trade. */
  other?: boolean;
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
  if (!row) {
    throw new Error(
      `Merchant line type "${lineType}" has no enlistment row ` +
      `(acg.merchantPrince.enlistment.rows) — fix the edition JSON`,
    );
  }
  if (row.lineSize === null) return "FreeTrader";
  return row.lineSize;
}

/** The character's merchant department. Enlistment always sets it (roll,
 *  academy pick, or medical-school commission); a null department means a
 *  department-keyed read ran before enlistment — fail loudly instead of
 *  silently defaulting to Deck. */
function merchantDepartmentOf(ch: Character): string {
  const department = ch.requireMerchantAcg().department;
  if (!department) {
    throw new Error(
      "Merchant department is unset — enlistment must assign a department " +
      "before department-keyed rolls (PM p. 60)",
    );
  }
  return department;
}

function assignmentColumnFor(lineSize: "Large" | "Small" | "FreeTrader"): string {
  if (lineSize === "Large") return "largeLine";
  if (lineSize === "Small") return "smallLine";
  return "freeTrader";
}

function dataFor(ch: Character): MerchantData {
  const data = getAcgPathway(ch.editionId, "merchantPrince");
  if (!data) throw new Error("Merchant Prince pathway requires ACG data");
  return data;
}

/** Starport ordering: edition JSON `homeworld.starportOrder` lists letters
 *  worst → best (X, E, ... A). */
function starportMeets(
  ch: Character, home: string | undefined, minimum: string,
): boolean {
  if (!home) return false;
  if (!minimum || minimum.toLowerCase() === "any") return true;
  const order = getEdition(ch.editionId).data.homeworld?.starportOrder ?? [];
  const have = order.indexOf(home.toUpperCase());
  const want = order.indexOf(minimum.toUpperCase());
  if (have < 0 || want < 0) {
    throw new Error(
      `Starport code not in homeworld.starportOrder (have "${home}", ` +
      `minimum "${minimum}") — fix the edition JSON; gates must not silently pass.`,
    );
  }
  return have >= want;
}

export function merchantEnlist(
  ch: Character,
  lineType: string,
): void {
  const data = dataFor(ch);
  ch.requireMerchantAcg().lineType = lineType;
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
    const r = ch.rng.roll(2);
    const succeeded = r + dm >= parsed.target;
    ch.log(ev.enlistmentAttempt(`Merchant ${lineType}`, r, dm, parsed.target, succeeded));
    if (!succeeded) {
      throw new Error(`Merchant enlistment failed (${r + dm} vs ${parsed.target})`);
    }
  }
  // Preserve pre-career commission rank (e.g. Medical School O3 entering
  // Merchants as Purser Department Medic per PM p. 47). Otherwise default
  // to E1 enlisted.
  const acg = ch.requireAcgState();
  if (!acg.preCareerCommission) {
    acg.rankCode = data.enlistment.startingRank;
    acg.isOfficer = false;
  } else if (acg.schoolsAttended.includes("medicalSchool")) {
    // PM p. 47: the medical-school direct commission serves as a Purser
    // Department Medic — the department is strict-read from the school's
    // directCommissionBranches entry for this pathway.
    const medicalSchool = getEdition(ch.editionId).data
      .advancedCharacterGeneration?.common?.preCareerOptions?.medicalSchool as
      { directCommissionBranches?: Array<{ pathway?: string; department?: string }> }
      | undefined;
    const entry = medicalSchool?.directCommissionBranches
      ?.find((b) => b.pathway === "merchantPrince");
    ch.requireMerchantAcg().department = requireRule(
      entry?.department,
      "acg.common.preCareerOptions.medicalSchool.directCommissionBranches" +
      '[pathway="merchantPrince"].department', "PM p. 47",
    );
    ch.log(ev.enlistmentAttempt(
      `Merchants Purser Department Medic (medical school direct commission, ${acg.rankCode})`,
      0, 0, 0, true,
    ));
  }

  // PM p. 47: Merchant Academy "may" be applied for after enlistment in
  // a Megacorporation or Sector-wide line. The choice is the player's,
  // not automatic. Interactive mode queues a yes/no choice; auto mode
  // skips the Academy unless ch.acgState.attemptMerchantAcademy was
  // pre-set by the UI/caller (defaults to false).
  const merchantAcademy = getEdition(ch.editionId).data.advancedCharacterGeneration
    ?.common?.preCareerOptions?.merchantAcademy as { requiresLineType?: string[] } | undefined;
  if ((merchantAcademy?.requiresLineType ?? []).includes(lineType)) {
    offerMerchantAcademy(ch);
  }

  // Department assignment (skipped if the Academy already set it on
  // honors — the Academy's applyMerchantDepartmentSkills records the
  // pick in acgState.department, and honors graduates "may select the
  // department to which he will be assigned" per the PM).
  if (!ch.requireMerchantAcg().department) {
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
    onResolve: (ch, chosen) => {
      if (chosen.startsWith("Apply")) {
        maybeAttemptMerchantAcademy(ch);
      }
    },
  });
}

function merchantAssignDepartment(ch: Character): void {
  const data = dataFor(ch);
  const size = lineSizeFor(data, ch.requireMerchantAcg().lineType!);
  if (size === "FreeTrader") {
    ch.requireMerchantAcg().department = "Free Trader";
    return;
  }
  const lineCol = size === "Large" ? "largeMerchantLine" : "smallMerchantLine";
  const row = rollDieRow(ch, data.departmentAssignment, { dice: 1, dm: 0 });
  const dept = row?.[lineCol];
  if (dept === undefined || dept === null) {
    throw new Error(
      `Merchant departmentAssignment table has no "${lineCol}" cell for the ` +
      `rolled row (edition: ${ch.editionId}) — fix the edition JSON`,
    );
  }
  ch.requireMerchantAcg().department = String(dept);
  // acgState.department is read by subsequent assignment / skill rolls.
}

export function merchantRollAssignment(ch: Character): string {
  const acg = ch.requireMerchantAcg();
  const data = dataFor(ch);
  const retained = consumeRetainedAssignment(acg);
  if (retained) return retained;
  const size = lineSizeFor(data, acg.lineType!);
  const lineCol = assignmentColumnFor(size);
  // DMs from JSON, filtered by column (largeLine/smallLine/freeTrader).
  const dm = columnDmFor(data.specificAssignment.dms, lineCol, ch);
  // Row 13 is reachable: a natural 12 plus a +1 DM hits 13. The
  // specificAssignment table declares rows for die ∈ [2,13]; the clamp
  // range derives from those rows — do not truncate.
  const row = rollDieRow(ch, data.specificAssignment, { dice: 2, dm });
  const assignment = row?.[lineCol];
  if (assignment === undefined || assignment === null) {
    throw new Error(
      `Merchant specificAssignment table has no "${lineCol}" cell for the ` +
      `rolled row (edition: ${ch.editionId}) — fix the edition JSON`,
    );
  }
  return String(assignment);
}

export function merchantResolveAssignment(ch: Character, assignment: string): void {
  if (assignment === "Transfer Up" || assignment === "Transfer Down") {
    const dir = assignment === "Transfer Up" ? "up" : "down";
    transferMerchantLine(ch, dir);
    // Reroll specific assignment in the new line. PM allows only one
    // transfer per year: if the reroll lands on another transfer, reroll
    // until we get a real assignment rather than silently dropping the
    // year's resolution. Bound the loop defensively so a misconfigured
    // table can't infinite-loop.
    let next = merchantRollAssignment(ch);
    for (let i = 0; i < 8 && (next === "Transfer Up" || next === "Transfer Down"); i++) {
      next = merchantRollAssignment(ch);
    }
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
  if (ch.requireAcgState().isOfficer) merchantCheckAvailablePosition(ch);
  const { table, colKey } = selectMerchantResolutionTable(ch, assignment);
  // F14: Free Trader pursuit narrative + skipBonus override (PM p. 61).
  const flags = freeTraderAssignmentFlags(ch)[assignment];
  if (flags?.narrative) {
    ch.log(ev.raw(`${assignment}: ${flags.narrative}`, "verbose"));
  }
  const { res, dms } =
    buildMerchantResolution(table, colKey, ch, flags?.skipBonus === true);
  runPhases(getMerchantSpec(ch), { ch, assignment, resTable: table, res, dms });
}

type MerchantResolutionTable = MerchantData["assignmentResolution"][string];

/** Select the resolution sub-table + column for a merchant assignment. Free
 *  Traders use freeTraderTrade (Route/Charter/Exploratory/Speculative) or
 *  freeTraderOther (Smuggling/Piracy/No Business, flagged `other`); everyone
 *  else uses the department table. Throws on a missing table/column (PM p.64). */
function selectMerchantResolutionTable(
  ch: Character, assignment: string,
): { table: MerchantResolutionTable; colKey: string } {
  const data = dataFor(ch);
  const acg = ch.requireMerchantAcg();
  const isFreeTrader = acg.lineType === "Free Trader";
  const isFreeTraderOther =
    isFreeTrader && freeTraderAssignmentFlags(ch)[assignment]?.other === true;
  // The department key matters only off the Free Trader path (free traders
  // resolve on the freeTraderTrade/freeTraderOther tables).
  const deptKey = isFreeTrader ? null : labelToColumnKey(merchantDepartmentOf(ch));
  const table = isFreeTrader
    ? (isFreeTraderOther
        ? data.assignmentResolution.freeTraderOther
        : data.assignmentResolution.freeTraderTrade)
    : data.assignmentResolution[deptKey!];
  if (!table) {
    throw new Error(
      `Merchant: no resolution sub-table for department "${acg.department}" ` +
      `(key "${deptKey}", lineType: "${acg.lineType}", edition: ${ch.editionId}).`,
    );
  }
  const colKey = isFreeTraderOther
    ? labelToColumnKey(assignment)
    : (assignmentColumnMap(ch)[assignment] ?? labelToColumnKey(assignment));
  if (!table.columns.includes(colKey)) {
    throw new Error(
      `Merchant: assignment "${assignment}" → column "${colKey}" not in ` +
      `department "${deptKey ?? acg.lineType}" (available: ${table.columns.join(", ")}).`,
    );
  }
  return { table, colKey };
}

/** Synthesize an AssignmentResolution from a merchant Survival/Skills/Bonus
 *  table. Merchant has no decoration or per-assignment promotion phase (PM
 *  p. 65 — promotion is the end-of-term exam); the bonus target rides the
 *  `bonus` extension the loader's bonus phase reads. */
function buildMerchantResolution(
  table: MerchantResolutionTable, colKey: string, ch: Character, skipBonus: boolean,
): { res: AssignmentResolution; dms: { survival: number; skills: number; bonus: number } } {
  const rowFor = (name: string) =>
    table.rows.find((r) => String(r.result).toLowerCase() === name);
  const survRow = rowFor("survival");
  const skillRow = rowFor("skills");
  const bonusRow = rowFor("bonus");
  const res = {
    survival: survRow ? parseResolutionTarget(survRow[colKey]).target : "none",
    skills: skillRow ? parseResolutionTarget(skillRow[colKey]).target : "none",
    decoration: "none",
    promotion: "none",
    bonus: bonusRow && !skipBonus ? parseResolutionTarget(bonusRow[colKey]).target : "none",
  } as AssignmentResolution & { bonus?: ResolutionTarget };
  const dms = {
    survival: applyDmRules(table.dms, ch, "survival"),
    skills: applyDmRules(table.dms, ch, "skills"),
    bonus: applyDmRules(table.dms, ch, "bonus"),
  };
  return { res, dms };
}

const MERCHANT_CALLBACKS: PathwayCallbacks = {
  merchantRollSkill: (ctx) => merchantRollSkill(ctx.ch),
  merchantAwardBonus: (ctx) => merchantAwardBonus(ctx.ch),
  merchantFinalize: (ctx) => {
    const acg = ctx.ch.requireAcgState();
    acg.assignmentHistory.push(ctx.assignment);
    // PM p. 61: enlisted commission exam is available "if they are
    // serving on a Route assignment" during the current term.
    if (ctx.assignment === "Route") acg.perTerm.routeAssignmentThisTerm = true;
  },
};

const REGISTRY = createPathwaySpecRegistry<MerchantData>({
  pathwayKey: "merchantPrince",
  callbacks: MERCHANT_CALLBACKS,
  combatAssignments: () => [],
});
export const validateMerchantConfig = REGISTRY.validate;
function getMerchantSpec(ch: Character): PathwaySpec { return REGISTRY.get(ch); }

function merchantCheckAvailablePosition(ch: Character): void {
  const acg = ch.requireMerchantAcg();
  // Reset the prior year's temporary demotion before re-evaluating.
  acg.effectiveRankCode = null;
  const data = dataFor(ch);
  const ap = data.availablePositions;
  const size = lineSizeFor(data, acg.lineType!);
  let target: ResolutionTarget;
  let dm: number;
  if (size === "FreeTrader") {
    // PM p. 64: Free Traders throw 8+ to determine position availability.
    if (!ap.freeTrader) return;
    target = parseResolutionTarget(ap.freeTrader.target).target;
    dm = applyStructuredDms(ap.freeTrader.dms, ch);
  } else {
    const col = size === "Large" ? "largeLine" : "smallLine";
    const row = ap.rows.find((r) => r.department === acg.department);
    if (!row) return;
    target = parseResolutionTarget(row[col]).target;
    dm = applyStructuredDms(ap.dms, ch);
  }
  // PM p. 63/64: no position at rank -> serve one rank lower this year (the
  // permanent rank is unchanged). effectiveRankCode gates the promotion exam.
  if (typeof target === "number" && ch.rng.roll(2) + dm < target) {
    serveOneRankLower(acg);
  }
}

/** PM p. 63/64: mark an officer as serving one rank lower this year (no
 *  available position). O1 falls to O0 (enlisted-equivalent). */
function serveOneRankLower(acg: AcgState): void {
  acg.effectiveRankCode = `O${Math.max(0, rankNum(acg.rankCode) - 1)}`;
}

function merchantRollSkill(ch: Character): void {
  const data = dataFor(ch);
  // PM p. 63: "the skill received must be taken from one of the skill table
  // columns available." Only tables exposing at least one column available to
  // this character's department/rank can be rolled on.
  const tables = Object.keys(data.skillTables)
    .filter((k) => availableSkillColumns(ch, data.skillTables[k]!).length > 0);
  if (tables.length === 0) return;
  // Interactive: let the player pick the table. Auto: round-robin by year.
  if (ch.choiceMode === "interactive" && tables.length > 1) {
    ch.pickOrDefer({
      kind: "merchantSkillTable",
      label: "Merchant: choose which skill table to roll on this year.",
      options: tables,
      onResolve: (ch, key) => merchantRollFromTable(ch, key),
    });
    return;
  }
  const tableKey = tables[(ch.requireAcgState().year - 1) % tables.length]!;
  merchantRollFromTable(ch, tableKey);
}

/** Columns of `table` available to the character this year, per the PM p. 63
 *  availability notes encoded in JSON (skillTables.*.columnAvailability). A
 *  column with no availability entry is treated as unavailable, and a table
 *  with no availability metadata at all is broken edition data — the JSON is
 *  the single source of truth for who may roll which column. */
function availableSkillColumns(ch: Character, table: MerchantSkillTable): string[] {
  const cols = table.columns.filter((c) => c !== "die");
  const avail = table.columnAvailability;
  if (!avail) {
    throw new Error(
      "Merchant skill table lacks columnAvailability metadata (PM p. 63) — " +
      "declare it in the edition JSON; column access must not be guessed.",
    );
  }
  const dept = ch.requireMerchantAcg().department!;
  const pctx = buildPredicateContext(ch);
  return cols.filter((c) => columnAvailableForCharacter(avail[c], dept, pctx));
}

function columnAvailableForCharacter(
  rule: MerchantColumnAvailability | undefined,
  dept: string,
  pctx: PredicateContext,
): boolean {
  if (!rule) return false;
  if (rule.departments && !rule.departments.includes(dept)) return false;
  if (rule.exceptDepartments && rule.exceptDepartments.includes(dept)) return false;
  if (rule.minRank && !evaluatePredicate({ rankAtLeast: rule.minRank }, pctx)) return false;
  return true;
}

function merchantRollFromTable(ch: Character, tableKey: string): void {
  const data = dataFor(ch);
  const table = data.skillTables[tableKey];
  if (!table) return;
  const columns = availableSkillColumns(ch, table);
  if (columns.length === 0) return;
  // PM p. 63 lets the player take the skill from any available column, so a
  // department with more than one available column exposes the choice in
  // interactive mode; auto mode takes the first (department-appropriate) one.
  if (ch.choiceMode === "interactive" && columns.length > 1) {
    ch.pickOrDefer({
      kind: "merchantSkillColumn",
      label: `Merchant: choose a skill column from the ${tableKey} table.`,
      options: columns,
      onResolve: (ch, col) => rollMerchantSkillColumn(ch, tableKey, col),
    });
    return;
  }
  rollMerchantSkillColumn(ch, tableKey, columns[0]!);
}

/** Roll 1D on `column` of the named skill table and apply the resulting skill
 *  cell. The merchant skill tables list one skill per die row, so the column
 *  selects which department/rank variant of that row is taken. */
function rollMerchantSkillColumn(ch: Character, tableKey: string, column: string): void {
  const table = dataFor(ch).skillTables[tableKey];
  if (!table) return;
  rollSkillFromColumn(ch, table, column, `Merchant ${tableKey} ${column}`);
}

function merchantAwardBonus(ch: Character): void {
  // Bonus per PM p. 60: throw 1D on the merchants muster-out cash table
  // and receive the amount divided by specialRules.inServiceBonus.divisor
  // (the printed rule is half). Table choice + divisor live in JSON; the
  // basic merchants service's musterCash[] is the source-of-truth table,
  // and the roll's clamp range derives from its declared indices.
  const merchants = ch.editionService("merchants" as never);
  if (!merchants) return;
  const bonus = requireRule(
    dataFor(ch).specialRules?.inServiceBonus,
    "merchantPrince.specialRules.inServiceBonus", "PM p. 60",
  );
  if (bonus.fromTable !== "musterCash") {
    throw new Error(
      `merchantPrince.specialRules.inServiceBonus.fromTable must be ` +
      `"musterCash" (PM p. 60); got "${bonus.fromTable}".`,
    );
  }
  const divisor = requireRule(
    bonus.divisor, "merchantPrince.specialRules.inServiceBonus.divisor", "PM p. 60",
  );
  const indices = Object.keys(merchants.musterCash).map(Number);
  const rawRoll = clampedRoll(ch, 1, 0, Math.min(...indices), Math.max(...indices));
  const fullAmount = requireRule(
    merchants.musterCash[rawRoll],
    `merchants musterCash[${rawRoll}]`, "PM p. 60 in-service bonus",
  );
  const cash = Math.floor(fullAmount / divisor);
  if (cash <= 0) return;
  ch.credits += cash;
  ch.muster.musterLog.push(`Cr${cash} bonus (in-service)`);
  ch.log(ev.musterCash(cash, rawRoll, 0, "Merchant in-service bonus (half)"));
}

function transferMerchantLine(ch: Character, dir: "up" | "down"): void {
  const data = dataFor(ch);
  const order = data.enlistment.rows.map((r) => r.typeOfLine);
  const idx = order.indexOf(ch.requireMerchantAcg().lineType!);
  if (idx < 0) return;
  // Transfer moves one row up/down the JSON enlistment table (PM p. 60).
  // Rows flagged noTransferInto (Megacorp: "It is not possible to transfer
  // up to a megacorporation") cannot be entered via transfer — the rule is
  // the JSON row's flag, not an index clamp tied to implicit row order.
  // An edge-of-table or blocked transfer is a no-op; absence of an
  // ev.transferred event records it.
  const newIdx = dir === "up" ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= order.length) return;
  if (data.enlistment.rows[newIdx]?.noTransferInto === true) return;
  const from = order[idx]!;
  const to = order[newIdx]!;
  ch.requireMerchantAcg().lineType = to;
  ch.log(ev.transferred(to, "line", from));
  // Joining a new line class changes department membership (PM p. 60-61):
  // Free Trader crews are the single "Free Trader" department, while large/
  // small lines assign a real department (departmentAssignment table).
  // Reconcile so the department-keyed resolution routing can't strand a
  // department with no sub-table (e.g. "Free Trader" inside a Fledgling line).
  const dept = ch.requireMerchantAcg().department;
  const deptValid = lineSizeFor(data, to) === "FreeTrader"
    ? dept === "Free Trader"
    : dept !== null && dept !== "Free Trader";
  if (!deptValid) merchantAssignDepartment(ch);
}

export function merchantSpecialAssignment(ch: Character): void {
  const data = dataFor(ch);
  if (!data.specialDuty) return;
  const dm = applyStructuredDms(data.specialDuty.dms, ch);
  const row = rollDieRow(ch, data.specialDuty, { dice: 1, dm });
  if (!row) return;
  const acg = ch.requireAcgState();
  const col = acg.isOfficer ? "officers" : "deckHands";
  const sa = row[col];
  if (typeof sa !== "string") return;
  acg.schoolsAttended.push(sa);
  ch.log(ev.schoolAssigned(sa, "merchantPrince"));
  awardBrownie(ch, bpAwardFor(ch, "Special assignment") ?? 0, `Special Duty: ${sa}`);
  applyMerchantSpecialDutyResult(ch, sa);
}

function applyMerchantSpecialDutyResult(ch: Character, sa: string): void {
  const data = dataFor(ch);
  // Two terminal effects don't appear in specialDutyResolution: Commission
  // (grant rank O0 → enlisted becomes officer) and Department Test (allow
  // promotion examination this term).
  if (sa === "Commission") {
    const acg = ch.requireAcgState();
    if (!acg.isOfficer) {
      // PM p. 63 — rank-by-line-type, deadline-to-O1, and revert behavior
      // come from merchantPrince.specialRules.specialDutyCommission in JSON.
      const rule = requireRule(
        data.specialRules?.specialDutyCommission,
        "merchantPrince.specialRules.specialDutyCommission", "PM p. 63",
      );
      const defaultRank = requireRule(
        rule.defaultRank,
        "merchantPrince.specialRules.specialDutyCommission.defaultRank", "PM p. 63",
      );
      const lineType = ch.requireMerchantAcg().lineType!;
      const rank = rule.rankByLineType?.[lineType] ?? defaultRank;
      acg.isOfficer = true;
      acg.rankCode = rank;
      ch.commissioned = true;
      // O0 holders must pass exam for O1 within passO1DeadlineYears or
      // revert to enlisted (PM p. 63).
      if (rank === defaultRank && rule.passO1DeadlineYears) {
        acg.commissionO0DeadlineYear =
          (acg.yearsServed ?? 0) + rule.passO1DeadlineYears;
      }
      ch.log(ev.promoted(acg.rankCode, "Merchant commission"));
    }
    return;
  }
  if (sa === "Department Test") {
    ch.requireAcgState().perTerm.canTakeDeptTest = true;
    return;
  }
  const key = labelToColumnKey(sa);
  const res = data.specialDutyResolution?.[key];
  if (!res) return;
  if (res.throw && res.skills) {
    const tgt = parseInt(res.throw, 10);
    const awarded: string[] = [];
    for (const skill of res.skills) {
      if (ch.rng.roll(1) >= tgt) {
        ch.addSkill(skill, 1, sa);
        awarded.push(skill);
      }
    }
    // addSkill logs each skill grant individually with source=sa; no
    // duplicate summary line needed.
  }
  // Department transfer effects (manual p. 60-61).
  if (res.effect) {
    const acg = ch.requireMerchantAcg();
    const officerRank = acg.isOfficer ? rankNum(acg.rankCode) : 0;
    const transfer = res.effect.match(/Transfer to (\w+)/i);
    if (transfer) {
      // PM p. 61: school/training transfers do not take place for officers
      // at/above the JSON-declared rank (O5+), nor when already in the
      // target department.
      const minBlockRank = requireRule(
        data.specialRules?.schoolTransfer?.noTransferAtOrAboveOfficerRank,
        "merchantPrince.specialRules.schoolTransfer.noTransferAtOrAboveOfficerRank",
        "PM p. 61",
      );
      const from = acg.department;
      const to = transfer[1]!;
      const blockedByRank = officerRank >= minBlockRank;
      const alreadyThere = from !== null && to.toLowerCase() === from.toLowerCase();
      if (!blockedByRank && !alreadyThere) {
        acg.department = to;
        ch.log(ev.transferred(to, "department", from ?? undefined));
      }
    }
    // PM p. 65: the exam DM applies only at/above the rank named in the
    // effect ("for O6+"); an unqualified "DM +1 on exam" applies always.
    const examMatch = res.effect.match(/DM \+1 on (?:the )?exam(?: for O(\d+)\+)?/i);
    if (examMatch) {
      const minExamRank = examMatch[1] ? parseInt(examMatch[1], 10) : 0;
      if (officerRank >= minExamRank) {
        acg.perTerm.examDm = (acg.perTerm.examDm ?? 0) + 1;
      }
    }
  }
}

export function merchantReenlist(ch: Character): boolean {
  const data = dataFor(ch);
  const dept = ch.requireMerchantAcg().department;
  return runReenlist(ch, {
    target: data.reenlistment.target,
    dms: data.reenlistment.dms,
    label: `merchant ${dept}`,
    onContinue: () => offerMerchantDepartmentChange(ch, data),
  });
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
  const mp = getAcgPathway(ch.editionId, "merchantPrince");
  const rp = mp?.specialRules?.reducedPassage as {
    appliesAfterMuster?: boolean;
    passage?: string;
    pricePercent?: number;
    conditions?: string;
  } | undefined;
  if (!rp?.appliesAfterMuster) return;
  const passage = requireRule(
    rp.passage, "merchantPrince.specialRules.reducedPassage.passage", "PM p. 61",
  );
  const pricePercent = requireRule(
    rp.pricePercent, "merchantPrince.specialRules.reducedPassage.pricePercent",
    "PM p. 61",
  );
  const label = `Reduced Passage (${passage} at ${pricePercent}%${rp.conditions ? `, ${rp.conditions}` : ""})`;
  if (ch.benefits.includes(label)) return;
  ch.log(ev.raw(label, "simple"));
  ch.addBenefit(label);
}

function offerMerchantDepartmentChange(ch: Character, data: MerchantData): void {
  const acg = ch.acgState;
  if (acg?.pathway !== "merchantPrince") return;
  const size = lineSizeFor(data, acg.lineType!);
  if (size === "FreeTrader") return; // Free Traders don't change department
  const lineCol = size === "Large" ? "largeMerchantLine" : "smallMerchantLine";
  const all = new Set<string>();
  for (const row of data.departmentAssignment.rows) {
    const v = row[lineCol];
    if (typeof v === "string") all.add(v);
  }
  const current = acg.department!;
  offerRoleChange(ch, {
    current,
    options: [current, ...[...all].filter((d) => d !== current)],
    label: `Reenlist in different department (current: ${current})`,
    context: { source: "reenlist", reenlistChangeDepartment: true },
    apply: (ch, chosen) => {
      const acg = ch.acgState;
      if (acg?.pathway !== "merchantPrince") return;
      acg.department = chosen;
      ch.log(ev.transferred(chosen, "department", current, "reenlist"));
    },
  });
}

export function merchantStartOfTerm(ch: Character): void {
  // Interactive enlistment pauses on the Merchant Academy offer BEFORE the
  // department assignment at the tail of merchantEnlist, and the resume path
  // never re-enters that tail. Anchor the assignment here: this hook runs
  // once all enlistment choices are resolved and before any department-keyed
  // roll, using the same departmentAssignment table (PM p. 60). The old
  // `?? "Deck"` fallback silently mis-filed these characters instead.
  if (!ch.requireMerchantAcg().department) merchantAssignDepartment(ch);
  // PM p. 60: enlisted personnel advance one grade every four years —
  // declared in specialRules.enlistedAdvancement. Seniority numbering is
  // capped at rankMax to avoid emitting phantom ranks (e.g. E15) for
  // improbably long enlisted careers (no titles above the starting grade).
  const acg = ch.requireAcgState();
  if (!acg.isOfficer && ch.terms > 0) {
    const adv = requireRule(
      dataFor(ch).specialRules?.enlistedAdvancement,
      "merchantPrince.specialRules.enlistedAdvancement", "PM p. 60",
    );
    if (adv.enlistedAutoAdvancePerTerm !== true) return;
    const code = acg.rankCode;
    const m = code.match(/^E(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      const maxCode = requireRule(
        adv.rankMax,
        "merchantPrince.specialRules.enlistedAdvancement.rankMax", "PM p. 60",
      );
      const maxN = parseInt(maxCode.replace(/[^\d]/g, ""), 10) || n;
      if (n < maxN) ch.requireAcgState().rankCode = `E${n + 1}`;
    }
    return;
  }
  // O0 holders revert to enlisted if they haven't passed O1 within the
  // commission deadline (PM p. 63). All thresholds in JSON.
  const data = dataFor(ch);
  const rule = requireRule(
    data.specialRules?.specialDutyCommission,
    "merchantPrince.specialRules.specialDutyCommission", "PM p. 63",
  );
  const o0Rank = requireRule(
    rule.defaultRank,
    "merchantPrince.specialRules.specialDutyCommission.defaultRank", "PM p. 63",
  );
  const revertRank = requireRule(
    rule.revertOnDeadlineToRank,
    "merchantPrince.specialRules.specialDutyCommission.revertOnDeadlineToRank",
    "PM p. 63",
  );
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
  const acg = ch.acgState;
  if (acg?.pathway !== "merchantPrince" || !acg.isOfficer) return;
  const data = dataFor(ch);
  const rule = data.specialRules?.deckAutoTransferAtRank;
  if (!rule) return;
  if (acg.rankCode !== rule.rankCode) return;
  if (acg.department === rule.destinationDepartment) return;
  // PM says "after one full term in rank O4" — we trigger at startOfTerm
  // when the rank was reached in the previous term.
  const from = acg.department!;
  acg.department = rule.destinationDepartment;
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
  ch.acgState.perTerm.examDm = 0;
}

function servedOnRouteThisTerm(ch: Character): boolean {
  // PM p. 61: "they may be able to take if they are serving on a
  // Route assignment". Set whenever a Route assignment was rolled
  // during the current term; cleared at startOfTerm.
  return ch.acgState?.perTerm.routeAssignmentThisTerm === true;
}

/** Officer rank ladder for the character's current department, read from
 *  `ranksAndPromotions` (keyed by department; Free Trader lines use the
 *  `freeTrader` ladder). Rows are [rankCode, title, examTarget, skill]. */
function merchantRankLadder(
  ch: Character, data: MerchantData,
): MerchantRankRow[] | null {
  const acg = ch.requireMerchantAcg();
  const deptKey = lineSizeFor(data, acg.lineType!) === "FreeTrader"
    ? "freeTrader"
    : labelToColumnKey(merchantDepartmentOf(ch));
  const ladder = data.ranksAndPromotions[deptKey];
  return Array.isArray(ladder) ? ladder : null;
}

/** Roll a 2D merchant exam vs `target` with `dm`, log via ev.roll, and return
 *  the pass flag. The shared roll+log of the officer promotion and enlisted-
 *  route commission exams; target-parse + penalty handling stay per-caller. */
function rollMerchantExam(
  ch: Character, target: number, dm: number, label: string, note: string,
): boolean {
  const r = ch.rng.roll(2);
  const succeeded = r + dm >= target;
  ch.log(ev.roll(label, r, dm, target, succeeded, note));
  return succeeded;
}

/** PM p. 61: enlisted characters serving a Route assignment may test for
 *  a commission. Passing the department's entry-officer exam grants the
 *  ladder's entry-officer rank (the row whose code is rank 1). */
function attemptMerchantEnlistedCommissionExam(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireAcgState();
  const ladder = merchantRankLadder(ch, data);
  if (!ladder || ladder.length === 0) return;
  const entry = ladder.find((r) => rankNum(r[0]) === 1) ?? ladder[0]!;
  const target = parseInt(String(entry[2]).replace(/[^\d]/g, ""), 10);
  if (Number.isNaN(target)) return;
  const succeeded = rollMerchantExam(
    ch, target, acg.perTerm.examDm ?? 0, "Commission", "Merchant enlisted-route exam",
  );
  if (succeeded) {
    acg.isOfficer = true;
    acg.rankCode = entry[0];
    ch.commissioned = true;
    ch.log(ev.promoted(entry[0], "Route-assignment promotion exam"));
  }
}

/** PM p. 61: officers advance one rank by passing the next rank's exam
 *  target from the department ladder (position-consistent-with-rank is
 *  gated upstream via the Available Position check). */
function attemptMerchantPromotionExam(ch: Character): void {
  const data = dataFor(ch);
  const acg = ch.requireAcgState();
  if (!acg.isOfficer) return;
  // PM p. 63: only officers serving in a position normally filled by their
  // rank may test for promotion. A failed Available Position check this year
  // sets effectiveRankCode (serving one rank lower), which bars the exam —
  // unless the character earned a Department Test (PM p. 65), the one stated
  // exception. canTakeDeptTest is a one-shot, consumed here.
  const deptTest = acg.perTerm.canTakeDeptTest === true;
  acg.perTerm.canTakeDeptTest = false;
  if (acg.effectiveRankCode && !deptTest) {
    ch.log(ev.statusChange(
      "promotionSkipped", "no position available at rank; not eligible to test",
    ));
    return;
  }
  const ladder = merchantRankLadder(ch, data);
  if (!ladder) return;
  const cur = rankNum(acg.rankCode);
  const nextRow = ladder.find((r) => rankNum(r[0]) === cur + 1);
  if (!nextRow) return;
  const target = parseInt(String(nextRow[2]).replace(/[^\d]/g, ""), 10);
  if (Number.isNaN(target)) return;
  const penalty = acg.nextPromotionPenalty ?? 0;
  const dm = (acg.perTerm.examDm ?? 0) + penalty;
  if (penalty < 0) acg.nextPromotionPenalty = 0;
  const succeeded = rollMerchantExam(
    ch, target, dm, "Promotion",
    `Merchant exam (${acg.rankCode}→${nextRow[0]})`
    + (penalty ? `, reprimand penalty ${penalty}` : ""),
  );
  if (!succeeded) return;
  acg.rankCode = nextRow[0];
  ch.log(ev.promoted(nextRow[1]));
  const skillGrant = nextRow[3];
  if (typeof skillGrant === "string") {
    const m = skillGrant.match(/^(.+?)-(\d+)$/);
    if (m) ch.addSkill(m[1]!, parseInt(m[2]!, 10));
  }
}

/** Hook called by the engine just before mustering out. Free Trader
 *  Owner/Captains (rank O5+ in the Free Trader ladder) leave with a
 *  free trader ship as an automatic benefit (manual p. 61). */
export function merchantFinalizeMuster(ch: Character): void {
  const acg = ch.acgState;
  if (acg?.pathway !== "merchantPrince" || acg.lineType !== "Free Trader") return;
  const m = acg.rankCode.match(/^O(\d+)$/);
  if (!m) return;
  const n = parseInt(m[1]!, 10);
  const minRankCode = requireRule(
    dataFor(ch).specialRules?.freeTraderShip?.minOfficerRank,
    "merchantPrince.specialRules.freeTraderShip.minOfficerRank", "PM p. 61",
  );
  const minRank = parseInt(minRankCode.replace(/[^\d]/g, ""), 10);
  if (Number.isNaN(minRank)) {
    throw new Error(
      `merchantPrince.specialRules.freeTraderShip.minOfficerRank ` +
      `("${minRankCode}") does not name an officer rank (PM p. 61).`,
    );
  }
  if (n < minRank) return;
  if (acg.freeTraderShipEarned) return;
  acg.freeTraderShipEarned = true;
  ch.log(ev.raw("Free Trader ship (Owner/Captain)", "simple"));
  ch.addBenefit("Free Trader");
  ch.muster.musterLog.push("Free Trader ship (Owner/Captain)");
}

export function getMerchantPrincePathway() {
  return {
    pathway: PATHWAY,
    enlist: merchantEnlist,
    rollAssignment: merchantRollAssignment,
    resolveAssignment: merchantResolveAssignment,
    specialAssignment: merchantSpecialAssignment,
    retention: clearRetention,
    reenlist: merchantReenlist,
    startOfTerm: merchantStartOfTerm,
    endOfTerm: merchantEndOfTerm,
  };
}
