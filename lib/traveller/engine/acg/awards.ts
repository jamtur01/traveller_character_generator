// Shared award helpers — decorations, brownie points, court martial.
// Brownie point values and court-martial dice/DMs are read from the
// edition JSON (common.browniePoints, common.courtMartial). Per MT
// Players' Manual p. 46-47.

import { roll } from "../../random";
import { getEdition, getAcgPathway } from "../../editions";
import type { Character } from "../../character";
import { event as ev } from "../../history";

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
  /** Legacy free-text. */
  condition?: string;
  /** Structured form. */
  when?: CourtMartialDmWhen;
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
    for (let i = 0; i < dieN; i++) gr += roll(1);
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
    const matches = d.when
      ? resultDmWhenMatches(ch, d.when, assignment)
      : resultDmApplies(ch, d.condition ?? "", assignment);
    if (matches) dm += d.dm;
  }
  const dieN = cm.resultRoll?.die === "2D" ? 2 : 1;
  let dieTotal = 0;
  for (let i = 0; i < dieN; i++) dieTotal += roll(1);
  let r = dieTotal + dm;
  // BP-spend gate matches tryMitigate: "manual" policy never auto-spends.
  // Auto modes drive the result toward Dismissed (r=1) within available BP.
  if (ch.acgState && ch.acgState.bpAutoPolicy !== "manual") {
    while (r > 1 && ch.acgState.browniePoints > 0) {
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

function resultDmApplies(
  ch: Character, condition: string, assignment?: string,
): boolean {
  const lc = condition.toLowerCase();
  const rankCode = ch.acgState?.rankCode ?? "";
  if (lc.includes("e7 to e9")) {
    const m = rankCode.match(/^E(\d+)$/);
    return !!m && parseInt(m[1]!, 10) >= 7 && parseInt(m[1]!, 10) <= 9;
  }
  if (lc.includes("o7+")) {
    const m = rankCode.match(/^O(\d+)$/);
    return !!m && parseInt(m[1]!, 10) >= 7;
  }
  if (lc.includes("combat assignment")) {
    if (!assignment) return false;
    const pw = getAcgPathway(ch.editionId, ch.acgState?.pathway);
    return pw?.combatAssignments?.includes(assignment) ?? false;
  }
  if (lc.includes("training")) return assignment === "Training";
  if (lc.includes("command duty")) return !!ch.acgState?.inCommand;
  return false;
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
    ch.acgState.dishonorablyDischarged = true;
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
      // 2D months consumes the current year of service. We mark the year as
      // "jail-served" so it counts toward terms but provides no skills or
      // promotion (commission/promotion already short-circuit on
      // shortTermThisTerm / equivalent jail flag).
      const months = roll(1) + roll(1);
      ch.acgState.jailMonthsThisYear = months;
      ch.log(ev.statusChange(
        "jailed",
        `${months} months — consumes this year of service`,
      ));
      return;
    }
    // "Jail 1D years; ..." or "Jail 2D years; ..."
    ch.acgState.dishonorablyDischarged = true;
    ch.acgState.musterRollPenalty =
      (ch.acgState.musterRollPenalty ?? 0) - 3;
    ch.acgState.pensionForfeit = true;
    const yearsMatch = result.match(/jail\s+(\d+)D\s+years/i);
    if (yearsMatch) {
      const dice = parseInt(yearsMatch[1]!, 10);
      let years = 0;
      for (let i = 0; i < dice; i++) years += roll(1);
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
    ch.acgState.deathSentence = true;
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
      for (let i = 0; i < dice; i++) killed += roll(1);
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
