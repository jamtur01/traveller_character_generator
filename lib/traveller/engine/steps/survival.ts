// Survival step. Death-on-fail is signalled by setting deceased/activeDuty
// on the Character; the runner halts the rest of the term sequence.

import type { StepFn } from "./types";

export const survivalStep: StepFn = ({ character, service }) => {
  if (service.checkSurvival(character)) return;
  character.history.push("Death in service.");
  character.deceased = true;
  character.activeDuty = false;
};
