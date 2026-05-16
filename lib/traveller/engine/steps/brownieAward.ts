// ACG step: award 1 brownie point per completed term. MT awards brownie
// points for term completion plus several other triggers (academy
// graduation, decoration); this step covers the per-term case. The
// step runs at the end of the term sequence, after survival has been
// checked — so a character who died gets no brownie point for that term.

import type { StepFn } from "./types";

export const brownieAwardStep: StepFn = ({ character }) => {
  if (character.deceased) return;
  if (!character.useAcg) return;
  character.browniePoints += 1;
  character.verboseHistory("Brownie point awarded for completed term");
};
