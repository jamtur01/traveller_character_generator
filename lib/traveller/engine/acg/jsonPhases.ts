// JSON-driven pathway phase configuration. Option D in the architecture
// roadmap: encode the per-pathway phase ordering and parameters in the
// edition JSON so game-rule edits don't require TS changes; pathway TS
// modules shrink to enlistment.
//
// The loader compiles a ResolveAssignmentConfig (parsed from JSON) into
// a PathwaySpec for runPhases. Built-in phase semantics handle the
// standard patterns (survival fail → endChargen, promotion penalty
// consumption, decoration tier → award + court-martial); pathway-
// specific side effects (skill roll, promotion, finalize, cash bonus, DM
// tradeoff) are declarative verbs dispatched by kind through the verb
// interpreter below — an unknown verb kind fails loud at edition load.

import type { Character } from "@/lib/traveller/character";
import { getEdition, getAcgPathway } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import {
  awardDecoration, resolveDecorationTier, runCourtMartial,
} from "./awards";
import {
  type PathwaySpec, type PhaseDef, type PhaseFailResult,
  type ResolveContext,
} from "./phaseRunner";
import type { MitigationRequest } from "./awards";
import { event as ev, type HistoryEvent } from "@/lib/traveller/history";
import {
  rollSkillFromColumn, serviceSkillColumnFor, branchSkillCandidates,
  branchOf, applyPromotion, combatFinalize, clampedRoll,
  type SkillColumnPolicy,
} from "./pathways/shared";
import { labelToColumnKey, type StructuredDm } from "./tables";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import {
  rankNum, buildPredicateContext, evaluatePredicate,
  type PredicateContext,
} from "@/lib/traveller/engine/predicate";
import { titleize } from "@/lib/traveller/formatting";

// --- JSON config shape -----------------------------------------------

interface PhaseSurvival {
  kind: "survival";
  /** Mitigation request consequence string. */
  consequence: string;
  /** Player-facing message logged via ev.statusChange("revived", ...). */
  onMitigatedRevive: string;
  /** Fired when post-mitigation margin remains < 0. */
  endChargenOnFail: {
    kind: "retired" | "deceased";
    reason: string;
    withPension?: boolean;
  };
  /** If true and margin === 0 and the assignment is in the pathway's
   *  combatAssignments list, award Purple Heart and set injuredThisYear. */
  purpleHeartOnExactCombat?: boolean;
}

interface PhasePromotion {
  kind: "promotion";
  consequence: string;
  /** Declarative promotion verb (rank ladders + optional cap / skill). */
  onPass: PromoteVerb;
  /** When set, the phase is skipped unless the character's ACG division
   *  equals this value (scout: promotion is Bureaucracy-only, PM p. 56/59).
   *  The division name lives in JSON so no pathway/division string literal
   *  remains in the loader. */
  skipUnlessDivision?: string;
  /** If true, the phase reads & consumes acgState.nextPromotionPenalty. */
  consumeNextPromotionPenalty?: boolean;
  /** If true, append the (negative) penalty to the phase's log note. */
  logPenaltyInNote?: boolean;
}

interface PhaseDecoration {
  kind: "decoration";
  /** Used when margin is < 0 but > severe threshold. */
  consequenceMild: string;
  /** Used when margin is ≤ severe threshold (court-martial). */
  consequenceSevere: string;
  /** Margin threshold below (≤) which the severe consequence applies. */
  courtMartialMarginThreshold: number;
}

interface PhaseSkills {
  kind: "skills";
  consequence: string;
  /** Declarative skill-roll verb (column-selection strategy + table). */
  onPass: RollSkillVerb;
}

interface PhaseBonus {
  kind: "bonus";
  consequence: string;
  onPass: AwardCashBonusVerb;
}

export type PhaseConfig =
  | PhaseSurvival | PhasePromotion | PhaseDecoration | PhaseSkills | PhaseBonus;

export interface ResolveAssignmentConfig {
  /** Built-in pre-phase setup verb (survival↔decoration DM tradeoff);
   *  null/omitted skips. */
  preRun?: DmTradeoffPromptVerb | null;
  phases: PhaseConfig[];
  /** After-all-phases side-effect verb (combat ribbon, scout extra
   *  skill, merchant Route flag; always records assignment history). */
  finalize?: FinalizeVerb;
}

// --- Loader ----------------------------------------------------------

interface BuildContext {
  /** Look up combatAssignments for the pathway. Used by the survival
   *  phase's Purple Heart logic. Empty list if N/A. */
  combatAssignments: (ch: Character) => readonly string[];
}

/** Convert a JSON ResolveAssignmentConfig into a PathwaySpec the runner
 *  can execute. Every side effect is a declarative verb; an unknown verb
 *  kind throws at edition load (data ↔ interpreter drift surfaces here,
 *  not at run time). */
export function buildPathwaySpecFromConfig(
  config: ResolveAssignmentConfig,
  build: BuildContext,
): PathwaySpec {
  const phases = config.phases.map((p) => buildPhase(p, build));
  const spec: PathwaySpec = { phases };
  if (config.preRun) {
    const pr = config.preRun;
    requireVerbKind(pr, "dmTradeoffPrompt", "preRun");
    spec.preRun = (ctx) => runDmTradeoffPrompt(ctx, pr);
  }
  if (config.finalize) {
    const fin = config.finalize;
    requireVerbKind(fin, "finalize", "finalize");
    spec.finalize = (ctx) => runFinalize(ctx, fin, build);
  }
  return spec;
}

/** Fail loud at edition load when a JSON side-effect verb's kind doesn't
 *  match the interpreter the phase expects (the verb schema only checks
 *  that `verb` is a string). */
function requireVerbKind(v: { verb: string }, kind: string, where: string): void {
  if (v.verb !== kind) {
    throw new Error(
      `Unknown ${where} verb "${v.verb}" — expected "${kind}" ` +
      `(edition JSON ↔ interpreter drift).`,
    );
  }
}

function buildPhase(p: PhaseConfig, build: BuildContext): PhaseDef {
  switch (p.kind) {
    case "survival": return buildSurvival(p, build);
    case "promotion": return buildPromotion(p);
    case "decoration": return buildDecoration(p);
    case "skills": return buildSkills(p);
    case "bonus": return buildBonus(p);
  }
}

function buildSurvival(p: PhaseSurvival, build: BuildContext): PhaseDef {
  const base: PhaseDef = {
    phase: "survival",
    target: (ctx) => ctx.res.survival,
    dm: (ctx) => ctx.dms.survival,
    logRoll: (ctx, r) => ctx.ch.log(rollEv("Survival", r, ctx.res.survival, ctx.assignment)),
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "survival",
      rollValue: r.roll,
      dm: r.dm,
      target: targetOrZero(ctx.res.survival),
      margin: r.margin,
      consequence: p.consequence,
      onMitigated: (ch) => {
        ch.resumeActive();
        ch.log(reviveStatusChange(p.onMitigatedRevive));
      },
    }),
    onFail: (): PhaseFailResult => ({ endChargen: p.endChargenOnFail }),
  };
  if (p.purpleHeartOnExactCombat) {
    base.onExact = (ctx) => {
      if (typeof ctx.res.survival !== "number") return;
      const combat = build.combatAssignments(ctx.ch);
      if (!combat.includes(ctx.assignment)) return;
      const acg = ctx.ch.requireAcgState();
      acg.decorations.push("Purple Heart");
      ctx.ch.log(decorationEv("Purple Heart", `Wounded in ${ctx.assignment}`));
      acg.injuredThisYear = true;
    };
  }
  return base;
}

function buildPromotion(p: PhasePromotion): PhaseDef {
  requireVerbKind(p.onPass, "promote", "promotion.onPass");
  return {
    phase: "promotion",
    skip: (ctx) => {
      const acg = ctx.ch.requireAcgState();
      if (ctx.res.promotion === "none") return true;
      const division = "division" in acg ? acg.division : undefined;
      if (p.skipUnlessDivision !== undefined && division !== p.skipUnlessDivision) {
        return true;
      }
      if (acg.isOfficer && ctx.res.promotionOfficersBarred === true) return true;
      if (acg.isOfficer && acg.perTerm.promotedThisTerm) return true;
      return false;
    },
    target: (ctx) => ctx.res.promotion,
    dm: (ctx) => {
      const penalty = p.consumeNextPromotionPenalty
        ? (ctx.ch.requireAcgState().nextPromotionPenalty ?? 0)
        : 0;
      return (ctx.dms.promotion ?? 0) + penalty;
    },
    logRoll: (ctx, r) => {
      const penalty = p.consumeNextPromotionPenalty
        ? (ctx.ch.requireAcgState().nextPromotionPenalty ?? 0)
        : 0;
      const note = (p.logPenaltyInNote && penalty)
        ? `${ctx.assignment} — reprimand penalty ${penalty}`
        : ctx.assignment;
      ctx.ch.log(rollEv("Promotion", r, ctx.res.promotion, note));
      if (p.consumeNextPromotionPenalty && penalty < 0) {
        ctx.ch.requireAcgState().nextPromotionPenalty = 0;
      }
    },
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "promotion",
      rollValue: r.roll, dm: r.dm,
      target: targetOrZero(ctx.res.promotion),
      margin: r.margin,
      consequence: p.consequence,
    }),
    onPass: (ctx) => runPromote(ctx, p.onPass),
  };
}

function buildDecoration(p: PhaseDecoration): PhaseDef {
  return {
    phase: "decoration",
    skip: (ctx) => ctx.res.decoration === "none",
    target: (ctx) => ctx.res.decoration,
    dm: (ctx) => ctx.dms.decoration ?? 0,
    logRoll: (ctx, r) => ctx.ch.log(rollEv(
      "Decoration", r, ctx.res.decoration,
      `${ctx.assignment} (margin ${r.margin})`,
      /*marginIsSuccess*/ true,
    )),
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "decoration",
      rollValue: r.roll, dm: r.dm,
      target: targetOrZero(ctx.res.decoration),
      margin: r.margin,
      consequence: r.margin <= p.courtMartialMarginThreshold
        ? p.consequenceSevere
        : p.consequenceMild,
    }),
    onPass: (ctx, r) => applyDecorationResolution(ctx, r, p.courtMartialMarginThreshold),
    onFail: (ctx, r) => applyDecorationResolution(ctx, r, p.courtMartialMarginThreshold),
  };
}

function applyDecorationResolution(
  ctx: ResolveContext,
  r: { roll: number; margin: number },
  courtMartialThreshold: number,
): void {
  // r.margin is the EFFECTIVE margin (the phase runner folds any BP
  // mitigation in before invoking onPass/onFail).
  const tier = resolveDecorationTier(ctx.ch, r.margin);
  if (tier) {
    awardDecoration(ctx.ch, tier);
  } else if (r.margin <= courtMartialThreshold) {
    runCourtMartial(ctx.ch, ctx.assignment);
  }
}

function buildSkills(p: PhaseSkills): PhaseDef {
  requireVerbKind(p.onPass, "rollSkill", "skills.onPass");
  return {
    phase: "skills",
    skip: (ctx) => ctx.res.skills === "none",
    target: (ctx) => ctx.res.skills,
    dm: (ctx) => ctx.dms.skills,
    logRoll: (ctx, r) => ctx.ch.log(rollEv("Skills", r, ctx.res.skills, ctx.assignment)),
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "skills",
      rollValue: r.roll, dm: r.dm,
      target: targetOrZero(ctx.res.skills),
      margin: r.margin,
      consequence: p.consequence,
    }),
    onPass: (ctx) => runRollSkill(ctx, p.onPass),
  };
}

function buildBonus(p: PhaseBonus): PhaseDef {
  requireVerbKind(p.onPass, "awardCashBonus", "bonus.onPass");
  return {
    phase: "bonus",
    skip: (ctx) => bonusTargetOf(ctx) === "none",
    target: (ctx) => bonusTargetOf(ctx),
    dm: (ctx) => ctx.dms.bonus ?? 0,
    mitigation: (ctx, r): MitigationRequest => ({
      rollName: "bonus",
      rollValue: r.roll, dm: r.dm,
      target: typeof bonusTargetOf(ctx) === "number" ? (bonusTargetOf(ctx) as number) : 0,
      margin: r.margin,
      consequence: p.consequence,
    }),
    onPass: (ctx) => runAwardCashBonus(ctx, p.onPass),
  };
}

/** Read the bonus target carried on the synthesized AssignmentResolution.
 *  Merchant resolution doesn't have a built-in bonus field; the pathway
 *  glue stashes it on `res` via a typed extension. */
function bonusTargetOf(ctx: ResolveContext): import("./state").ResolutionTarget {
  const res = ctx.res as typeof ctx.res & { bonus?: import("./state").ResolutionTarget };
  if (res.bonus === undefined) warnBonusMissing(ctx.assignment);
  return res.bonus ?? "none";
}

const BONUS_MISSING_WARNED = new Set<string>();
function warnBonusMissing(assignment: string): void {
  if (BONUS_MISSING_WARNED.has(assignment)) return;
  BONUS_MISSING_WARNED.add(assignment);
  // Surface the misconfiguration once per assignment: the pathway's
  // JSON config declares a bonus phase, but resolution.bonus is
  // undefined. Either the JSON shouldn't list the phase, or the pathway
  // glue should populate res.bonus.
  console.warn(
    `[acg] bonus phase configured but resolution.bonus undefined for ` +
    `assignment "${assignment}" — phase will be skipped.`,
  );
}

// --- Verb interpreter: rollSkill -------------------------------------
//
// resolveAssignment skill rolls are declarative verbs, not named
// callbacks. `select` names the column-selection strategy; the strategy
// reuses the shared rollSkillFromColumn / serviceSkillColumnFor
// primitives. No pathway-name branch: each strategy runs only when the
// pathway's JSON declares it.

/** Minimal structural shape of a 1D skill table (rows keyed by die). */
interface SkillTableShape {
  columns?: string[];
  rows: Array<Record<string, unknown>>;
  dms?: StructuredDm[];
}

/** PM p. 63 per-column availability rule for a merchant skill table. */
interface MerchantColumnRule {
  allDepartments?: boolean;
  departments?: string[];
  exceptDepartments?: string[];
  minRank?: string;
}

interface MerchantSkillTableShape {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  columnAvailability?: Record<string, MerchantColumnRule>;
}

/** Declarative skill-roll verb. `select` picks the column-selection
 *  strategy; each strategy carries only the params it needs. */
export type RollSkillVerb =
  | { verb: "rollSkill"; select: "servicePolicy"; sourcePrefix: string }
  | { verb: "rollSkill"; select: "branchColumn" }
  | { verb: "rollSkill"; select: "divisionTable"; column: string }
  | { verb: "rollSkill"; select: "availableTables"; optionDomain: string };

/** The current character's pathway data block, read generically by
 *  pathway key (no per-pathway import). Fails loud if the edition omits
 *  the block the running pathway needs. */
function pathwayData(ch: Character): Record<string, unknown> {
  const acg = ch.requireAcgState();
  return requireRule(
    getAcgPathway(ch.editionId, acg.pathway) as Record<string, unknown> | undefined,
    `acg.${acg.pathway}`, "edition JSON",
  );
}

function runRollSkill(ctx: ResolveContext, verb: RollSkillVerb): void {
  switch (verb.select) {
    case "servicePolicy": return rollServicePolicySkill(ctx, verb.sourcePrefix);
    case "branchColumn": return rollBranchColumnSkill(ctx);
    case "divisionTable": return rollDivisionSkill(ctx, verb.column);
    case "availableTables": return rollAvailableTablesSkill(ctx, verb.optionDomain);
  }
}

interface ServicePolicyData {
  serviceSkills: SkillTableShape;
  skillColumnPolicy?: SkillColumnPolicy;
  assignmentReroutes?: { marines?: { toAssignment?: string } };
}

/** Mercenary Service Skills (PM p. 51): Marines on Ship's Troops roll the
 *  ship-troops column; interactive players pick across rank-eligible
 *  columns; otherwise the rank/duty default column applies. */
function rollServicePolicySkill(ctx: ResolveContext, sourcePrefix: string): void {
  const ch = ctx.ch;
  const data = pathwayData(ch) as unknown as ServicePolicyData;
  const acg = ch.requireAcgState();
  const pathway = acg.pathway;
  const roll = (c: Character, col: string) =>
    rollSkillFromColumn(c, data.serviceSkills, col, `${sourcePrefix} ${col}`);
  const shipsTroops = requireRule(
    data.assignmentReroutes?.marines?.toAssignment,
    `acg.${pathway}.assignmentReroutes.marines.toAssignment`, "PM p. 48",
  );
  if (branchOf(acg) === "Marines" && acg.currentAssignment === shipsTroops) {
    roll(ch, requireRule(
      data.skillColumnPolicy?.shipsTroopsColumn,
      `acg.${pathway}.skillColumnPolicy.shipsTroopsColumn`, "PM p. 51",
    ));
    return;
  }
  if (ch.choiceMode === "interactive") {
    const options = servicePolicyColumns(ch, data.skillColumnPolicy, pathway);
    if (options.length > 1) {
      ch.pickOrDefer({
        kind: "skillTable",
        label: "Choose a service-skills column to roll on",
        options,
        onResolve: (c, col) => roll(c, col),
      });
      return;
    }
  }
  roll(ch, serviceSkillColumnFor(ch, data.skillColumnPolicy));
}

/** Rank-eligible Service Skills columns (PM p. 51): branch Life column,
 *  the NCO column at/above the NCO rank, the officer command/staff column,
 *  plus Ship's Troops for Marines. */
function servicePolicyColumns(
  ch: Character, pol: SkillColumnPolicy | undefined, pathway: string,
): string[] {
  const policy = requireRule(pol, `acg.${pathway}.skillColumnPolicy`, "PM p. 51");
  const acg = ch.requireAcgState();
  const branch = branchOf(acg);
  const cols: string[] = [requireRule(
    policy.enlistedLowRankColumns[branch],
    `acg.${pathway}.skillColumnPolicy.enlistedLowRankColumns["${branch}"]`, "PM p. 51",
  )];
  if (!acg.isOfficer && rankNum(acg.rankCode) >= rankNum(policy.enlistedNcoMinRank)) {
    cols.push(policy.enlistedNcoColumn);
  }
  if (acg.isOfficer) cols.push(acg.inCommand ? policy.officerInCommand : policy.officerStaff);
  if (branch === "Marines") {
    cols.push(requireRule(
      policy.shipsTroopsColumn,
      `acg.${pathway}.skillColumnPolicy.shipsTroopsColumn`, "PM p. 51",
    ));
  }
  return cols;
}

/** Navy Branch Skills (PM p. 52): the branch's own column with the
 *  line↔crew alias fallbacks. */
function rollBranchColumnSkill(ctx: ResolveContext): void {
  const ch = ctx.ch;
  const data = pathwayData(ch) as unknown as { branchSkills?: SkillTableShape };
  if (!data.branchSkills) return;
  const branch = requireNavyBranch(ch);
  rollSkillFromColumn(
    ch, data.branchSkills, { candidates: branchSkillCandidates(labelToColumnKey(branch)) },
    `Navy ${branch} branch skills`,
  );
}

function requireNavyBranch(ch: Character): string {
  const branch = branchOf(ch.requireAcgState());
  if (!branch) {
    throw new Error(
      "Navy branch is unset — enlistment must assign a branch before " +
      "branch-keyed rolls (PM p. 52)",
    );
  }
  return branch;
}

/** Scout skill tables (PM p. 57): keyed by division. `"first"` scans the
 *  first non-empty office column; a named column (e.g. adminRank) rolls
 *  that column, failing loud if the division table lacks it. */
function rollDivisionSkill(ctx: ResolveContext, column: string): void {
  const ch = ctx.ch;
  const data = pathwayData(ch) as unknown as { skillTables: Record<string, SkillTableShape> };
  const division = ch.requireScoutAcg().division;
  const table = data.skillTables[division]!;
  if (column === "first") {
    rollSkillFromColumn(ch, table, "first", (col) => `Scout ${division} ${col}`);
    return;
  }
  if (!table.columns?.includes(column)) {
    throw new Error(
      `Scout ${division} skill table lacks column "${column}" (PM p. 57 ` +
      "Special/Wartime Mission extra skill) — fix the edition JSON rather " +
      "than silently substituting the normal column.",
    );
  }
  rollSkillFromColumn(ch, table, column, `Scout ${column}`);
}

/** Merchant skill tables (PM p. 63): pick an available table (round-robin
 *  by year, or interactive), then an available column within it. */
function rollAvailableTablesSkill(ctx: ResolveContext, domain: string): void {
  const ch = ctx.ch;
  const data = pathwayData(ch) as unknown as { skillTables: Record<string, MerchantSkillTableShape> };
  const tables = optionDomain(ch.editionId, domain).values
    .filter((k) => merchantAvailableColumns(ch, data.skillTables[k]!).length > 0);
  if (tables.length === 0) return;
  if (ch.choiceMode === "interactive" && tables.length > 1) {
    ch.pickOrDefer({
      kind: "merchantSkillTable",
      label: "Merchant: choose which skill table to roll on this year.",
      options: tables,
      optionLabels: tables.map(titleize),
      onResolve: (c, key) => merchantRollFromTable(c, key),
    });
    return;
  }
  const tableKey = tables[(ch.requireAcgState().year - 1) % tables.length]!;
  merchantRollFromTable(ch, tableKey);
}

function merchantRollFromTable(ch: Character, tableKey: string): void {
  const data = pathwayData(ch) as unknown as { skillTables: Record<string, MerchantSkillTableShape> };
  const table = data.skillTables[tableKey];
  if (!table) return;
  const columns = merchantAvailableColumns(ch, table);
  if (columns.length === 0) return;
  if (ch.choiceMode === "interactive" && columns.length > 1) {
    ch.pickOrDefer({
      kind: "merchantSkillColumn",
      label: `Merchant: choose a skill column from the ${tableKey} table.`,
      options: columns,
      optionLabels: columns.map(titleize),
      onResolve: (c, col) => rollMerchantColumn(c, tableKey, col),
    });
    return;
  }
  rollMerchantColumn(ch, tableKey, columns[0]!);
}

function rollMerchantColumn(ch: Character, tableKey: string, column: string): void {
  const data = pathwayData(ch) as unknown as { skillTables: Record<string, MerchantSkillTableShape> };
  const table = data.skillTables[tableKey];
  if (!table) return;
  rollSkillFromColumn(ch, table, column, `Merchant ${tableKey} ${column}`);
}

/** Columns of `table` available to the character (PM p. 63 availability
 *  notes). A column with no availability entry is unavailable; a table
 *  with no availability metadata is broken edition data (fail loud). */
function merchantAvailableColumns(ch: Character, table: MerchantSkillTableShape): string[] {
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
  return cols.filter((c) => merchantColumnAvailable(avail[c], dept, pctx));
}

function merchantColumnAvailable(
  rule: MerchantColumnRule | undefined,
  dept: string,
  pctx: PredicateContext,
): boolean {
  if (!rule) return false;
  if (rule.departments && !rule.departments.includes(dept)) return false;
  if (rule.exceptDepartments && rule.exceptDepartments.includes(dept)) return false;
  if (rule.minRank && !evaluatePredicate({ rankAtLeast: rule.minRank }, pctx)) return false;
  return true;
}

// --- Verb interpreter: promote ---------------------------------------
//
// Advance the character one step up the pathway's rank ladder (officer or
// enlisted), reusing the shared applyPromotion. Optional params carry the
// navy per-fleet officer cap and the scout per-promotion skill grant.

/** One rank-ladder row: [code, title, ...extra]. */
type LadderRow = readonly [string, string, ...unknown[]];

export interface PromoteVerb {
  verb: "promote";
  /** Data keys of the officer / enlisted rank ladders (data.ranks[key]). */
  ladders: { officer: string; enlisted: string };
  /** Navy: officers cap at data[capByFleet][fleet] (PM p. 55). */
  capByFleet?: string;
  /** Scout: each promotion grants a division-table skill (PM p. 57). */
  onPromoteSkill?: {
    select: "divisionTable";
    columnByRank: { officer: string; enlisted: string };
  };
}

function runPromote(ctx: ResolveContext, verb: PromoteVerb): void {
  const ch = ctx.ch;
  const acg = ch.requireAcgState();
  const data = pathwayData(ch) as { ranks: Record<string, LadderRow[]> };
  const ladder = data.ranks[acg.isOfficer ? verb.ladders.officer : verb.ladders.enlisted]!;
  const opts: { cap?: number; onPromote?: (ch: Character) => void } = {};
  if (verb.capByFleet && acg.isOfficer) {
    const caps = requireRule(
      (pathwayData(ch) as Record<string, unknown>)[verb.capByFleet] as
        Record<string, number> | undefined,
      `acg.navy.${verb.capByFleet}`, "PM p. 55",
    );
    opts.cap = requireRule(
      caps[ch.requireNavyAcg().fleet],
      `acg.navy.${verb.capByFleet}.${ch.requireNavyAcg().fleet}`, "PM p. 55",
    );
  }
  const skill = verb.onPromoteSkill;
  if (skill) {
    opts.onPromote = () => rollDivisionSkill(
      ctx, acg.isOfficer ? skill.columnByRank.officer : skill.columnByRank.enlisted,
    );
  }
  applyPromotion(ch, ladder, Object.keys(opts).length ? opts : undefined);
}

// --- Verb interpreter: finalize --------------------------------------
//
// After-all-phases side effect. Every variant records the assignment in
// history; optional params add the pathway-declared extras (combat
// ribbon, scout Special/War-mission extra skill, merchant Route flag).
// No pathway-name branch: each add-on runs only when the pathway's JSON
// declares it.

export interface FinalizeVerb {
  verb: "finalize";
  /** Combat pathways (mercenary/navy): Combat Ribbon (+Command Cluster in
   *  command) for a combat assignment, then record the assignment (PM
   *  p. 51/55). combatFinalize records history itself. */
  combatRibbon?: boolean;
  /** Scout: Special/Wartime missions grant an extra division-table skill
   *  (PM p. 57). `columnRule` names the pathway data block carrying the
   *  per-division column map. */
  extraSkill?: { onAssignments: string[]; columnRule: string };
  /** Merchant: flag a matching assignment this term for the enlisted
   *  commission exam (PM p. 61). */
  flagRouteThisTerm?: { onAssignment: string };
}

function runFinalize(ctx: ResolveContext, verb: FinalizeVerb, build: BuildContext): void {
  if (verb.combatRibbon) {
    combatFinalize(ctx, build.combatAssignments(ctx.ch));
    return;
  }
  const acg = ctx.ch.requireAcgState();
  const extra = verb.extraSkill;
  if (extra && extra.onAssignments.includes(ctx.assignment)) {
    runFinalizeDivisionSkill(ctx, extra.columnRule);
  }
  acg.assignmentHistory.push(ctx.assignment);
  const route = verb.flagRouteThisTerm;
  if (route && ctx.assignment === route.onAssignment) {
    acg.perTerm.routeAssignmentThisTerm = true;
  }
}

/** Scout Special/Wartime-mission extra skill (PM p. 57): read the per-
 *  division column from `columnRule`; a null column routes to the normal
 *  office-column ("first") roll, a named column rolls that column. */
function runFinalizeDivisionSkill(ctx: ResolveContext, columnRule: string): void {
  const rule = requireRule(
    (pathwayData(ctx.ch) as Record<string, unknown>)[columnRule] as
      { columnByDivision: Record<string, string | null> } | undefined,
    `acg.scout.${columnRule}`, "PM p. 57",
  );
  const division = ctx.ch.requireScoutAcg().division;
  const column = rule.columnByDivision[division];
  if (column === undefined) {
    throw new Error(
      `acg.scout.${columnRule}.columnByDivision lacks "${division}" (PM p. 57)`,
    );
  }
  rollDivisionSkill(ctx, column === null ? "first" : column);
}

// --- Verb interpreter: awardCashBonus --------------------------------
//
// In-service cash bonus (PM p. 60): roll 1D on a basic-career service's
// muster-cash table and award the amount divided by `divisor` (the
// printed rule is half). Service + table + divisor are declared on the
// verb; the clamp range derives from the table's declared row indices.

export interface AwardCashBonusVerb {
  verb: "awardCashBonus";
  /** Basic-career service whose muster table supplies the bonus. */
  service: string;
  /** Muster sub-table to roll on (currently "musterCash"). */
  fromTable: string;
  /** Divide the rolled amount by this (the printed rule is half). */
  divisor: number;
}

function runAwardCashBonus(ctx: ResolveContext, verb: AwardCashBonusVerb): void {
  const ch = ctx.ch;
  if (verb.fromTable !== "musterCash") {
    throw new Error(
      `awardCashBonus.fromTable must be "musterCash" (PM p. 60); got ` +
      `"${verb.fromTable}".`,
    );
  }
  const table = ch.editionService(verb.service as never).musterCash;
  const indices = Object.keys(table).map(Number);
  const rawRoll = clampedRoll(ch, 1, 0, Math.min(...indices), Math.max(...indices));
  const fullAmount = requireRule(
    table[rawRoll], `${verb.service} ${verb.fromTable}[${rawRoll}]`,
    "PM p. 60 in-service bonus",
  );
  const cash = Math.floor(fullAmount / verb.divisor);
  if (cash <= 0) return;
  ch.credits += cash;
  ch.muster.musterLog.push(`Cr${cash} bonus (in-service)`);
  ch.log(ev.musterCash(cash, rawRoll, 0, "Merchant in-service bonus (half)"));
}

// --- Event helpers ---------------------------------------------------

// Wrappers around the typed event constructors. Inline lazy-require so
// the loader module doesn't bring in the entire history module at type-
// check time on a hot import path.
/** Construct a roll event. `marginIsSuccess`: decoration rolls log
 *  "success" any time margin >= 0 (failure just yields no decoration);
 *  other phases use the raw pass/fail flag. */
function rollEv(
  name: string,
  r: { roll: number; margin: number; success: boolean; dm: number },
  resolutionTarget: import("./state").ResolutionTarget,
  context: string,
  marginIsSuccess = false,
): HistoryEvent {
  return ev.roll(
    name, r.roll, r.dm,
    typeof resolutionTarget === "number" ? resolutionTarget : 0,
    marginIsSuccess ? r.margin >= 0 : r.success,
    context,
  );
}

function decorationEv(award: "MCUF" | "MCG" | "SEH" | "Purple Heart", reason?: string) {
  return ev.decoration(award, reason);
}

function reviveStatusChange(note: string) {
  return ev.statusChange("revived", note);
}

function targetOrZero(t: import("./state").ResolutionTarget): number {
  return typeof t === "number" ? t : 0;
}

// --- Verb interpreter: dmTradeoffPrompt ------------------------------
//
// PM p. 49 survival↔decoration DM tradeoff. In interactive mode, prompt
// the player to trade DM between two rolls: rollA is credited the chosen
// DM, rollB the equal opposite. Bounds come from acg.common[boundsRule].
// Fires before any phase rolls; both mercenary and navy declare it.

type TradeoffRoll = "survival" | "decoration";

export interface DmTradeoffPromptVerb {
  verb: "dmTradeoffPrompt";
  /** Key under acg.common holding the { min, max, step } option bounds. */
  boundsRule: string;
  /** Roll credited the chosen DM (survival). */
  rollA: TradeoffRoll;
  /** Roll credited the equal, opposite DM (decoration). */
  rollB: TradeoffRoll;
}

function runDmTradeoffPrompt(ctx: ResolveContext, verb: DmTradeoffPromptVerb): void {
  if (ctx.ch.choiceMode !== "interactive") return;
  if (ctx.res[verb.rollB] === "none") return;
  if (typeof ctx.res[verb.rollA] !== "number" || typeof ctx.res[verb.rollB] !== "number") return;
  // PM p. 49 declares the tradeoff; the +/-2 option bounds are declared in
  // acg.common[boundsRule] (a documented design choice — the book states
  // no cap).
  const bounds = requireRule(
    getEdition(ctx.ch.editionId).data.advancedCharacterGeneration
      ?.common?.[verb.boundsRule] as { min: number; max: number; step: number } | undefined,
    `acg.common.${verb.boundsRule}`, "PM p. 49",
  );
  const values: number[] = [];
  for (let dm = bounds.min; dm <= bounds.max; dm += bounds.step) values.push(dm);
  // Each value is the rollA delta; rollB takes the opposite sign
  // (combatResolutionDms applies +strategy / -strategy).
  const options = values.map((dm) => dm === 0
    ? "No tradeoff"
    : `${dm > 0 ? "+" : ""}${dm} ${verb.rollA} / ${dm < 0 ? "+" : ""}${-dm} ${verb.rollB}`);
  ctx.ch.pickOrDefer({
    kind: "decorationDmTradeoff",
    label:
      "Survival ↔ decoration DM tradeoff. Trade DM points between the " +
      "survival roll and the decoration roll: a negative survival DM " +
      "buys an equal positive decoration DM (or vice versa). Pick the " +
      "balance for this assignment.",
    options,
    onResolve: (ch, choice) => {
      const idx = options.indexOf(choice);
      const strategy = values[idx] ?? 0;
      // ctx.dms was computed before this prompt resolved, with the
      // character's PRIOR strategy (0 in year 1; last year's pick later in
      // the term) already folded in by combatResolutionDms. Replace that
      // contribution with the fresh pick so the phase rolls see the DM the
      // player just chose.
      const prior = ch.requireAcgState().decorationDmStrategy;
      adjustDm(ctx.dms, verb.rollA, strategy - prior);
      adjustDm(ctx.dms, verb.rollB, -(strategy - prior));
      ch.requireAcgState().decorationDmStrategy = strategy;
    },
  });
}

/** Add `delta` to a tradeoff roll's accumulated DM (absent → 0). */
function adjustDm(dms: ResolveContext["dms"], roll: TradeoffRoll, delta: number): void {
  dms[roll] = (dms[roll] ?? 0) + delta;
}
