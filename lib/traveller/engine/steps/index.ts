// Step registry. Each step function takes a StepContext and mutates the
// Character. Steps are looked up by id from the edition's JSON
// lifecycle.terms array.

import { allocateSkillsStep } from "./allocateSkills";
import { brownieAwardStep } from "./brownieAward";
import { commissionStep } from "./commission";
import { decorationCheckStep } from "./decorationCheck";
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
  // ACG-only steps. They short-circuit for non-ACG characters, so it's
  // safe to include them in any edition's lifecycle even if the edition
  // doesn't have ACG — but only MT uses them.
  decorationCheck: decorationCheckStep,
  brownieAward: brownieAwardStep,
};

export type { StepContext, StepFn, StepRegistry } from "./types";
