// End-of-term reenlistment: rolls 2D, dispatches to per-edition rules
// (mandatory at 12, mandatory retire after term 7 in CT, inverse-leave
// for bureaucrats, etc.).

import type { Character } from "../character";
import { getEdition } from "../editions";
import { roll } from "../random";
import { event as ev } from "../history";
import { runAcgReenlist } from "../engine/acg/runner";

/** Run the end-of-term reenlistment check. Mutates ch.chargenStatus
 *  via the endChargen* helpers when the character is forced out. */
export function doReenlistmentStep(ch: Character): void {
  // PM p. 16: short-term forces the character to leave after 2 years
  // — no reenlistment roll.
  if (ch.shortTermThisTerm) return;
  // F2/F3: PM p. 16 disability conditions force muster regardless of
  // the reenlistment roll. Block reenlist for both basic and ACG flows.
  const dis = ch.isDisabled();
  if (dis.disabled) {
    ch.endChargenRetired(`disability: ${dis.reasons.join("; ")}`);
    return;
  }
  if (ch.useAcg && ch.acgState) {
    const keep = runAcgReenlist(ch);
    if (!keep) {
      const reason = ch.acgState.reenlistDenialReason;
      delete ch.acgState.reenlistDenialReason;
      // Denied: chargen continues to muster-out, so we don't fire
      // endChargen* — just record the reenlist outcome and let the
      // status flip to mustered when the UI rolls benefits.
      ch.chargenStatus = { kind: "retired", reason: reason ?? "denied reenlistment" };
      ch.endedAsRetired = ch.isRetirementEligible();
      ch.log(ev.reenlistment("denied", undefined, undefined, reason));
    } else if (ch.mandatoryReenlistment) {
      ch.log(ev.reenlistment("mandatory"));
    } else {
      ch.log(ev.reenlistment("voluntary"));
    }
    return;
  }
  const def = ch.serviceDef();
  const reenlistRoll = roll(2);
  const target = def.reenlistThrow;
  if (reenlistRoll === 12) {
    ch.enterMandatoryReenlist();
    ch.log(ev.reenlistment("mandatory", reenlistRoll, target));
    return;
  }
  // CT mandates retirement at end of term 7. MT does not (voluntary
  // any-term per PM p. 17). Read the cap from edition rules.
  const rules = getEdition(ch.editionId).data.rules as {
    reenlistment?: {
      mandatoryRetireAfterTerm?: number;
      voluntaryAnyTerms?: boolean;
    };
  } | undefined;
  const cap = rules?.reenlistment?.mandatoryRetireAfterTerm ?? 7;
  const voluntaryAnyTerms = rules?.reenlistment?.voluntaryAnyTerms === true;
  if (ch.terms >= cap && !voluntaryAnyTerms) {
    ch.endedAsRetired = true;
    ch.chargenStatus = { kind: "retired", reason: "mandatory retirement" };
    ch.log(ev.reenlistment("retired", reenlistRoll, target));
    return;
  }
  if (def.inverseReenlist) {
    if (reenlistRoll >= target) {
      ch.endedAsRetired = ch.isRetirementEligible();
      ch.chargenStatus = { kind: "retired", reason: "released from service" };
      ch.log(ev.reenlistment("released", reenlistRoll, target));
    } else {
      ch.log(ev.reenlistment("heldOver", reenlistRoll, target));
    }
    return;
  }
  if (reenlistRoll < target) {
    // PM p. 17: a character denied reenlistment after 5+ terms still
    // retires (and gets the cash-table +1 retirement DM), unless their
    // service is on the no-retirement excludedServices list.
    ch.endedAsRetired = ch.isRetirementEligible();
    ch.chargenStatus = { kind: "retired", reason: "denied reenlistment" };
    ch.log(ev.reenlistment("denied", reenlistRoll, target));
    return;
  }
  // The throw only determines eligibility. The player still gets to
  // choose between Run Term and Muster Out at the next term phase, so
  // we record the rule outcome (eligible) rather than the player's
  // pending decision.
  ch.log(ev.reenlistment("voluntary", reenlistRoll, target));
}
