// ACG runner. Drives the per-year + per-term cycle for a character on
// the Advanced Character Generation path. Replaces the basic-flow
// `runTermSteps` for ACG characters.
//
// The runner delegates pathway-specific logic to pathway modules.

import type { Character } from "../../character";
import { awardBrownie } from "./awards";
import { getMercenaryPathway } from "./pathways/mercenary";
import { getNavyPathway } from "./pathways/navy";
import { getScoutPathway } from "./pathways/scout";
import { getMerchantPrincePathway } from "./pathways/merchantPrince";
import type { AcgPathwayId } from "./types";

interface PathwayImpl {
  pathway: string;
  enlist: (ch: Character, ...args: unknown[]) => void;
  initialTraining?: (ch: Character) => void;
  commandDuty?: (ch: Character) => void;
  rollAssignment: (ch: Character) => string;
  resolveAssignment: (ch: Character, assignment: string) => void;
  specialAssignment?: (ch: Character) => void;
  retention?: (ch: Character, assignment: string) => void;
  reenlist: (ch: Character) => boolean;
  startOfTerm?: (ch: Character) => void;
}

const REGISTRY: Record<AcgPathwayId, () => PathwayImpl> = {
  mercenary: getMercenaryPathway as () => PathwayImpl,
  navy: getNavyPathway as () => PathwayImpl,
  scout: getScoutPathway as () => PathwayImpl,
  merchantPrince: getMerchantPrincePathway as () => PathwayImpl,
};

function getPathwayImpl(ch: Character): PathwayImpl {
  if (!ch.acgState) throw new Error("Character has no acgState; not on ACG path");
  const factory = REGISTRY[ch.acgState.pathway];
  if (!factory) {
    throw new Error(`No ACG pathway implementation for "${ch.acgState.pathway}"`);
  }
  return factory();
}

/** Run a single one-year assignment. Each term contains four such years. */
export function runAcgYear(ch: Character): void {
  if (ch.deceased || !ch.activeDuty) return;
  if (!ch.acgState) throw new Error("Cannot run ACG year on non-ACG character");
  const p = getPathwayImpl(ch);

  // First year of the first term is initial training (no normal cycle).
  if (ch.terms === 0 && ch.acgState.year === 1 && p.initialTraining) {
    p.initialTraining(ch);
    ch.acgState.year += 1;
    return;
  }

  // Officer command duty (no-op for enlisted).
  if (p.commandDuty && !ch.acgState.justRetained) {
    p.commandDuty(ch);
  }

  // Roll assignment (or use retained).
  const assignment = p.rollAssignment(ch);
  ch.acgState.currentAssignment = assignment;

  if (assignment === "Special Duty" || assignment.toLowerCase() === "specialduty") {
    if (p.specialAssignment) {
      p.specialAssignment(ch);
    }
  } else {
    p.resolveAssignment(ch, assignment);
  }

  // Retention roll (if alive and still serving).
  if (p.retention && ch.activeDuty && !ch.deceased) {
    p.retention(ch, assignment);
  }

  ch.acgState.year += 1;
}

/** Run a full four-year term. */
export function runAcgTerm(ch: Character): void {
  if (!ch.acgState) throw new Error("Cannot run ACG term on non-ACG character");
  if (ch.deceased || !ch.activeDuty) return;
  const p = getPathwayImpl(ch);
  if (p.startOfTerm) p.startOfTerm(ch);
  ch.acgState.year = 1;
  ch.acgState.promotedThisTerm = false;
  for (let y = 0; y < 4; y++) {
    if (ch.deceased || !ch.activeDuty) break;
    runAcgYear(ch);
  }
  if (!ch.deceased && ch.activeDuty) {
    awardBrownie(ch, 1, "Completed four-year term");
    ch.terms += 1;
    ch.age += 4;
  }
}

/** Reenlistment check at the end of a term. */
export function runAcgReenlist(ch: Character): boolean {
  if (!ch.acgState) return false;
  if (ch.deceased || !ch.activeDuty) return false;
  return getPathwayImpl(ch).reenlist(ch);
}
