// Allocate the per-term skill points based on service and term.
//
// CT (TTB p. 24): scouts and certain CotI rankless careers gain 2 per term;
// otherwise 2 in the first term, 1 in every later term.
//
// MT term1Bonus config: services with skillsPerTerm=1 gain +1 in term 1.
// MT skillsPerTerm=2 services get 2 per term, no first-term boost (the
// boost is implicit in the per-term count).

import type { ServiceKey } from "../../types";
import type { StepFn } from "./types";

const CT_TWO_PER_TERM: ServiceKey[] = [
  "scouts", "belters", "doctors", "rogues", "scientists", "hunters",
];

export const allocateSkillsStep: StepFn = ({ character, service, config }) => {
  // MT-shape config: service-data declares skillsPerTerm (1 or 2); term-1
  // bonus adds +1 for skillsPerTerm=1 services.
  const skillsPerTerm = service.skillsPerTerm;
  if (typeof skillsPerTerm === "number") {
    let n = skillsPerTerm;
    if (config.term1Bonus && skillsPerTerm === 1 && character.terms === 1) n += 1;
    character.skillPoints += n;
    return;
  }

  // CT-shape: hardcoded rule based on service key + first-term boost.
  if (CT_TWO_PER_TERM.includes(character.service)) {
    character.skillPoints += 2;
  } else if (character.terms === 1) {
    character.skillPoints += 2;
  } else {
    character.skillPoints += 1;
  }
};
