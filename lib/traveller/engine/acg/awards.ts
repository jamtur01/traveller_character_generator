// Shared award helpers — decorations, brownie points, court martial.
//
// Per MT Players' Manual p. 46:
//   MCUF: 1 BP, MCG: 2 BP, SEH: 3 BP. Purple Heart: no BP.
//   SEH recipients get an automatic +1 rank at muster-out (handled at
//   muster, not here).

import { roll } from "../../random";
import { getEdition } from "../../editions";
import type { Character } from "../../character";

export function awardBrownie(ch: Character, count: number, reason: string): void {
  if (!ch.acgState) return;
  ch.acgState.browniePoints += count;
  ch.verboseHistory(`Brownie Point +${count}: ${reason}`);
}

export function awardDecoration(
  ch: Character,
  award: "MCUF" | "MCG" | "SEH",
): void {
  if (!ch.acgState) return;
  ch.acgState.decorations.push(award);
  ch.history.push(`Decorated: ${award}`);
  const bp = award === "MCUF" ? 1 : award === "MCG" ? 2 : 3;
  awardBrownie(ch, bp, `Decoration ${award}`);
}

interface CourtMartialOutcome {
  roll: number;
  result: string;
}

/** Court Martial — per common.courtMartial. Triggered when a decoration
 *  roll fails by 6+. Outcomes range from "Case dismissed" through reprimands,
 *  rank reductions, dishonorable discharge, and prison. */
export function runCourtMartial(ch: Character): void {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) return;
  const common = acg.common as { courtMartial?: { dieResults: CourtMartialOutcome[] } };
  if (!common?.courtMartial?.dieResults) return;

  // Brownie points may be spent on this roll (per manual p.46). For
  // auto-resolve mode we spend them automatically to mitigate the worst
  // outcomes — but only if the character would otherwise be DD'd or jailed.
  let r = roll(1) + roll(1) - 6; // The table indexes 0-6 typically; the JSON
                                 // stores roll values from -1 (dismissed) up.
  // Brownie point auto-spend: try to push the result down toward 0.
  while (r > 1 && ch.acgState && ch.acgState.browniePoints > 0) {
    ch.acgState.browniePoints -= 1;
    ch.acgState.browniePointsSpent += 1;
    r -= 1;
    ch.verboseHistory("Spent 1 brownie point to mitigate court martial");
  }

  const outcome = common.courtMartial.dieResults.find((o) => o.roll === r);
  const result = outcome?.result ?? "Reprimand";
  ch.history.push(`Court Martial: ${result}`);
  ch.verboseHistory(`Court Martial outcome (roll=${r}): ${result}`);

  // Translate the common outcomes into engine state. The JSON's `result`
  // strings are free-form so we pattern-match.
  applyCourtMartialResult(ch, result);
}

function applyCourtMartialResult(ch: Character, result: string): void {
  const lc = result.toLowerCase();
  if (lc.includes("dismissed")) return;
  if (lc.includes("reprimand")) {
    // -N to next promotion. Tracked via a transient field; for now log only.
    return;
  }
  if (lc.includes("reduce rank")) {
    // Try to extract magnitude.
    const m = result.match(/-(\d+)/);
    const mag = m ? parseInt(m[1]!, 10) : 1;
    reduceRank(ch, mag);
    return;
  }
  if (lc.includes("dishonorable") || lc.includes("dd")) {
    ch.activeDuty = false;
    ch.history.push("Dishonorably discharged.");
    return;
  }
  if (lc.includes("jail")) {
    ch.activeDuty = false;
    ch.history.push("Imprisoned; service ends.");
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
