// MT pathway rank ladder audit (PM pp. 51, 55, 58, 65).
//
// Mercenary: E1-E9 enlisted + O1-O10 officer (Private → Field Marshal).
// Navy: E1-E9 enlisted + O1-O10 officer (Spacehand → Grand Admiral).
// Scout: IS-1 to IS-9 ordinary + IS-10 to IS-18 administrator.
// Merchant Prince: six department-specific ladders.

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";

interface RankEntry {
  0: string;          // code
  1: string;          // title
  2?: number;         // step value (officer only)
}

function ranks(pathway: string, group: string): RankEntry[] {
  const acg = getEdition("mt-megatraveller").data.advancedCharacterGeneration!;
  const p = acg[pathway] as unknown as { ranks?: Record<string, RankEntry[]> };
  return p.ranks?.[group] ?? [];
}

describe("Mercenary ranks (PM p. 51)", () => {
  it("Enlisted: E1 Private → E9 Sergeant Major", () => {
    const e = ranks("mercenary", "enlisted");
    expect(e.length).toBe(9);
    expect(e[0]?.[0]).toBe("E1");
    expect(e[0]?.[1]).toBe("Private");
    expect(e[8]?.[0]).toBe("E9");
    expect(e[8]?.[1]).toBe("Sergeant Major");
  });

  it("Officer: O1 Second Lieutenant → O10 (10 ranks)", () => {
    const o = ranks("mercenary", "officer");
    expect(o.length).toBe(10);
    expect(o[0]?.[0]).toBe("O1");
    expect(o[0]?.[1]).toBe("Second Lieutenant");
    expect(o[9]?.[0]).toBe("O10");
  });
});

describe("Navy ranks (PM p. 55)", () => {
  it("Enlisted: E1 → E9 (9 ranks, Spacehand series)", () => {
    const e = ranks("navy", "enlisted");
    expect(e.length).toBe(9);
    expect(e[0]?.[0]).toBe("E1");
    expect(e[8]?.[0]).toBe("E9");
  });

  it("Officer: O1 → O10 (10 ranks, Ensign → Grand Admiral)", () => {
    const o = ranks("navy", "officer");
    expect(o.length).toBe(10);
    expect(o[0]?.[0]).toBe("O1");
    expect(o[9]?.[0]).toBe("O10");
  });
});

describe("Scout ranks (PM p. 58)", () => {
  it("Ordinary: IS-1 to IS-9 (9 ranks)", () => {
    const o = ranks("scout", "ordinary");
    expect(o.length).toBe(9);
    expect(o[0]?.[0]).toBe("IS-1");
    expect(o[8]?.[0]).toBe("IS-9");
  });

  it("Administrator: IS-10 to IS-18 (9 ranks)", () => {
    const a = ranks("scout", "administrator");
    expect(a.length).toBe(9);
    expect(a[0]?.[0]).toBe("IS-10");
    expect(a[8]?.[0]).toBe("IS-18");
  });
});

describe("Merchant Prince ranks (PM p. 65)", () => {
  // The JSON stores merchant ranks as 4-tuple arrays:
  //   [rankCode, title, examThrow, qualifications]
  // grouped by department (deck/engineering/purser/sales/admin/freeTrader).
  // Purser includes the Medical sub-ladder; Free Trader is special-case.
  type RankTuple = [string, string, string, string];
  const acg = getEdition("mt-megatraveller").data.advancedCharacterGeneration!;
  const mp = acg.merchantPrince as unknown as {
    ranksAndPromotions?: Record<string, RankTuple[]>;
  };

  it("Six department-specific ladders", () => {
    const ladders = Object.keys(mp.ranksAndPromotions ?? {});
    expect(ladders).toEqual(expect.arrayContaining([
      "deck", "engineering", "purser", "sales", "admin", "freeTrader",
    ]));
  });

  it("Deck starts O0 Apprentice (Route Assignment qualification)", () => {
    const deck = mp.ranksAndPromotions?.deck ?? [];
    expect(deck[0]?.[0]).toBe("O0");
    expect(deck[0]?.[1]).toBe("Apprentice");
    expect(deck[0]?.[3]).toMatch(/Route Assignment/i);
  });

  it("Deck O5 Captain requires Legal-1 throw 9+", () => {
    const deck = mp.ranksAndPromotions?.deck ?? [];
    const captain = deck.find((r) => r[1] === "Captain");
    expect(captain?.[0]).toBe("O5");
    expect(captain?.[2]).toBe("9+");
    expect(captain?.[3]).toMatch(/Legal/);
  });

  it("Free Trader department has Captain at O5", () => {
    const ft = mp.ranksAndPromotions?.freeTrader ?? [];
    const captain = ft.find((r) =>
      r[0] === "O5" || r[1].toLowerCase().includes("captain"));
    expect(captain).toBeDefined();
    expect(captain?.[1]).toBe("Captain");
  });

  it("Engineering O4 Chief Engineer 9+, Engineering-3 prerequisite", () => {
    const eng = mp.ranksAndPromotions?.engineering ?? [];
    const ce = eng.find((r) => r[1] === "Chief Engineer");
    expect(ce?.[0]).toBe("O4");
    expect(ce?.[2]).toBe("9+");
    expect(ce?.[3]).toMatch(/Engineering-3/);
  });
});
