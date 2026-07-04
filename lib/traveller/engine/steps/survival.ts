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

import { event as ev } from "@/lib/traveller/history";
import type { StepFn } from "./types";

export const survivalStep: StepFn = ({ ch, service, edition }) => {
  if (service.checkSurvival(ch)) return;
  const onFailure = edition.rules.survival?.onFailure ?? "death";
  if (onFailure === "shortTerm") {
    const s = edition.rules.survival;
    const short = s?.shortTermYears ?? 2;
    const reason = `injured in service — only ${short} years of this term served`;
    // doServiceTermStep already added the full term's years; rewind to the
    // short-term length.
    ch.age -= ch.fullTermYears() - short;
    ch.enterShortTerm(reason);
    ch.log(ev.statusChange("shortTerm", reason));
    return;
  }
  ch.endChargenDeceased("killed in service");
};
