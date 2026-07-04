// Muster-out + anagathics audits against MT PM pp. 15-18.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

describe("Anagathics audit — PM p. 18", () => {
  it("Eligibility: age 30+ at end of 3rd term", () => {
    const r = getEdition("mt-megatraveller").rules.anagathics;
    expect(r?.eligibility?.minAge).toBe(30);
    expect(r?.eligibility?.minTerms).toBe(3);
  });

  it("Survival DM: -1 (-2 for nobles)", () => {
    const r = getEdition("mt-megatraveller").rules.anagathics;
    expect(r?.survivalDm).toBe(-1);
    expect(r?.nobleSurvivalDm).toBe(-2);
  });

  it("Availability target 12+ on 2D, +3/+2/+1 starport A/B/C, +1/+2/+3 tech ES/AS/HS", () => {
    const r = getEdition("mt-megatraveller").rules.anagathics;
    expect(r?.availability?.target).toBe(12);
    const sp = r?.availability?.dms?.byStarport;
    expect(sp?.A).toBe(3);
    expect(sp?.B).toBe(2);
    expect(sp?.C).toBe(1);
    const tech = r?.availability?.dms?.byTech;
    expect(tech?.["Early Stellar"]).toBe(1);
    expect(tech?.["Avg Stellar"]).toBe(2);
    expect(tech?.["High Stellar"]).toBe(3);
  });

  it("Maintained supply: auto-save 2 characteristics; cash cap 2 rolls", () => {
    const r = getEdition("mt-megatraveller").rules.anagathics;
    expect(r?.agingAutoSavesPerTerm).toBe(2);
    expect(r?.cashRollCap).toBe(2);
  });

  it("Retry: one retry if extra survival roll passes; survival fail = short-term muster", () => {
    const r = getEdition("mt-megatraveller").rules.anagathics;
    const retry = (r?.retry ?? {}) as Record<string, unknown>;
    expect(retry.extraSurvivalRequired).toBe(true);
    expect(retry.onFailForcedShortTermMuster).toBe(true);
  });
});

describe("Survival rule (PM p. 16)", () => {
  it("MT default: survival failure = short term (not death)", () => {
    const r = getEdition("mt-megatraveller").rules.survival;
    expect(r?.onFailure).toBe("shortTerm");
    expect(r?.shortTermYears).toBe(2);
    expect(r?.fullTermYears).toBe(4);
    // The short-term muster-benefit exclusion is enforced by shortTermsCount
    // (tested in anagathics.test.ts), not a config flag — the dead
    // rules.survival.shortTermDoesNotCountForMusterBenefits key was removed.
  });

  it("CT default: survival failure = death", () => {
    const r = getEdition("ct-classic").rules.survival;
    // CT TTB p. 11 default behaviour is death; the optional rule
    // (muster out instead) lives in supplement 4.
    expect(r?.onFailure ?? "death").toBe("death");
  });
});

describe("Retirement (PM p. 17)", () => {
  it("MT: retire after term 5+; excludes Barbarians, Pirates, Rogues, Scouts", () => {
    const r = getEdition("mt-megatraveller").rules.retirement;
    expect(r?.eligibleAfterCompletedTerm).toBe(5);
    const excluded = r?.excludedServices ?? [];
    expect(excluded).toEqual(expect.arrayContaining([
      "barbarians", "pirates", "rogues", "scouts",
    ]));
    expect(r?.anagathicTermsExcluded).toBe(true);
  });
});

describe("Disability (PM p. 16 F2/F3)", () => {
  it("MT: age 66+ or any physical attr ≤ 1 forces muster", () => {
    const r = getEdition("mt-megatraveller").rules.disability;
    expect(r?.atAgeLine).toBe(66);
    expect(r?.physicalAttributeAtMost).toBeDefined();
    // PM line: "two of the three physical attributes [...] reach 1 or
    // less" — engine reads as either single attribute at 1 or sum at
    // some threshold. Both possible representations.
    expect((r?.physicalAttributeAtMost ?? 0) <= 1).toBe(true);
  });
});
