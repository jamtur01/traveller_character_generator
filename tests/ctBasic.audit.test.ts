// CT TTB basic chargen audit. Existing tests/audit/ct.services.*.audit.test.ts
// covers the per-service throws/DMs/tables exhaustively; this file adds
// the rules-level checks that aren't covered there.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition } from "../lib/traveller/editions";
import { musterOutRolls, musterOutPay } from "../lib/traveller/chargen/muster";

afterEach(() => { vi.restoreAllMocks(); });

describe("CT TTB chargen rules (TTB p. 17-18)", () => {
  it("Attribute cap: max 15, min 1 social (TTB p. 17)", () => {
    const caps = getEdition("ct-classic").rules.attributeCaps;
    expect(caps?.max).toBe(15);
    expect(caps?.socialMin).toBe(1);
  });

  it("Reenlist 12 = mandatory (TTB p. 18)", () => {
    const r = getEdition("ct-classic").rules.reenlistment as
      Record<string, unknown> | undefined;
    expect(r?.mandatoryOnExactRoll).toBe(12);
  });

  it("Mandatory retire after term 7 (TTB p. 25): 'A character may serve up to seven terms of service voluntarily'", () => {
    // The JSON used to call this `voluntaryTermsThrough` — a name the
    // engine never read. The engine reads `mandatoryRetireAfterTerm`
    // (defaulting to 7 if unset), so the CT JSON's old field name was
    // dead code; only the default kept the rule working.
    const r = getEdition("ct-classic").rules.reenlistment;
    expect(r?.mandatoryRetireAfterTerm).toBe(7);
  });
});

describe("CT TTB muster-out roll counts (TTB p. 18)", () => {
  function freshCt(rank: number, terms: number): Character {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7,
        intelligence: 7, education: 7, social: 7,
      },
    });
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = terms;
    c.rank = rank;
    return c;
  }

  it("1 roll per full term as the baseline", () => {
    // Rank 0 (no rank bonus) — 4 terms = 4 rolls.
    const c = freshCt(0, 4);
    expect(musterOutRolls(c)).toBe(4);
  });

  it("Rank 1-2 adds +1 muster roll", () => {
    expect(musterOutRolls(freshCt(1, 4))).toBe(5);
    expect(musterOutRolls(freshCt(2, 4))).toBe(5);
  });

  it("Rank 3-4 adds +2 muster rolls", () => {
    expect(musterOutRolls(freshCt(3, 4))).toBe(6);
    expect(musterOutRolls(freshCt(4, 4))).toBe(6);
  });

  it("Rank 5-6 adds +3 muster rolls", () => {
    expect(musterOutRolls(freshCt(5, 4))).toBe(7);
    expect(musterOutRolls(freshCt(6, 4))).toBe(7);
  });
});

describe("CT TTB retirement pay (TTB p. 25)", () => {
  function ct(terms: number): Character {
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7,
        intelligence: 7, education: 7, social: 7,
      },
    });
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = terms;
    return c;
  }

  it("Term 5 = Cr 4,000 (engine default; TTB)", () => {
    const c = ct(5);
    c.endedAsRetired = true;
    musterOutPay(c);
    expect(c.retirementPay).toBe(4000);
  });

  it("Term 6 = Cr 6,000; +Cr 2,000 per additional term", () => {
    const c6 = ct(6);
    c6.endedAsRetired = true;
    musterOutPay(c6);
    expect(c6.retirementPay).toBe(6000);

    const c10 = ct(10);
    c10.endedAsRetired = true;
    musterOutPay(c10);
    expect(c10.retirementPay).toBe(14000); // 4000 + 5*2000
  });

  it("< 5 terms = no pension", () => {
    const c = ct(4);
    c.endedAsRetired = true;
    musterOutPay(c);
    expect(c.retirementPay).toBe(0);
  });

  it("Scouts excluded from pension", () => {
    const c = ct(8);
    c.service = "scouts";
    c.endedAsRetired = true;
    musterOutPay(c);
    expect(c.retirementPay).toBe(0);
  });

  it("'other' service excluded from pension", () => {
    const c = ct(8);
    c.service = "other";
    c.endedAsRetired = true;
    musterOutPay(c);
    expect(c.retirementPay).toBe(0);
  });
});
