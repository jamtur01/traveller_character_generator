// Survival step. CT default treats failure as death (TTB p. 11). MT default
// treats failure as injury forcing immediate muster-out, with death as an
// optional rule (PM p. 16). The edition declares which under
// rules.survival.onFailure ("death" | "musterOut"); legacy editions without
// the block fall through to "death" for back-compat with CT behaviour.

import type { StepFn } from "./types";

export const survivalStep: StepFn = ({ character, service, edition }) => {
  if (service.checkSurvival(character)) return;
  const onFailure = (edition.data.rules as
    | { survival?: { onFailure?: "death" | "musterOut" } }
    | undefined)?.survival?.onFailure ?? "death";
  if (onFailure === "musterOut") {
    character.history.push("Injured in service; mustered out.");
    character.activeDuty = false;
    return;
  }
  character.history.push("Death in service.");
  character.deceased = true;
  character.activeDuty = false;
};
