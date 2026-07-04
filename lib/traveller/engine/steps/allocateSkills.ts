// Allocate the per-term skill points. Reads rules.skillEligibility from the
// active edition so per-edition variation (CT's scouts/CotI-rankless 2/term,
// MT's services declaring skillsPerTerm explicitly) is purely data.
//
// Algorithm:
//   1. If serviceData declares skillsPerTerm (MT-style), use it.
//   2. Else if rules.skillEligibility.perTermExceptions[serviceKey] is set,
//      use that value.
//   3. Else use subsequentTerm (default 1).
//   4. On the first term, add config.term1Bonus.extraSkills for services
//      granting exactly config.term1Bonus.onlyForSkillsPerTerm skills/term.
//   5. Term-1 doubling for CT's "initialTerm": 2 is encoded by giving 1 by
//      default + 1 first-term bonus.

import type { StepFn } from "./types";
import { requireRule } from "@/lib/traveller/editions/strict";

interface SkillEligibility {
  initialTerm?: number;
  subsequentTerm?: number;
  perTermExceptions?: Record<string, number>;
}

/** Structured first-term bonus (PM p. 15/17), from
 *  lifecycle.terms[allocateSkills].config.term1Bonus. */
interface Term1Bonus {
  extraSkills: number;
  onlyForSkillsPerTerm: number;
}

export const allocateSkillsStep: StepFn = ({
  ch, service, edition, config,
}) => {
  const elig = edition.rules.skillEligibility as
    SkillEligibility | undefined;
  const exceptions = elig?.perTermExceptions ?? {};
  const subsequent = requireRule(
    elig?.subsequentTerm, "rules.skillEligibility.subsequentTerm", "TTB p. 18 / PM p. 15",
  );
  const initial = requireRule(
    elig?.initialTerm, "rules.skillEligibility.initialTerm", "TTB p. 18 / PM p. 15",
  );

  // 1. Explicit per-service skillsPerTerm from ServiceData wins.
  if (typeof service.skillsPerTerm === "number") {
    let n = service.skillsPerTerm;
    const bonus = config.term1Bonus as Term1Bonus | undefined;
    if (bonus && ch.terms === 1 &&
        service.skillsPerTerm === bonus.onlyForSkillsPerTerm) {
      n += bonus.extraSkills;
    }
    ch.skillPoints += n;
    return;
  }

  // 2. Per-service exception list.
  const except = exceptions[ch.service];
  if (typeof except === "number") {
    ch.skillPoints += except;
    return;
  }

  // 3. Default: initial on term 1, subsequent thereafter.
  ch.skillPoints += ch.terms === 1 ? initial : subsequent;
};
