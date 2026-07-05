import { describe, it, expect } from "vitest";
import * as core from "@/lib/traveller/core";

describe("core barrel", () => {
  it("re-exports the edition-agnostic engine primitives", () => {
    const expected = [
      "roll", "arnd", "rndInt", "Rng",
      "cascadePoolByKey", "cascadePoolForLabel", "isCascadeLabel", "cascadeKeyForLabel",
      "applyCell",
      "evaluateDM", "evaluatePredicate", "sumPredicateDms", "buildPredicateContext",
      "normalizeAttr", "rankNum",
      "cashDmFor", "benefitDmFor", "maxCashRolls",
      "requireRule", "parseDieCount",
    ];
    for (const name of expected) {
      expect(core, `core must export ${name}`).toHaveProperty(name);
    }
  });
});
