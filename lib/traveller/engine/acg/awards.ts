// Awards + brownie-point mechanics — granting decorations, awarding BPs,
// running court-martial, and the spend-side mitigation that lets players
// burn BPs to rescue failed rolls. Per MT Players' Manual pp. 46-47.

import { getEdition, getAcgPathway } from "@/lib/traveller/editions";
import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import {
  cacheMitigation, getCachedMitigation, type SubStepKey,
} from "./subStepCache";

interface BrownieAward { event: string; points: number }

function getSkillLevel(ch: Character, skill: string): number {
  for (const [name, level] of ch.skills) {
    if (name === skill) return level;
  }
  return 0;
}

function commonAcg(ch: Character) {
  return getEdition(ch.editionId).data.advancedCharacterGeneration?.common
    ?? null;
}

/** Look up the brownie-point award for a given event string in
 *  common.browniePoints.awards. Exact case-insensitive match — substring
 *  matching would collide as the awards table grows ("Special assignment"
 *  matching "assignment"). Returns null if not configured. */
export function bpAwardFor(ch: Character, event: string): number | null {
  const common = commonAcg(ch);
  const awards = common?.browniePoints?.awards as BrownieAward[] | undefined;
  if (!Array.isArray(awards)) return null;
  const needle = event.toLowerCase();
  const match = awards.find((a) => a.event.toLowerCase() === needle);
  return match ? match.points : null;
}

export function awardBrownie(ch: Character, count: number, reason: string): void {
  if (!ch.acgState) return;
  ch.acgState.browniePoints += count;
  ch.log(ev.browniePoint(count, reason, ch.acgState.browniePoints));
}

export function awardDecoration(
  ch: Character,
  award: "MCUF" | "MCG" | "SEH" | "Purple Heart",
): void {
  if (!ch.acgState) return;
  ch.acgState.decorations.push(award);
  ch.log(ev.decoration(award));
  const bp = bpAwardFor(ch, `${award} received`) ?? 0;
  if (bp > 0) awardBrownie(ch, bp, `Decoration ${award}`);
  // SEH carries an automatic +1 rank at muster-out. The flag comes from
  // decorationTiers[].sehPromotion in JSON — search the active edition's
  // decoration tiers for a matching award entry.
  if (matchesDecorationFlag(ch, award, "sehPromotion")) {
    ch.acgState.sehPromotionPending = true;
  }
}

function matchesDecorationFlag(
  ch: Character,
  award: string,
  flag: "sehPromotion",
): boolean {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
  // Decoration tiers may live on the pathway or in `common` (the shared
  // PM block). Check pathway first, then fall back to common.
  const sources = [
    getAcgPathway(ch.editionId, ch.acgState?.pathway),
    acg?.common,
  ];
  for (const src of sources) {
    const tiers = src?.decorationTiers?.tiers;
    if (!tiers) continue;
    const match = tiers.find((t) => t.award === award);
    if (match) return match[flag] === true;
  }
  return false;
}

/** Resolve a decoration tier for the given margin from the active
 *  pathway's `decorationTiers.tiers` JSON, falling back to
 *  `common.decorationTiers` if the pathway doesn't declare its own
 *  (PM p. 49 line 3050-3056 — the tier structure is shared across
 *  pathways; navy duplicates the block, but mercenary doesn't, so the
 *  fallback is what makes mercenary decorations work). Returns the
 *  highest-tier match (tiers are ordered with the biggest margin first
 *  in JSON). Returns null if no tier matches (margin too low). */
export function resolveDecorationTier(
  ch: Character, margin: number,
): "SEH" | "MCG" | "MCUF" | null {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
  const pdata = getAcgPathway(ch.editionId, ch.acgState?.pathway ?? "mercenary");
  const tiers = (pdata?.decorationTiers?.tiers
    ?? acg?.common?.decorationTiers?.tiers
    ?? []) as Array<{ minMargin: number; award: string }>;
  for (const t of tiers) {
    if (margin >= t.minMargin) {
      return t.award as "SEH" | "MCG" | "MCUF";
    }
  }
  return null;
}

interface CourtMartialOutcome { roll: number; result: string }
interface CourtMartialDmWhen {
  rankBetween?: { letter: string; min: number; max: number };
  rankAtLeast?: { letter: string; min: number };
  currentAssignmentIs?: "combat" | "training";
  currentlyInCommand?: boolean;
}
interface CourtMartialDm {
  when: CourtMartialDmWhen;
  dm: number;
}
interface CourtMartialSpec {
  trigger?: { rule: string };
  guilt?: {
    enlisted: string;
    officer: {
      avoidTarget: number;
      die: string;
      dms: Array<{ type: string; skill?: string; dm: number }>;
      browniePointsAllowed?: boolean;
    };
  };
  resultRoll?: { die: string; dms: CourtMartialDm[] };
  dieResults: CourtMartialOutcome[];
}

/** Court Martial — per common.courtMartial. Triggered when a decoration
 *  roll fails by 6+. Officers may attempt to avoid the court martial by
 *  rolling against `guilt.officer.avoidTarget` (DM +1 per level of Admin,
 *  brownie points may be spent). Enlisted are automatically guilty.
 *  The result is then rolled on the JSON-defined die with situational
 *  DMs (rank, assignment type, command duty) and the row from
 *  common.courtMartial.dieResults applied to engine state. */
export function runCourtMartial(ch: Character, assignment?: string): void {
  const common = commonAcg(ch);
  const cm = common?.courtMartial as CourtMartialSpec | undefined;
  if (!cm?.dieResults) return;

  // Guilt step.
  if (ch.acgState?.isOfficer && cm.guilt) {
    const o = cm.guilt.officer;
    let dm = 0;
    for (const d of o.dms) {
      if (d.type === "skillLevel" && d.skill) {
        dm += getSkillLevel(ch, d.skill) * d.dm;
      }
    }
    const dieN = o.die === "1D" ? 1 : 2;
    let gr = 0;
    for (let i = 0; i < dieN; i++) gr += ch.rng.roll(1);
    const baseTotal = gr + dm;
    let total = baseTotal;
    // BP-spend gate matches tryMitigate: "manual" policy never auto-spends.
    // PM p. 46 allows any number on a life-or-death roll, so auto modes
    // spend the full amount needed.
    if (o.browniePointsAllowed && ch.acgState
        && ch.acgState.bpAutoPolicy !== "manual") {
      while (total < o.avoidTarget && ch.acgState.browniePoints > 0) {
        ch.acgState.browniePoints -= 1;
        ch.acgState.browniePointsSpent += 1;
        total += 1;
        ch.log(ev.browniePoint(-1, "Avoid court martial", ch.acgState.browniePoints));
      }
    }
    if (total >= o.avoidTarget) {
      const bpUsed = total - baseTotal;
      const ctx = bpUsed > 0
        ? `rolled ${baseTotal}, used ${bpUsed} BP, vs ${o.avoidTarget}+`
        : `rolled ${baseTotal} vs ${o.avoidTarget}+`;
      ch.log(ev.courtMartial(`avoided (${ctx})`));
      return;
    }
  }

  // Result roll.
  let dm = 0;
  for (const d of cm.resultRoll?.dms ?? []) {
    if (resultDmWhenMatches(ch, d.when, assignment)) dm += d.dm;
  }
  const dieN = cm.resultRoll?.die === "2D" ? 2 : 1;
  let dieTotal = 0;
  for (let i = 0; i < dieN; i++) dieTotal += ch.rng.roll(1);
  let r = dieTotal + dm;
  // BP-spend gate matches tryMitigate: "manual" policy never auto-spends.
  // Auto modes drive the result toward the best outcome — the lowest
  // defined die result (Case dismissed, r = -1 per PM p. 47) — spending
  // one BP per step down within the available pool.
  if (ch.acgState && ch.acgState.bpAutoPolicy !== "manual") {
    const bestRoll = Math.min(...cm.dieResults.map((o) => o.roll));
    while (r > bestRoll && ch.acgState.browniePoints > 0) {
      ch.acgState.browniePoints -= 1;
      ch.acgState.browniePointsSpent += 1;
      r -= 1;
      ch.log(ev.browniePoint(-1, "Mitigate court martial", ch.acgState.browniePoints));
    }
  }
  const outcome = cm.dieResults.find((o) => o.roll === r)
    ?? cm.dieResults.reduce((closest, o) =>
        Math.abs(o.roll - r) < Math.abs(closest.roll - r) ? o : closest,
        cm.dieResults[0]!);
  const result = outcome.result;
  ch.log(ev.courtMartial(result));

  applyCourtMartialResult(ch, result);
}

function resultDmWhenMatches(
  ch: Character, when: CourtMartialDmWhen, assignment?: string,
): boolean {
  const rankCode = ch.acgState?.rankCode ?? "";
  if (when.rankBetween) {
    const { letter, min, max } = when.rankBetween;
    const re = new RegExp(`^${letter}(\\d+)$`);
    const m = rankCode.match(re);
    if (!m) return false;
    const n = parseInt(m[1]!, 10);
    if (n < min || n > max) return false;
  }
  if (when.rankAtLeast) {
    const { letter, min } = when.rankAtLeast;
    const re = new RegExp(`^${letter}(\\d+)$`);
    const m = rankCode.match(re);
    if (!m) return false;
    if (parseInt(m[1]!, 10) < min) return false;
  }
  if (when.currentAssignmentIs === "combat") {
    if (!assignment) return false;
    const pw = getAcgPathway(ch.editionId, ch.acgState?.pathway);
    if (!pw?.combatAssignments?.includes(assignment)) return false;
  }
  if (when.currentAssignmentIs === "training") {
    if (assignment !== "Training") return false;
  }
  if (when.currentlyInCommand === true && !ch.acgState?.inCommand) return false;
  return true;
}

function applyCourtMartialResult(ch: Character, result: string): void {
  if (!ch.acgState) return;
  const lc = result.toLowerCase();
  if (lc.includes("dismissed")) return;

  // Reprimand: -N to next promotion. Manual p. 47 lists -1 and -3 variants.
  if (lc.includes("reprimand")) {
    const m = result.match(/-(\d+)/);
    const mag = m ? parseInt(m[1]!, 10) : 1;
    ch.acgState.nextPromotionPenalty =
      (ch.acgState.nextPromotionPenalty ?? 0) - mag;
    return;
  }

  // Reduce rank by N.
  if (lc.includes("reduce rank")) {
    const m = result.match(/-(\d+)/);
    const mag = m ? parseInt(m[1]!, 10) : 1;
    reduceRank(ch, mag);
    return;
  }

  // Dishonorable discharge — character loses 3 mustering-out rolls and gets
  // no pension (manual p. 47). Captured here as flags consulted at muster.
  if (lc.includes("dishonorable") || /\bdd\b/i.test(result)) {
    ch.acgState.musterRollPenalty =
      (ch.acgState.musterRollPenalty ?? 0) - 3;
    ch.acgState.pensionForfeit = true;
    ch.endChargenDischarged();
    ch.log(ev.statusChange(
      "dishonorablyDischarged",
      "-3 mustering-out rolls, no pension",
    ));
    return;
  }

  // Jail. "Jail 2D months" serves as the next year of service; longer
  // sentences are full muster-out terminators that age the character by
  // a rolled NDx-year sentence (manual p. 47).
  if (lc.includes("jail")) {
    const monthsMatch = result.match(/jail\s+2D\s+months/i);
    if (monthsMatch) {
      // "Jail 2D months" is the mildest jail outcome: roll and log the
      // duration for the record, then end court-martial resolution. (Unlike
      // the "Jail ND years" path below, it neither ages the character nor
      // forfeits benefits.)
      const months = ch.rng.roll(1) + ch.rng.roll(1);
      ch.log(ev.statusChange(
        "jailed",
        `${months} months — consumes this year of service`,
      ));
      return;
    }
    // "Jail 1D years; ..." or "Jail 2D years; ..."
    ch.acgState.musterRollPenalty =
      (ch.acgState.musterRollPenalty ?? 0) - 3;
    ch.acgState.pensionForfeit = true;
    const yearsMatch = result.match(/jail\s+(\d+)D\s+years/i);
    if (yearsMatch) {
      const dice = parseInt(yearsMatch[1]!, 10);
      let years = 0;
      for (let i = 0; i < dice; i++) years += ch.rng.roll(1);
      ch.age += years;
      ch.endChargenRetired(`imprisoned ${years} years (${dice}D rolled)`, false);
    } else {
      ch.endChargenRetired("imprisoned", false);
    }
    return;
  }

  // Death penalty / escape. The character has a price on his head; no
  // mustering-out benefits and no pension. Manual p. 47 lists three forms:
  //   "Death; escape; KCr10 reward"
  //   "Death; escape; KCr10 reward" (10-year sentence variant)
  //   "Death; escape, killing 1D guards; KCr100 reward"
  // We parse the bounty value and any "killing ND guards" suffix.
  if (lc.includes("death")) {
    ch.acgState.musterRollPenalty =
      (ch.acgState.musterRollPenalty ?? 0) - 99; // zero out benefits
    ch.acgState.pensionForfeit = true;
    const bountyMatch = result.match(/KCr(\d+)/i);
    if (bountyMatch) {
      ch.acgState.bountyOnHeadKCr = parseInt(bountyMatch[1]!, 10);
    }
    const guardsMatch = result.match(/killing\s+(\d+)D\s+guards/i);
    if (guardsMatch) {
      const dice = parseInt(guardsMatch[1]!, 10);
      let killed = 0;
      for (let i = 0; i < dice; i++) killed += ch.rng.roll(1);
      ch.acgState.guardsKilledInEscape = killed;
    }
    if (lc.includes("escape")) {
      const bountyTxt = ch.acgState.bountyOnHeadKCr !== undefined
        ? ` Bounty: KCr${ch.acgState.bountyOnHeadKCr}.`
        : "";
      const killedTxt = ch.acgState.guardsKilledInEscape
        ? ` Killed ${ch.acgState.guardsKilledInEscape} guards in escape.`
        : "";
      ch.endChargenRetired(`death sentence; escaped.${bountyTxt}${killedTxt}`, false);
    } else {
      ch.endChargenDeceased("executed (death sentence; no benefits or pension)");
    }
    return;
  }
}

function reduceRank(ch: Character, mag: number): void {
  if (!ch.acgState) return;
  // Find pathway rank list and step backwards.
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
  if (!acg) return;
  const pathway = acg[ch.acgState.pathway] as {
    ranks?: { enlisted?: unknown[][]; officer?: unknown[][] };
  } | undefined;
  const list = ch.acgState.isOfficer
    ? pathway?.ranks?.officer
    : pathway?.ranks?.enlisted;
  if (!Array.isArray(list)) return;
  const codes = list.map((r) => r[0] as string);
  const idx = codes.indexOf(ch.acgState.rankCode);
  if (idx <= 0) return;
  const newIdx = Math.max(0, idx - mag);
  ch.acgState.rankCode = codes[newIdx]!;
}
const CACHEABLE_PHASES: ReadonlySet<string> =
  new Set<SubStepKey>(["survival", "promotion", "decoration", "skills", "bonus"]);

/** Type-narrow a rollName to SubStepKey when it's actually cacheable.
 *  Avoids `as SubStepKey` casts that lie about "courtMartial". */
function asCacheableKey(rollName: string): SubStepKey | null {
  return CACHEABLE_PHASES.has(rollName) ? (rollName as SubStepKey) : null;
}

export interface MitigationRequest {
  rollName: "survival" | "decoration" | "promotion" | "skills" | "courtMartial" | "bonus";
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

  // Resume case: if a prior pass through this phase already auto-
  // mitigated (and possibly queued a BP review that paused the engine),
  // return the cached spend/margin so re-runs don't double-charge BPs.
  // The cache lives on AcgState.thisYearOutcomes and is cleared at year
  // boundary by runAcgYear. "courtMartial" is not cacheable (no per-year
  // sub-step slot for it) — asCacheableKey returns null there.
  const phase = asCacheableKey(req.rollName);
  if (phase) {
    const cached = getCachedMitigation(ch, phase);
    if (cached) return cached;
  }

  if (ch.choiceMode === "auto") {
    const result = autoMitigate(ch, req);
    if (phase) cacheMitigation(ch, phase, result.spent, result.newMargin);
    return result;
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
  if (ch.requireAcgState().browniePoints < need) {
    return { spent: 0, newMargin: req.margin };
  }
  ch.requireAcgState().browniePoints -= need;
  ch.requireAcgState().browniePointsSpent += need;
  ch.log(ev.browniePoint(
    -need,
    `Mitigated ${req.rollName} failure (avoided: ${req.consequence})`,
    ch.requireAcgState().browniePoints,
  ));
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
  // Cache the auto-spend BEFORE queueBpReview can throw, so the resumed
  // pathway sees the same spent/newMargin instead of re-rolling and
  // re-spending.
  const phase = asCacheableKey(req.rollName);
  if (phase) cacheMitigation(ch, phase, result.spent, result.newMargin);
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
  // Build "spend N more" options. PM p. 46 allows any number of BPs on
  // a single roll, so the cap is whatever the character can afford.
  // Bounded at 12 to keep the picker tractable for huge BP pools (the
  // player can still aggregate via repeated prompts in pathological
  // cases — a court-martial avoid needs ≤ 6, survival ≤ ~10).
  const max = Math.min(available, 12);
  const options: string[] = [];
  options.push("Spend 0 more (accept current outcome)");
  for (let n = 1; n <= max; n++) {
    options.push(`Spend ${n} more brownie point(s)`);
  }
  // Pause the engine on the BP-review prompt. The pathway's
  // resolveAssignment is idempotent on resume via the per-year
  // sub-step cache (AcgState.thisYearOutcomes): dice rolls and
  // auto-mitigation spends are cached, so re-running after the player
  // resolves the prompt doesn't re-roll or double-spend. A non-throwing
  // queue is the wrong primitive for life-or-death rolls — it would
  // let endChargenRetired fire before the player has a chance to spend
  // more BPs to revive.
  ch.pickOrDefer({
    kind: "bpSpend",
    label:
      `${req.rollName} roll failed by ${Math.abs(req.margin)}; you have ${available} BP. ` +
      `${req.consequence}. Auto-spent ${result.spent}. Spend more?`,
    options,
    preferred: ["Spend 0 more (accept current outcome)"],
    context: { source: "bpReview", rollName: req.rollName, consequence: req.consequence },
    onResolve: (ch, chosen) => {
      const m = chosen.match(/Spend (\d+) more/);
      const extra = m ? parseInt(m[1]!, 10) : 0;
      const phase = asCacheableKey(req.rollName);
      if (extra <= 0) {
        // Player declined to spend more. The cache still holds the
        // auto-mitigation result (result.spent, result.newMargin) which
        // the resumed pathway will read — that's correct (no change).
        return;
      }
      const actual = Math.min(extra, ch.requireAcgState().browniePoints);
      ch.requireAcgState().browniePoints -= actual;
      ch.requireAcgState().browniePointsSpent += actual;
      ch.log(ev.browniePoint(
        -actual,
        `Additional spend post-${req.rollName}`,
        ch.requireAcgState().browniePoints,
      ));
      // Update the sub-step cache so the resumed pathway sees the
      // post-spend totals. Without this the cache returns the original
      // autoMitigate values and the pathway re-fires the failure branch
      // (e.g. endChargenRetired) even though the player just bought
      // their way out.
      const totalSpent = result.spent + actual;
      const finalMargin = req.margin + totalSpent;
      if (phase) cacheMitigation(ch, phase, totalSpent, finalMargin);
      // F16: if the total spend pushed the margin to ≥ 0 and the
      // request carries an onMitigated callback, run it now to apply
      // the success outcome retroactively (revival / retroactive
      // decoration / etc.).
      if (finalMargin >= 0 && req.onMitigated) {
        req.onMitigated(ch);
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
    ch.log(ev.browniePoint(
      -spend, "Post-roll spend", ch.acgState.browniePoints,
    ));
  }
  return originalMargin + spend;
}
