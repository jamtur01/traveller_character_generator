// Shared pathway plumbing. Each ACG pathway needs the same four
// helpers around its PathwaySpec: lazy-built per-edition cache,
// cache-purge for tests / hot-reload, eager validation at edition load,
// and the cache lookup. The shapes are identical — only the pathway
// key, callback registry, and combatAssignments accessor differ. This
// module factors the boilerplate into createPathwaySpecRegistry; each
// pathway then wires its specifics in ~5 lines instead of ~30.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { parseDieCount, requireRule } from "@/lib/traveller/editions/strict";
import type { PathwaySpec, ResolveContext } from "@/lib/traveller/engine/acg/phaseRunner";
import {
  buildPathwaySpecFromConfig,
  type ResolveAssignmentConfig,
} from "@/lib/traveller/engine/acg/jsonPhases";
import {
  applyDmRules, applyStructuredDms, columnDmFor, parseResolutionTarget,
  type StructuredDm,
} from "@/lib/traveller/engine/acg/tables";
import { applyAcgSkillCell } from "@/lib/traveller/engine/acg/skills";
import { event as ev } from "@/lib/traveller/history";
import { rankNum } from "@/lib/traveller/engine/predicate";
import type { AcgState } from "@/lib/traveller/engine/acg/state";
import { evaluateDM } from "@/lib/traveller/engine/dmEvaluator";
import type { DMRule } from "@/lib/traveller/editions/types";

/** Thrown by a pathway enlistment gate when the character cannot enlist on
 *  the chosen path for a rules/config reason the player can act on — a
 *  disallowed combat arm, an unmet starport/tech gate, an unknown line type,
 *  or a rejected draft. The ACG model (chargen/models/acg.ts) catches ONLY
 *  this, routing it to a failed-enlistment "retired" outcome; requireRule
 *  failures and unexpected engine errors propagate so broken edition JSON and
 *  bugs fail loudly instead of masquerading as a normally retired character. */
export class EnlistmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnlistmentValidationError";
  }
}

interface PathwayRegistryOptions<TData> {
  /** Key under `advancedCharacterGeneration` in edition JSON
   *  ("mercenary", "navy", "scout", "merchantPrince"). */
  pathwayKey: string;
  /** Read combat-assignment names from the pathway's data block. Empty
   *  array for pathways that don't have a Purple Heart phase. */
  combatAssignments: (data: TData) => readonly string[];
}

export interface PathwayRegistry {
  /** Get the cached PathwaySpec for this character's edition, building
   *  on first access. Throws if the edition declares the pathway but
   *  omits the resolveAssignment config. */
  get(ch: Character): PathwaySpec;
  /** Build and discard the spec for an edition to surface missing
   *  callback names / malformed phase configs at edition load instead
   *  of at first ACG run. No-op if the edition doesn't declare this
   *  pathway or omits resolveAssignment. */
  validate(editionId: string): void;
}

export function createPathwaySpecRegistry<TData>(
  opts: PathwayRegistryOptions<TData>,
): PathwayRegistry {
  const cache = new Map<string, PathwaySpec>();

  function dataForEdition(editionId: string):
    (TData & { resolveAssignment?: ResolveAssignmentConfig }) | undefined {
    // The pathway key is generic over TData; AcgData's index signature
    // yields `unknown`, so the cast to TData is the type-system bridge
    // for the per-pathway registry's generic parameterization.
    const acg = getEdition(editionId).data.advancedCharacterGeneration;
    return acg?.[opts.pathwayKey] as
      (TData & { resolveAssignment?: ResolveAssignmentConfig }) | undefined;
  }

  return {
    get(ch) {
      let spec = cache.get(ch.editionId);
      if (spec) return spec;
      const data = dataForEdition(ch.editionId);
      if (!data?.resolveAssignment) {
        throw new Error(
          `Edition "${ch.editionId}" ${opts.pathwayKey} block is missing ` +
          `resolveAssignment config — add it to ` +
          `data/editions/${ch.editionId}.json`,
        );
      }
      spec = buildPathwaySpecFromConfig(data.resolveAssignment, {
        combatAssignments: (c) => {
          const d = dataForEdition(c.editionId);
          return d ? opts.combatAssignments(d) : [];
        },
      });
      cache.set(ch.editionId, spec);
      return spec;
    },
    validate(editionId) {
      const data = dataForEdition(editionId);
      if (!data?.resolveAssignment) return;
      buildPathwaySpecFromConfig(data.resolveAssignment, {
        combatAssignments: () => opts.combatAssignments(data),
      });
    },
  };
}

/** Per-term reset for pathways that participate in combat assignments
 *  (mercenary, navy). injuredThisYear is a per-year flag cleared as a
 *  safety net; decorationDmStrategy is the player's per-assignment
 *  survival↔decoration tradeoff choice and must not leak across terms. */
export function resetCombatTermFlags(ch: Character): void {
  if (!ch.acgState) return;
  ch.acgState.injuredThisYear = false;
  ch.acgState.decorationDmStrategy = 0;
}

/** Shared finalize for the two combat pathways (mercenary, navy): award a
 *  Combat Ribbon for a combat assignment (+ a Command Cluster if the
 *  officer was in command), then record the assignment in history. */
export function combatFinalize(
  ctx: ResolveContext, combatAssignments: readonly string[],
): void {
  const acg = ctx.ch.requireAcgState();
  if (combatAssignments.includes(ctx.assignment)) {
    acg.combatRibbons += 1;
    ctx.ch.log(ev.decoration("Combat Ribbon", `for ${ctx.assignment}`));
    if (acg.inCommand && acg.isOfficer) {
      acg.commandClusters += 1;
      ctx.ch.log(ev.decoration("Command Cluster", `command of ${ctx.assignment}`));
    }
  }
  acg.assignmentHistory.push(ctx.assignment);
}

/** Per-phase resolution DMs for the two combat pathways. decorationDmStrategy
 *  is the player's survival↔decoration tradeoff (PM p. 49 poltroonery): a
 *  positive value trades decoration DM for survival DM (cowardice), a
 *  negative value the reverse (heroism). */
export function combatResolutionDms(
  ch: Character, resTable: { dms?: StructuredDm[] },
): { survival: number; decoration: number; promotion: number; skills: number } {
  const decStrategy = ch.requireAcgState().decorationDmStrategy;
  return {
    survival: applyDmRules(resTable.dms, ch, "survival") + decStrategy,
    decoration: applyDmRules(resTable.dms, ch, "decoration") - decStrategy,
    promotion: applyDmRules(resTable.dms, ch, "promotion"),
    skills: applyDmRules(resTable.dms, ch, "skills"),
  };
}

/** Officer command-duty roll shared by the two combat pathways (mercenary,
 *  navy): look up the character's role row, honor an "auto"/"none" cell, else
 *  roll 2D + `dm` vs the parsed target, log it, and set inCommand. The caller
 *  supplies the role value (combat arm / branch), the cell key (per-service
 *  vs "target"), and the pre-summed DM (applyDmRules vs applyStructuredDms).
 *  Missing row or non-numeric target → not in command. */
export function resolveCommandDuty(
  ch: Character,
  opts: { rows: ReadonlyArray<Record<string, unknown>>; role: string; cellKey: string; dm: number },
): void {
  const row = opts.rows.find((r) => r.branch === opts.role);
  if (!row) { ch.requireAcgState().inCommand = false; return; }
  const parsed = parseResolutionTarget(row[opts.cellKey]);
  if (parsed.target === "auto") { ch.requireAcgState().inCommand = true; return; }
  if (typeof parsed.target !== "number") { ch.requireAcgState().inCommand = false; return; }
  const r = ch.rng.roll(2);
  const success = r + opts.dm >= parsed.target;
  ch.log(ev.commandDuty(success, r, opts.dm, parsed.target));
  ch.requireAcgState().inCommand = success;
}

/** One rank-ladder row: [code, title, ...extra]. */
type RankRow = readonly [string, string, ...unknown[]];

/** Advance one step up a rank ladder. Returns the next row if `currentCode`
 *  is on the ladder and below `cap` (a 1-based rank count — navy fleets cap
 *  officer rank), else null (already at top, capped, or not found). */
export function advanceRankRow(
  ladder: readonly RankRow[], currentCode: string, cap?: number,
): RankRow | null {
  const idx = ladder.findIndex((r) => r[0] === currentCode);
  if (idx < 0) return null;
  const targetIdx = cap !== undefined ? Math.min(idx + 1, cap - 1) : idx + 1;
  if (targetIdx <= idx || targetIdx >= ladder.length) return null;
  return ladder[targetIdx] ?? null;
}

export interface SpecialAssignmentTable {
  dms?: StructuredDm[];
  rows: Array<Record<string, unknown>>;
}

/** Roll on a pathway's Special Assignments table (officer/enlisted column),
 *  applying the OCS over-age reroll + waiver rule (PM p. 51/54). Returns the
 *  resolved assignment name, or null if a roll hit an empty cell (or an
 *  over-age OCS reroll also failed to yield a school). */
export function rollSpecialAssignment(
  ch: Character, table: SpecialAssignmentTable, ocsAgeLimit: number | undefined,
): string | null {
  const dm = applyStructuredDms(table.dms, ch);
  const col = ch.requireAcgState().isOfficer ? "officer" : "enlisted";
  const rollOnce = (): string | null => {
    const v = rollDieRow(ch, table, { dice: 1, dm })?.[col];
    return typeof v === "string" ? v : null;
  };
  let sa = rollOnce();
  if (!sa) return null;
  if (sa === "OCS" && ocsAgeLimit !== undefined && ch.age > ocsAgeLimit) {
    const reroll = rollOnce();
    if (reroll === "OCS") {
      ch.log(ev.statusChange(
        "ocsWaiver", `over age ${ocsAgeLimit}, waiver granted on reroll`,
      ));
    } else if (reroll) {
      sa = reroll;
    } else {
      return null;
    }
  }
  return sa;
}

/** The reenlistment roll that forces a mandatory extra term, per the
 *  edition's rules.reenlistment.mandatoryOnExactRoll (PM p. 17 / TTB p. 18).
 *  Undefined when the edition declares no such rule. */
export function mandatoryReenlistRoll(ch: Character): number | undefined {
  return getEdition(ch.editionId).rules.reenlistment?.mandatoryOnExactRoll;
}

/** Shared reenlist skeleton: roll 2D + structured DMs vs `target`, log the
 *  outcome, and on a pass (or a mandatory natural 12) run `onContinue` — the
 *  pathway's role-change offer. Returns true if the character keeps serving. */
export function runReenlist(
  ch: Character,
  opts: { target: number; dms?: StructuredDm[]; label: string; onContinue: () => void },
): boolean {
  const dm = applyStructuredDms(opts.dms, ch);
  const r = ch.rng.roll(2);
  const mandatory = mandatoryReenlistRoll(ch);
  const isMandatory = mandatory !== undefined && r === mandatory;
  const keep = isMandatory || r + dm >= opts.target;
  ch.log(ev.roll("Reenlistment", r, dm, opts.target, keep, opts.label));
  if (isMandatory) {
    ch.enterMandatoryReenlist();
    opts.onContinue();
    return true;
  }
  if (keep) opts.onContinue();
  return keep;
}

/** Shared reenlist-time role-change prompt (combat arm / branch / department).
 *  Skips in auto mode or when only the current role is eligible; otherwise
 *  queues a cascade choice and applies a non-current pick via `apply`. The
 *  caller supplies the pathway-specific eligible-options list. */
export function offerRoleChange(
  ch: Character,
  opts: {
    current: string;
    options: readonly string[];
    label: string;
    context: Record<string, unknown>;
    apply: (ch: Character, chosen: string) => void;
  },
): void {
  if (ch.choiceMode === "auto" || opts.options.length <= 1) return;
  ch.pickOrDefer({
    kind: "cascade",
    label: opts.label,
    options: opts.options,
    preferred: [opts.current],
    context: opts.context,
    onResolve: (ch, chosen) => {
      if (chosen !== opts.current) opts.apply(ch, chosen);
    },
  });
}

/** Roll `dice`d6, add `dm`, and clamp to a table's die-row range [lo, hi].
 *  The one dice-clamp helper for assignment / skill / muster rolls. */
export function clampedRoll(
  ch: Character, dice: number, dm: number, lo: number, hi: number,
): number {
  return Math.max(lo, Math.min(hi, ch.rng.roll(dice) + dm));
}

/** A die-keyed JSON table: every row carries a `die` (the 1-based roll
 *  index) plus per-column cell values. */
interface DieKeyedTable {
  rows: ReadonlyArray<Record<string, unknown>>;
}

/** Die-row bounds of a die-keyed table: the min/max `die` its rows
 *  declare. The clamp range for a table roll is a property of the JSON
 *  table's shape, never a call-site literal — deriving it here keeps
 *  the edition JSON the single source of truth for row spans. */
export function dieRowBounds(table: DieKeyedTable): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of table.rows) {
    const d = row.die;
    if (typeof d !== "number") continue;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  if (!Number.isFinite(lo)) {
    throw new Error("die-keyed table declares no numeric die rows");
  }
  return { lo, hi };
}

/** Roll `dice`d6 + `dm`, clamp to the table's die-row bounds (or an explicit
 *  [lo, hi] override for natural-range clamps like 2D 2..12), and return the
 *  row whose `die` equals the result (or undefined when the table has no such
 *  row). This is the one clampedRoll-plus-`rows.find(r => r.die === roll)`
 *  primitive that every die-keyed ACG table read repeats. Callers keep
 *  ownership of the DM source, the cell read, and the miss policy (silent /
 *  default / throw). */
export function rollDieRow(
  ch: Character, table: DieKeyedTable,
  opts: { dice: number; dm: number; lo?: number; hi?: number },
): Record<string, unknown> | undefined {
  const bounds = opts.lo === undefined || opts.hi === undefined
    ? dieRowBounds(table) : { lo: opts.lo, hi: opts.hi };
  const r = clampedRoll(ch, opts.dice, opts.dm, bounds.lo, bounds.hi);
  return table.rows.find((row) => row.die === r);
}

/** rollDieRow that throws on a table miss, with the rolled die in the message
 *  — for the assignment / MOS lookups that surface the die in their diagnostic
 *  (mercenary MOS + assignment, navy assignment). */
export function rollDieRowOrThrow(
  ch: Character, table: DieKeyedTable,
  opts: { dice: number; dm: number; lo?: number; hi?: number }, tableName: string,
): Record<string, unknown> {
  const bounds = opts.lo === undefined || opts.hi === undefined
    ? dieRowBounds(table) : { lo: opts.lo, hi: opts.hi };
  const r = clampedRoll(ch, opts.dice, opts.dm, bounds.lo, bounds.hi);
  const row = table.rows.find((row) => row.die === r);
  if (!row) throw new Error(`${tableName} table missing row for die=${r}`);
  return row;
}

/** How a skill roll resolves its column. A plain string is a fixed column
 *  (used for both the per-column DM and the cell read). `{ candidates }`
 *  computes the DM on `candidates[0]` and reads the first candidate whose
 *  cell is a string (navy/schools line↔crew aliasing). `"first"` uses the
 *  first non-`die` column for the DM and reads the first non-`die` column
 *  whose cell is a string (scout skill tables). */
export type SkillColumn = string | { candidates: string[] } | "first";

/** A 1D skill table: rows keyed by `die`, optional per-column `dms`, and an
 *  optional `columns` list (needed only for the `"first"` scan). */
interface SkillRollTable extends DieKeyedTable {
  columns?: readonly string[];
  dms?: StructuredDm[];
}

/** The 1D-skill-roll-from-a-column ritual shared by every MT ACG pathway and
 *  the school module (PM pp. 50-59): sum the column-scoped DMs, roll 1D
 *  clamped to the table's die-row bounds, find the die row, and apply the
 *  resolved skill cell via applyAcgSkillCell. `column` selects the
 *  column-resolution shape; `source` is the history attribution — a fixed
 *  string, or a function of the matched column for tables whose label names
 *  the column that hit. A row miss or a non-string cell is a silent no-op,
 *  matching every original site. */
export function rollSkillFromColumn(
  ch: Character, table: SkillRollTable, column: SkillColumn,
  source: string | ((matchedCol: string) => string),
): void {
  const candidates = column === "first"
    ? (table.columns ?? []).filter((c) => c !== "die")
    : typeof column === "string" ? [column] : column.candidates;
  const dmCol = candidates[0] ?? "";
  const dm = columnDmFor(table.dms, dmCol, ch);
  const row = rollDieRow(ch, table, { dice: 1, dm });
  if (!row) return;
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === "string") {
      applyAcgSkillCell(ch, v, typeof source === "function" ? source(c) : source);
      return;
    }
  }
}

/** Column-candidate list for a branch-skill roll: the branch's own column,
 *  plus the line↔crew alias fallbacks (line and crew share a "lineCrew"
 *  column). Shared by navy branch skills and school branch skills so the
 *  aliasing can't drift between the two sites. */
export function branchSkillCandidates(col: string): string[] {
  return [col, col === "line" ? "lineCrew" : col, col === "crew" ? "lineCrew" : col];
}

/** The service branch of the two branch-carrying pathways (mercenary, navy);
 *  "" for pathways without a branch. The single cross-variant branch read used
 *  by the branch-skill column lookups (schools + service-skill column). */
export function branchOf(acg: AcgState): string {
  return (acg.pathway === "mercenary" || acg.pathway === "navy") ? acg.branch : "";
}

/** ACG enlistment roll+log shared by mercenary/navy/scout: sum the spec's DMs
 *  (Character satisfies DmContext, so pass ch directly), roll 2D, log the
 *  attempt, and return whether it met the target. The divergent
 *  success/draft/rank tails stay in each caller. */
export function rollAcgEnlistment(
  ch: Character, spec: { target: number; dms?: DMRule[] }, label: string,
): boolean {
  const dm = evaluateDM(spec.dms, ch);
  const r = ch.rng.roll(2);
  const succeeded = r + dm >= spec.target;
  ch.log(ev.enlistmentAttempt(label, r, dm, spec.target, succeeded));
  return succeeded;
}

/** Commit an enlist/draft-time starting rank: stamp acg.rankCode and derive
 *  acg.isOfficer from the ACG rank-code notation — a leading "O" marks an
 *  officer rung (O1, O2, …); any other prefix (E1, …) is enlisted (PM p.
 *  51/55). The one starting-rank commit shared by every ACG pathway, so the
 *  officer/enlisted split can never drift from the rank code it is read off. */
export function commitStartingRank(ch: Character, rankCode: string): void {
  const acg = ch.requireAcgState();
  acg.rankCode = rankCode;
  acg.isOfficer = rankCode.startsWith("O");
}

/** A pathway's enlist-failure draft table (PM p. 50/52/56): the die to roll
 *  and the roll → drafted-role map, both JSON. */
export interface DraftTable {
  die: string;
  results: Record<string, string>;
}

/** Resolve a failed enlistment via the pathway's JSON draft table (PM p.
 *  50/52/56): roll draftTable.die, look the result up in draftTable.results,
 *  and on an off-table roll run the optional `onReject` (a pathway's pre-throw
 *  log) then throw EnlistmentValidationError(rejectionMessage) — the one
 *  outcome the ACG model routes to a failed-enlistment retirement. On a hit,
 *  flag ch.drafted and hand the drafted-role string to `onResult`, which maps
 *  it to the pathway's service/branch/fleet and commits the drafted rank. The
 *  roll + lookup + reject skeleton is identical across pathways; only the
 *  role-mapping tail differs, so it stays a caller callback rather than more
 *  pathway=== branching here. */
export function resolveDraft(
  ch: Character,
  draftTable: DraftTable,
  opts: {
    rejectionMessage: string;
    onResult: (draftedRole: string) => void;
    onReject?: () => void;
  },
): void {
  const roll = ch.rng.roll(parseDieCount(draftTable.die, "acg enlistment draft.die"));
  const draftedRole = draftTable.results[String(roll)];
  if (draftedRole === undefined) {
    opts.onReject?.();
    throw new EnlistmentValidationError(opts.rejectionMessage);
  }
  ch.drafted = true;
  opts.onResult(draftedRole);
}

/** Clear the one-shot retained-assignment flags. Only navy sets them (its
 *  Retention rule); the other pathways' per-year "retention" is this no-op. */
export function clearRetention(ch: Character): void {
  if (!ch.acgState) return;
  ch.acgState.justRetained = false;
  ch.acgState.retainedAssignment = null;
}

/** Consume an assignment retained last year (navy Retention): return it and
 *  clear the one-shot flags, else null. Shared prologue for rollAssignment. */
export function consumeRetainedAssignment(acg: AcgState): string | null {
  if (!acg.justRetained || !acg.retainedAssignment) return null;
  const retained = acg.retainedAssignment;
  acg.justRetained = false;
  acg.retainedAssignment = null;
  return retained;
}

/** Advance one step up a rank ladder and record it: set rankCode, flag
 *  promotedThisTerm for officers, log it, then run `onPromote` (e.g. scout's
 *  per-promotion skill grant). Returns false at the top of the ladder (or
 *  capped). Wraps advanceRankRow — the shared apply-promotion for pathways. */
export function applyPromotion(
  ch: Character,
  ladder: readonly RankRow[],
  opts?: { cap?: number; onPromote?: (ch: Character) => void },
): boolean {
  const acg = ch.requireAcgState();
  const next = advanceRankRow(ladder, acg.rankCode, opts?.cap);
  if (!next) return false;
  acg.rankCode = next[0];
  if (acg.isOfficer) acg.perTerm.promotedThisTerm = true;
  ch.log(ev.promoted(next[1]));
  opts?.onPromote?.(ch);
  return true;
}

/** A pathway's officer/enlisted skill-table column policy (PM p. 51). */
export interface SkillColumnPolicy {
  officerInCommand: string;
  officerStaff: string;
  enlistedNcoColumn: string;
  enlistedNcoMinRank: string;
  enlistedLowRankColumns: Record<string, string>;
  /** Low-rank column when the character's branch isn't keyed in
   *  enlistedLowRankColumns (e.g. Navy, whose "Navy Life" column applies to
   *  every branch). */
  enlistedLowRankDefault?: string;
  /** Mercenary only (PM p. 51): the Service Skills column Marines roll on
   *  while assigned to Ship's Troops, regardless of rank. */
  shipsTroopsColumn?: string;
}

/** The skill-table column for the character under a pathway's
 *  skillColumnPolicy (PM p. 51): officers -> command/staff by inCommand;
 *  enlisted -> the NCO column at/above the policy's NCO min rank, else the
 *  branch's low-rank Life column. One implementation for the mercenary
 *  default column and the special-assignment service-skill roll. */
export function serviceSkillColumnFor(
  ch: Character, pol: SkillColumnPolicy | undefined,
): string {
  const policy = requireRule(
    pol, "acg.<pathway>.skillColumnPolicy", "PM p. 51/55",
  );
  const acg = ch.requireAcgState();
  if (acg.isOfficer) {
    return acg.inCommand ? policy.officerInCommand : policy.officerStaff;
  }
  if (rankNum(acg.rankCode) >= rankNum(policy.enlistedNcoMinRank)) {
    return policy.enlistedNcoColumn;
  }
  const branch = branchOf(acg);
  return requireRule(
    policy.enlistedLowRankColumns[branch] ?? policy.enlistedLowRankDefault,
    `acg.<pathway>.skillColumnPolicy.enlistedLowRankColumns["${branch}"] ` +
    "(or enlistedLowRankDefault)", "PM p. 51/55",
  );
}
