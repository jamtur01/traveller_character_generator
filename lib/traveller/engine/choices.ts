// Interactive choice infrastructure. A character generation step that needs
// a user decision (which weapon? which skill table? blade or gun?) calls
// `pickOrDefer` on the Character. In auto mode the resolver picks
// immediately (preferred pool or random). In interactive mode it first
// consults `character.decisionCursor` — recorded picks resolve synchronously
// and execution continues; only the frontier choice (cursor exhausted) is
// queued on `character.pendingChoices` and throws ChoicePendingError.
//
// Resolution is re-execution: session.resolvePending appends the pick to the
// paused action's resolutions and re-runs the action from its pre-action
// base. The onResolve closure therefore only ever runs synchronously inside
// pickOrDefer; PendingChoice is render data for the UI while paused.

import type { Character } from "@/lib/traveller/character";

export type ChoiceMode = "auto" | "interactive";

export type ChoiceKind =
  | "cascade"
  | "weaponType"
  | "skillTable"
  | "musterRoll"
  // ACG-specific player decision points (MT Players' Manual).
  | "navyBranch"           // Soc 9+ picks any branch on enlistment
  | "navyOfficerSkillTable" // officer initial training: Branch vs Officer Staff
  | "commandDutyOptIn"      // officer may decline command-duty roll
  | "decorationDmTradeoff"  // -N survival ↔ +N decoration
  | "scoutTransferDecline"  // Scout Field → Bureaucracy transfer
  | "scoutAdminDm"          // Scout administrator voluntary +2 DM on duty roll
  | "merchantDepartment"    // Merchant Academy: pick one of five depts
  | "merchantSkillTable"    // Merchant: service / department / life
  | "merchantSkillColumn"   // Merchant: pick an available skill column in the chosen table
  | "reduceSkill"           // Int+Edu skill cap: pick a skill to reduce by 1
  | "repeatWeaponBenefit"   // Repeated weapon benefit (PM p. 20): same/different/category
  | "bpSpend"
  // Mongoose 2e player decision points.
  | "mongooseAssignment"   // pick an assignment on entering a career
  | "mongooseCareer"       // pick a career to attempt to enter
  | "mongooseSkillTable"   // pick which skill table to roll on this term
  | "mongooseBasicSkill"   // subsequent-career basic training: one service skill
  | "mongooseSkillChoice"  // event/rank gainSkillChoice: pick among skills
  | "mongooseEventChoice"; // event chooseEffect: pick a branch

export interface ChoiceRequest<T = string> {
  kind: ChoiceKind;
  label: string;
  options: readonly T[];
  /**
   * Subset of options to pick from in auto mode (typically: weapons the
   * character already has skill in, so blade-cascades stack onto the same
   * blade). When empty or absent, auto mode picks from all options. The UI
   * may surface this as a default or highlight in interactive mode.
   */
  preferred?: readonly T[];
  /** Free-form context the UI may render (cell name, source, etc.). */
  context?: Record<string, unknown>;
  /** Invoked with the selected option when resolved. */
  onResolve: (ch: Character, chosen: T) => void;
}

export interface PendingChoice<T = string> extends ChoiceRequest<T> {
  id: string;
}

let nextChoiceId = 1;
export function genChoiceId(): string {
  return `c${nextChoiceId++}`;
}

/** Thrown by pickOrDefer in interactive mode after queueing the frontier
 *  choice. Unwinds the whole action to the session boundary; the snapshot
 *  keeps `frontier` (action + base + resolutions) so resolvePending can
 *  re-run the action from its base with the new pick appended. */
export class ChoicePendingError extends Error {
  constructor(public choiceId: string) {
    super(`ACG choice pending (${choiceId})`);
    this.name = "ChoicePendingError";
  }
}

/** Run `fn`, absorbing the ChoicePendingError that pickOrDefer throws in
 *  interactive mode. Returns "paused" when a choice was queued (the caller
 *  records its resume point or returns its paused phase) or "done" when `fn`
 *  completed; any other error propagates. The one catch site for the
 *  interactive pause/resume protocol — replaces the hand-written
 *  `if (!(err instanceof ChoicePendingError)) throw err` at every engine and
 *  session boundary. */
export function pauseGuard(fn: () => void): "done" | "paused" {
  try {
    fn();
    return "done";
  } catch (err) {
    if (err instanceof ChoicePendingError) return "paused";
    throw err;
  }
}
