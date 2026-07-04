// Interactive choice infrastructure. A character generation step that needs
// a user decision (which weapon? which skill table? blade or gun?) calls
// `pickOrDefer` on the Character. In auto mode the resolver picks randomly
// and applies immediately; in interactive mode the choice is queued on
// `character.pendingChoices` and applied later when the UI calls
// `character.resolveChoice(id, idx)`.
//
// Closures hold the apply-on-resolve logic, which means PendingChoice is
// not serializable — it's an in-memory React-state object only.

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
  | "bpSpend";              // Brownie-point spend prompt (PM p. 46)

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

/** Thrown by pickOrDefer in interactive mode after queueing a choice.
 *  The ACG runner catches this, preserves yearStep, and bails out so the
 *  current year does not proceed past the choice point with stale state.
 *  After the UI calls resolveChoice and runs the queued closure, the runner
 *  is re-invoked to continue from the recorded yearStep. */
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
