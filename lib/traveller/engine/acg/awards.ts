// Shared award helpers — decorations, brownie points, court martial.
// Brownie point values and court-martial dice/DMs are read from the
// edition JSON (common.browniePoints, common.courtMartial). Per MT
// Players' Manual p. 46-47.

import { roll } from "../../random";
import { getEdition } from "../../editions";
import type { Character } from "../../character";

interface BrownieAward { event: string; points: number }

function getSkillLevel(ch: Character, skill: string): number {
  for (const [name, level] of ch.skills) {
    if (name === skill) return level;
  }
  return 0;
}

function commonAcg(ch: Character): Record<string, unknown> | null {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  return (acg?.common as Record<string, unknown> | undefined) ?? null;
}

/** Look up the brownie-point award for a given event string in
 *  common.browniePoints.awards. Returns null if not configured. */
function bpAwardFor(ch: Character, event: string): number | null {
  const common = commonAcg(ch);
  const awards = (common?.browniePoints as { awards?: BrownieAward[] } | undefined)?.awards;
  if (!Array.isArray(awards)) return null;
  const match = awards.find((a) =>
    a.event.toLowerCase().includes(event.toLowerCase()),
  );
  return match ? match.points : null;
}

export function awardBrownie(ch: Character, count: number, reason: string): void {
  if (!ch.acgState) return;
  ch.acgState.browniePoints += count;
  ch.verboseHistory(`Brownie Point +${count}: ${reason}`);
}

export function awardDecoration(
  ch: Character,
  award: "MCUF" | "MCG" | "SEH" | "Purple Heart",
): void {
  if (!ch.acgState) return;
  ch.acgState.decorations.push(award);
  ch.history.push(`Decorated: ${award}`);
  const bp = bpAwardFor(ch, `${award} received`) ?? 0;
  if (bp > 0) awardBrownie(ch, bp, `Decoration ${award}`);
  // SEH carries an automatic +1 rank at muster-out (manual p. 46).
  if (award === "SEH") {
    ch.acgState.sehPromotionPending = true;
  }
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
    if (o.browniePointsAllowed && ch.acgState) {
      while (total < o.avoidTarget && ch.acgState.browniePoints > 0) {
        ch.acgState.browniePoints -= 1;
        ch.acgState.browniePointsSpent += 1;
        total += 1;
        ch.verboseHistory("Spent 1 brownie point to avoid court martial");
      }
    }
    if (total >= o.avoidTarget) {
      ch.verboseHistory(`Court martial avoided (rolled ${baseTotal}, used ${total - baseTotal} BP, vs ${o.avoidTarget}+)`);
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
  if (ch.acgState) {
    while (r > 1 && ch.acgState.browniePoints > 0) {
      ch.acgState.browniePoints -= 1;
      ch.acgState.browniePointsSpent += 1;
      r -= 1;
      ch.verboseHistory("Spent 1 brownie point to mitigate court martial");
    }
  }
  const outcome = cm.dieResults.find((o) => o.roll === r)
    ?? cm.dieResults.reduce((closest, o) =>
        Math.abs(o.roll - r) < Math.abs(closest.roll - r) ? o : closest,
        cm.dieResults[0]!);
  const result = outcome.result;
  ch.history.push(`Court Martial: ${result}`);
  ch.verboseHistory(`Court Martial outcome (roll=${r}, dm=${dm}): ${result}`);

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
    const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
      Record<string, unknown> | undefined;
    const pathway = ch.acgState?.pathway;
    if (!acg || !pathway) return false;
    const pw = acg[pathway] as { combatAssignments?: string[] } | undefined;
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
    const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
      Record<string, unknown> | undefined;
    const pathway = ch.acgState?.pathway;
    if (!acg || !pathway) return false;
    const pw = acg[pathway] as { combatAssignments?: string[] } | undefined;
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
    ch.activeDuty = false;
    ch.acgState.dishonorablyDischarged = true;
    ch.acgState.musterRollPenalty =
      (ch.acgState.musterRollPenalty ?? 0) - 3;
    ch.acgState.pensionForfeit = true;
    ch.history.push("Dishonorably discharged: -3 mustering-out rolls, no pension.");
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
      ch.history.push(`Jailed ${months} months — consumes this year of service.`);
      return;
    }
    // "Jail 1D years; ..." or "Jail 2D years; ..."
    const yearsMatch = result.match(/jail\s+(\d+)D\s+years/i);
    if (yearsMatch) {
      const dice = parseInt(yearsMatch[1]!, 10);
      let years = 0;
      for (let i = 0; i < dice; i++) years += roll(1);
      ch.age += years;
      ch.history.push(`Imprisoned for ${years} years (${dice}D rolled); service ends.`);
    } else {
      ch.history.push("Imprisoned; service ends.");
    }
    ch.activeDuty = false;
    ch.acgState.dishonorablyDischarged = true;
    ch.acgState.musterRollPenalty =
      (ch.acgState.musterRollPenalty ?? 0) - 3;
    ch.acgState.pensionForfeit = true;
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
    ch.activeDuty = false;
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
      ch.history.push(`Sentenced to death; escaped.${bountyTxt}${killedTxt}`);
    } else {
      ch.history.push("Sentenced to death. No benefits or pension.");
      ch.deceased = true;
    }
    return;
  }
}

function reduceRank(ch: Character, mag: number): void {
  if (!ch.acgState) return;
  // Find pathway rank list and step backwards.
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
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
