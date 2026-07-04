// Shared pathway plumbing. Each ACG pathway needs the same four
// helpers around its PathwaySpec: lazy-built per-edition cache,
// cache-purge for tests / hot-reload, eager validation at edition load,
// and the cache lookup. The shapes are identical — only the pathway
// key, callback registry, and combatAssignments accessor differ. This
// module factors the boilerplate into createPathwaySpecRegistry; each
// pathway then wires its specifics in ~5 lines instead of ~30.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import type { PathwaySpec, ResolveContext } from "@/lib/traveller/engine/acg/phaseRunner";
import {
  buildPathwaySpecFromConfig, type PathwayCallbacks,
  type ResolveAssignmentConfig,
} from "@/lib/traveller/engine/acg/jsonPhases";
import { applyDmRules, applyStructuredDms, type StructuredDm } from "@/lib/traveller/engine/acg/tables";
import { event as ev } from "@/lib/traveller/history";
import { rankNum } from "@/lib/traveller/engine/predicate";
import type { AcgState } from "@/lib/traveller/engine/acg/state";

interface PathwayRegistryOptions<TData> {
  /** Key under `advancedCharacterGeneration` in edition JSON
   *  ("mercenary", "navy", "scout", "merchantPrince"). */
  pathwayKey: string;
  callbacks: PathwayCallbacks;
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
      spec = buildPathwaySpecFromConfig(data.resolveAssignment, opts.callbacks, {
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
      buildPathwaySpecFromConfig(data.resolveAssignment, opts.callbacks, {
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
    const r = Math.max(1, Math.min(7, ch.rng.roll(1) + dm));
    const v = table.rows.find((row) => row.die === r)?.[col];
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
  if (acg.isOfficer) acg.promotedThisTerm = true;
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
  /** Fallback low-rank column when the character's branch isn't keyed in
   *  enlistedLowRankColumns (e.g. Navy, whose "Navy Life" column applies to
   *  every branch). */
  enlistedLowRankDefault?: string;
}

/** The skill-table column for the character under a pathway's
 *  skillColumnPolicy (PM p. 51): officers -> command/staff by inCommand;
 *  enlisted -> the NCO column at/above the policy's NCO min rank, else the
 *  branch's low-rank Life column. One implementation for the mercenary
 *  default column and the special-assignment service-skill roll. */
export function serviceSkillColumnFor(
  ch: Character, pol: SkillColumnPolicy | undefined,
): string {
  const acg = ch.requireAcgState();
  if (acg.isOfficer) {
    return acg.inCommand
      ? pol?.officerInCommand ?? "commandSkills"
      : pol?.officerStaff ?? "staffSkills";
  }
  const ncoMin = pol ? rankNum(pol.enlistedNcoMinRank) : 3;
  if (rankNum(acg.rankCode) >= ncoMin) return pol?.enlistedNcoColumn ?? "ncoSkills";
  const branch = acg.branch ?? "";
  return pol?.enlistedLowRankColumns[branch]
    ?? pol?.enlistedLowRankColumns["army"]
    ?? pol?.enlistedLowRankDefault
    ?? (branch === "Marines" ? "marineLife" : "armyLife");
}
