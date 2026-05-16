// Step registry. Each step function takes a StepContext and mutates the
// Character. Steps are looked up by id from the edition's JSON
// lifecycle.terms array.

import { allocateSkillsStep } from "./allocateSkills";
import { commissionStep } from "./commission";
import { promotionStep } from "./promotion";
import { specialDutyStep } from "./specialDuty";
import { survivalStep } from "./survival";
import type { StepRegistry } from "./types";

export const STEP_REGISTRY: StepRegistry = {
  allocateSkills: allocateSkillsStep,
  survival: survivalStep,
  commission: commissionStep,
  promotion: promotionStep,
  specialDuty: specialDutyStep,
};

export type { StepContext, StepFn, StepRegistry } from "./types";
