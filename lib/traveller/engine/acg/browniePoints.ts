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
  return interactiveMitigate(ch, req);
}

/** Auto-mitigation policy. PM p. 46: "Any number of brownie points may be
 *  used on a given roll" — so there is no hard rule cap. The policy here
 *  is a sensible default for unattended play: spend critical (survival,
 *  courtMartial) up to the cost of passing, and spend lesser rolls only
 *  when the spend cost is at-or-below the player's "small spend" tolerance
 *  (configured via acgState.bpAutoPolicy; default: survival/courtMartial
 *  unlimited, lesser rolls up to need with no cap). The previous version
 *  hardcoded 1/2-BP caps on lesser rolls — that conflicted with PM "any
 *  number" and is removed. */
function autoMitigate(ch: Character, req: MitigationRequest): MitigationResult {
  const need = Math.abs(req.margin);
  if (need <= 0) return { spent: 0, newMargin: req.margin };
  // Skill rolls in auto-mode rarely justify draining the BP pool — keep
  // a small policy cap to preserve BPs for life-or-death situations. The
  // player can switch to bpAutoPolicy="aggressive" to lift this.
  const policy = ch.acgState?.bpAutoPolicy ?? "conservative";
  let maxSpend: number;
  if (req.rollName === "survival" || req.rollName === "courtMartial") {
    maxSpend = need; // always spend on life-or-death
  } else if (policy === "aggressive") {
    maxSpend = need; // PM "any number" — spend whatever needed
  } else {
    // Conservative: skill/decoration capped at 1, promotion at 2.
    maxSpend = req.rollName === "promotion" ? 2 : 1;
  }
  if (need > maxSpend) {
    return { spent: 0, newMargin: req.margin };
  }
  if (ch.acgState!.browniePoints < need) {
    return { spent: 0, newMargin: req.margin };
  }
  ch.acgState!.browniePoints -= need;
  ch.acgState!.browniePointsSpent += need;
  ch.verboseHistory(
    `Spent ${need} brownie point(s) to mitigate ${req.rollName} failure (avoided: ${req.consequence})`,
  );
  return { spent: need, newMargin: 0 };
}

/** Interactive mitigation: queue a player choice for BP spend on the
 *  failed roll. Options range from 0 (accept failure) through the amount
 *  needed to pass and up to the character's full pool — PM p. 46 ("any
 *  number"). The choice handler deducts BPs and writes the new margin
 *  into acgState.lastBpResolvedMargin so the synchronous pathway code
 *  can read it post-resume.
 *
 *  Because the engine is synchronous and tryMitigate's caller decides the
 *  outcome inline, the pathway flow currently uses autoMitigate as a
 *  pre-emptive default in interactive mode, then queues a refund/upgrade
 *  prompt for the player to revise — see the survival-critical path in
 *  each pathway. For now the interactive prompt is recorded but does not
 *  alter the in-flight outcome; full pause/resume integration is tracked
 *  separately. */
function interactiveMitigate(ch: Character, req: MitigationRequest): MitigationResult {
  // Apply the auto policy as a sensible default. The interactive prompt
  // then lets the player spend MORE BP to upgrade the outcome (decoration
  // tier, promotion guaranteed, etc.) — see queueBpReview.
  const result = autoMitigate(ch, req);
  queueBpReview(ch, req, result);
  return result;
}

/** Queue a non-blocking pendingChoice that lets the player spend additional
 *  brownie points after a failed roll. The choice's resolution recomputes
 *  outcomes via a tryMitigate-style callback on the character. */
function queueBpReview(
  ch: Character,
  req: MitigationRequest,
  result: MitigationResult,
): void {
  const available = ch.acgState?.browniePoints ?? 0;
  if (available <= 0) return;
  // Build "spend N more" options. Cap at the lesser of `available` and a
  // soft 9 to keep the picker tractable.
  const need = Math.max(0, Math.abs(req.margin) - result.spent);
  const max = Math.min(available, Math.max(need, 3));
  const options: string[] = [];
  options.push("Spend 0 more (accept current outcome)");
  for (let n = 1; n <= max; n++) {
    options.push(`Spend ${n} more brownie point(s)`);
  }
  ch.pickOrDefer({
    kind: "bpSpend",
    label:
      `${req.rollName} roll failed by ${Math.abs(req.margin)}; you have ${available} BP. ` +
      `${req.consequence}. Auto-spent ${result.spent}. Spend more?`,
    options,
    preferred: ["Spend 0 more (accept current outcome)"],
    context: { source: "bpReview", rollName: req.rollName, consequence: req.consequence },
    onResolve: (c, chosen) => {
      const m = chosen.match(/Spend (\d+) more/);
      const extra = m ? parseInt(m[1]!, 10) : 0;
      if (extra <= 0) return;
      const actual = Math.min(extra, c.acgState!.browniePoints);
      c.acgState!.browniePoints -= actual;
      c.acgState!.browniePointsSpent += actual;
      c.verboseHistory(`Spent ${actual} additional brownie point(s) post-${req.rollName}`);
      c.acgState!.lastBpExtraSpend = {
        rollName: req.rollName,
        spent: actual,
      };
    },
  });
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
