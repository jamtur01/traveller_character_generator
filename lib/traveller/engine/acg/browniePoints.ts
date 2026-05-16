// Brownie point spending. Per MT manual p. 46: brownie points are
// special DMs that may be applied to any die roll AFTER it has been
// rolled. Any number may be spent on a given roll, subject only to the
// character's available BP pool.
//
// Two modes:
//   - auto: spend BPs automatically when:
//     * a survival roll failed by N (spend N BPs to save the character's life)
//     * a court martial result is worse than "Reprimand" (mitigate down)
//     * leave promotions/skills/decorations alone (no death risk)
//   - interactive: push a PendingChoice for each failed roll the player
//     could mitigate; player decides whether to spend.

import type { Character } from "../../character";

export interface MitigationRequest {
  rollName: "survival" | "decoration" | "promotion" | "skills" | "courtMartial";
  rollValue: number;
  dm: number;
  target: number;
  /** Negative = failed; positive = succeeded. */
  margin: number;
  /** Description of consequence if not mitigated. */
  consequence: string;
}

export interface MitigationResult {
  /** Number of BPs the character spent. */
  spent: number;
  /** New effective margin after BP spending. */
  newMargin: number;
}

/** Try to mitigate a roll outcome by spending brownie points. Returns
 *  how many BPs were spent (0 if none) and the new margin. */
export function tryMitigate(
  ch: Character,
  req: MitigationRequest,
): MitigationResult {
  if (!ch.acgState) return { spent: 0, newMargin: req.margin };
  if (ch.acgState.browniePoints <= 0) return { spent: 0, newMargin: req.margin };
  if (req.margin >= 0) return { spent: 0, newMargin: req.margin }; // already a pass

  if (ch.choiceMode === "auto") {
    return autoMitigate(ch, req);
  }

  // Interactive mode: queue a choice for the player. The choice's
  // resolution calls back into spendBrowniePoints with the player's
  // chosen amount. Until the player resolves it, the margin stays as-is
  // (callers see the unmitigated outcome). The UI shows the pending
  // choice; once resolved, the engine recomputes the outcome.
  //
  // Note: the engine is synchronous, so we can't actually pause mid-roll.
  // The auto-mode behaviour fires immediately; interactive mode records
  // a "mitigation offer" on the character that the UI may apply
  // retroactively via spendBrowniePoints (which adjusts skills/decorations
  // /rank as if the outcome had been different).
  //
  // For now interactive mode also auto-mitigates survival failures (death
  // prevention is the one decision a player would always choose to make).
  return autoMitigate(ch, req);
}

/** Auto-mitigation policy: spend BPs only to save the character's life
 *  (survival failures) and to push court martial outcomes to Reprimand
 *  or better. Other rolls are left as-is. */
function autoMitigate(ch: Character, req: MitigationRequest): MitigationResult {
  if (req.rollName !== "survival" && req.rollName !== "courtMartial") {
    return { spent: 0, newMargin: req.margin };
  }
  // Need |margin| BPs to flip the roll.
  const needed = Math.abs(req.margin);
  if (ch.acgState!.browniePoints < needed) {
    // Not enough — don't waste partial spending on a roll we can't save.
    return { spent: 0, newMargin: req.margin };
  }
  ch.acgState!.browniePoints -= needed;
  ch.acgState!.browniePointsSpent += needed;
  ch.verboseHistory(
    `Spent ${needed} brownie point(s) to mitigate ${req.rollName} failure (avoided: ${req.consequence})`,
  );
  return { spent: needed, newMargin: 0 };
}

/** Explicit player spending — used by the UI's PendingChoice resolver.
 *  Applies a chosen amount of BPs and returns the new margin. */
export function spendBrowniePoints(
  ch: Character,
  amount: number,
  originalMargin: number,
): number {
  if (!ch.acgState) return originalMargin;
  const spend = Math.min(amount, ch.acgState.browniePoints);
  ch.acgState.browniePoints -= spend;
  ch.acgState.browniePointsSpent += spend;
  if (spend > 0) {
    ch.verboseHistory(`Spent ${spend} brownie point(s) post-roll`);
  }
  return originalMargin + spend;
}
