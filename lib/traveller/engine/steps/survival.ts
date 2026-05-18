// Survival step. CT default treats failure as death (TTB p. 11). MT default
// treats failure as a short 2-year term (PM p. 16: "Failure to successfully
// achieve the survival throw forces the character to leave the service after
// having served only two years of the four-year term. The short term is not
// counted for mustering out benefits. However, the character may still roll
// for special duty and take the indicated skill rolls if successful. The
// character may not roll for commission/position or promotion during the
// short term."). Optional rule in either edition makes failure death.
//
// The edition's rules.survival.onFailure selects the mode:
//   "death"     — CT default, character dies, term halts.
//   "shortTerm" — MT default, sets shortTermThisTerm, rewinds 2 years,
//                  flags activeDuty=false so reenlistment forces muster.
//   "musterOut" — back-compat alias for legacy MT JSON without short-term
//                  short-term semantics; same as "shortTerm" but does not
//                  rewind age (preserved for any callers relying on the
//                  old behavior; not used by current MT JSON).

import { event as ev } from "../../history";
import type { StepFn } from "./types";

export const survivalStep: StepFn = ({ character, service, edition }) => {
  if (service.checkSurvival(character)) return;
  const onFailure = (edition.data.rules as
    | { survival?: { onFailure?: "death" | "musterOut" | "shortTerm" } }
    | undefined)?.survival?.onFailure ?? "death";
  if (onFailure === "shortTerm" || onFailure === "musterOut") {
    // doServiceTermStep already added 4 years for the full term; rewind 2
    // because only 2 years of the 4-year term were served.
    if (onFailure === "shortTerm") {
      character.age -= 2;
    }
    character.shortTermThisTerm = true;
    character.shortTermsCount += 1;
    character.activeDuty = false;
    character.log(ev.statusChange(
      "shortTerm", "injured in service — only 2 years of this term served",
    ));
    return;
  }
  character.log(ev.endGeneration("deceased", "killed in service"));
  character.deceased = true;
  character.activeDuty = false;
};
