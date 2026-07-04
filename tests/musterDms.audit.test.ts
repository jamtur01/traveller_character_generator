// Cash + benefit muster-out DMs audit against TTB p. 18 and MT PM p. 17.
//
// CT (TTB p. 18):
//   Cash DM:  +1 if Gambling-1 or better.
//   Benefit DM: +1 if rank 5+.
//   Max cash rolls: 3.
//
// MT (PM p. 17):
//   Cash DM: +1 if Gambling-1 or better.
//   Cash DM: +1 if Prospecting-1 or better (for some services).
//   Cash DM: +1 if Retired (PM p. 17).
//   Benefit DM: +1 if rank 5+.
//   Max cash rolls: 3. Anagathics users: cap drops to 2 permanently.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  benefitDmFor, cashDmFor, maxCashRolls,
} from "../lib/traveller/engine/musterDm";

afterEach(() => { vi.restoreAllMocks(); });

function makeCt(): Character {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7,
    },
  });
  c.editionId = "ct-classic";
  c.service = "navy";
  return c;
}

function makeMt(): Character {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7,
    },
  });
  c.editionId = "mt-megatraveller";
  c.service = "navy";
  return c;
}

describe("CT cash DM (TTB p. 18)", () => {
  it("No skills → cash DM 0", () => {
    expect(cashDmFor(makeCt())).toBe(0);
  });

  it("Gambling-1 → cash DM +1", () => {
    const c = makeCt();
    c.skills.push(["Gambling", 1]);
    expect(cashDmFor(c)).toBe(1);
  });

  it("Gambling-3 → still +1 (single DM, no cumulative)", () => {
    const c = makeCt();
    c.skills.push(["Gambling", 3]);
    expect(cashDmFor(c)).toBe(1);
  });
});

describe("CT benefit DM (TTB p. 18)", () => {
  it("Rank 0-4 → benefit DM 0", () => {
    const c = makeCt();
    c.rank = 4;
    expect(benefitDmFor(c)).toBe(0);
  });

  it("Rank 5 → benefit DM +1", () => {
    const c = makeCt();
    c.rank = 5;
    expect(benefitDmFor(c)).toBe(1);
  });

  it("Rank 6 → benefit DM +1", () => {
    const c = makeCt();
    c.rank = 6;
    expect(benefitDmFor(c)).toBe(1);
  });
});

describe("CT max cash rolls (TTB p. 18)", () => {
  it("Default: 3 cash rolls", () => {
    expect(maxCashRolls(makeCt())).toBe(3);
  });
});

describe("MT muster DMs (PM p. 17)", () => {
  it("Gambling-1 → cash +1", () => {
    const c = makeMt();
    c.skills.push(["Gambling", 1]);
    expect(cashDmFor(c)).toBe(1);
  });

  it("Rank 5+ → benefit +1", () => {
    const c = makeMt();
    c.rank = 5;
    expect(benefitDmFor(c)).toBe(1);
  });
});

describe("MT anagathics permanent cash cap (PM p. 15)", () => {
  it("Anagathics-touched character: cap drops to 2 cash rolls", () => {
    const c = makeMt();
    c.anagathics.anagathicsEverTaken = true;
    expect(maxCashRolls(c)).toBe(2);
  });

  it("Anagathics-untouched character: cap stays at 3", () => {
    const c = makeMt();
    c.anagathics.anagathicsEverTaken = false;
    expect(maxCashRolls(c)).toBe(3);
  });
});
