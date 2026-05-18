// Direct coverage for #4: Zod schema validation at edition load. The
// existing suite only confirms "both editions' JSON validates" via
// successful import — that would still pass if validation were a no-op.
// These tests confirm the schema actually rejects malformed input.

import { describe, expect, it } from "vitest";
import { parseRules } from "../lib/traveller/editions/schema";
import { getEdition, getAcgPathway } from "../lib/traveller/editions";

describe("parseRules (#4)", () => {
  it("accepts an empty rules block", () => {
    expect(() => parseRules({}, "test")).not.toThrow();
  });

  it("accepts a well-formed retirement sub-block", () => {
    const rules = {
      retirement: {
        eligibleAfterCompletedTerm: 5,
        basePensionCredits: 4000,
        pensionCreditsPerTerm: 2000,
      },
    };
    const parsed = parseRules(rules, "test");
    expect(parsed.retirement?.eligibleAfterCompletedTerm).toBe(5);
  });

  it("rejects retirement.eligibleAfterCompletedTerm with wrong type", () => {
    const rules = {
      retirement: { eligibleAfterCompletedTerm: "five" }, // should be number
    };
    expect(() => parseRules(rules, "test")).toThrow(
      /test rules block failed schema validation/,
    );
  });

  it("rejects musterOutRolls.rankBands with malformed entry", () => {
    const rules = {
      musterOutRolls: {
        rankBands: [{ ranks: [1, 2], additionalRolls: "three" }],
      },
    };
    expect(() => parseRules(rules, "test")).toThrow(
      /test rules block failed schema validation/,
    );
  });

  it("rejects survival.onFailure with an invalid enum value", () => {
    const rules = { survival: { onFailure: "explode" } };
    expect(() => parseRules(rules, "test")).toThrow(/onFailure/);
  });

  it("accepts unknown extra keys (passthrough)", () => {
    // Schema uses .passthrough() so new fields don't break old editions.
    const rules = { newFutureField: { foo: "bar" } };
    expect(() => parseRules(rules, "test")).not.toThrow();
  });
});

describe("getEdition exposes the typed rules view (#4)", () => {
  it("returns the parsed rules object as a typed field", () => {
    const ed = getEdition("mt-megatraveller");
    // The field exists and is the typed Zod-parsed view.
    expect(ed.rules).toBeDefined();
    // MT has a retirement block; CT-classic does too.
    expect(typeof ed.rules.retirement?.eligibleAfterCompletedTerm).toBe("number");
  });

  it("CT-classic also exposes typed rules", () => {
    const ed = getEdition("ct-classic");
    expect(ed.rules).toBeDefined();
  });
});

describe("getAcgPathway helper (#4)", () => {
  it("returns the typed pathway data for a known key", () => {
    const merc = getAcgPathway("mt-megatraveller", "mercenary");
    expect(merc).toBeDefined();
    // AcgPathwayData has typed fields like ocsAdvancement, combatAssignments.
    expect(merc?.combatAssignments).toBeDefined();
  });

  it("returns undefined for an unknown pathway key", () => {
    expect(getAcgPathway("mt-megatraveller", "bogus")).toBeUndefined();
  });

  it("returns undefined for null/undefined keys", () => {
    expect(getAcgPathway("mt-megatraveller", null)).toBeUndefined();
    expect(getAcgPathway("mt-megatraveller", undefined)).toBeUndefined();
  });

  it("returns undefined when the edition has no ACG block", () => {
    // CT-classic has no advancedCharacterGeneration block.
    expect(getAcgPathway("ct-classic", "mercenary")).toBeUndefined();
  });
});
