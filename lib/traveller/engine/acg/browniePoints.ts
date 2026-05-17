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
  /** F16: callback to apply the success outcome if the player's BP spend
   *  pushes the margin to ≥ 0. Used by interactive "manual" mode where
   *  the outcome is deferred to the choice handler. Pathway code passes
   *  e.g. `() => { ch.activeDuty = true; }` for survival to revive a
   *  character who was about to be invalided. */
  onMitigated?: (ch: Character) => void;
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
 *  used on a given roll" — so there is no hard rule cap. The policy is
 *  configurable per character via acgState.bpAutoPolicy:
 *    - "manual" (new in F16): NEVER auto-spends. Pathway/choice handler
 *      decides. Use in interactive mode to defer all BP spending to the
 *      player.
 *    - "aggressive": spends up to `need` on any failed roll.
 *    - "conservative" (default for auto mode): unconditional spend on
 *      survival/courtMartial (life-or-death), 1 BP on skill/decoration,
 *      2 BP on promotion. */
function autoMitigate(ch: Character, req: MitigationRequest): MitigationResult {
  const need = Math.abs(req.margin);
  if (need <= 0) return { spent: 0, newMargin: req.margin };
  const policy = ch.acgState?.bpAutoPolicy ?? "conservative";
  if (policy === "manual") return { spent: 0, newMargin: req.margin };
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
  ch.logRaw(
    `Spent ${need} brownie point(s) to mitigate ${req.rollName} failure (avoided: ${req.consequence})`,
  "verbose");
  return { spent: need, newMargin: 0 };
}

/** Interactive mitigation: combine the configured auto-policy with a
 *  player-directed review prompt. When bpAutoPolicy is "manual" the
 *  auto layer spends nothing and the player decides everything via the
 *  prompt; the prompt's onResolve runs the request's onMitigated
 *  callback when the spend pushes the margin to ≥ 0, allowing the
 *  pathway to revive a character who was about to be invalided
 *  (survival), award a missed decoration (decoration), force a
 *  promotion (promotion), or grant a missed skill (skills). */
function interactiveMitigate(ch: Character, req: MitigationRequest): MitigationResult {
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
      c.logRaw(`Spent ${actual} additional brownie point(s) post-${req.rollName}`, "verbose");
      c.acgState!.lastBpExtraSpend = {
        rollName: req.rollName,
        spent: actual,
      };
      // F16: if the total spend (auto + extra) is enough to push the
      // margin to ≥ 0 and the request carries an onMitigated callback,
      // run it now to apply the success outcome retroactively.
      const totalSpent = result.spent + actual;
      const finalMargin = req.margin + totalSpent;
      if (finalMargin >= 0 && req.onMitigated) {
        req.onMitigated(c);
      }
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
    ch.logRaw(`Spent ${spend} brownie point(s) post-roll`, "verbose");
  }
  return originalMargin + spend;
}
