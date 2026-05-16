// ACG step: decoration check after surviving the term. MT's full system
// has per-assignment decoration targets (e.g., raid 6+, internal security
// 12+) that vary by branch/pathway. Until ACG assignment rolls are wired,
// this step uses a fixed target (default 10+) and applies the standard
// award ladder from common.decorationAndSurvival:
//
//   - decoration target met            → MCUF (Meritorious Conduct Under Fire)
//   - +3 to +5 over the target         → MCG  (Medal for Conspicuous Gallantry)
//   - +6 or more over the target       → SEH  (Starburst for Extreme Heroism)
//
// Skipped if the character died this term. Idempotent per term — the step
// only adds at most one award.

import { roll } from "../../random";
import type { StepFn } from "./types";

export const decorationCheckStep: StepFn = ({ character, config }) => {
  if (character.deceased) return;
  if (!character.useAcg) return;
  const target = (config.target as number | undefined) ?? 10;
  const r = roll(2);
  const margin = r - target;
  if (margin < 0) {
    character.verboseHistory(`Decoration roll ${r} vs ${target} — no decoration`);
    return;
  }
  let award: string;
  if (margin >= 6) award = "SEH";
  else if (margin >= 3) award = "MCG";
  else award = "MCUF";
  character.decorations.push(award);
  character.verboseHistory(`Decoration roll ${r} vs ${target} — awarded ${award}`);
};
