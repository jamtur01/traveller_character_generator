// TTB Service Skills table (TTB p. 25 table 2) cell-for-cell audit
// per CT service.
//
// Navy:     1 Ship's Boat  2 Vacc Suit  3 Fwd Obsvr  4 Gunnery     5 Blade Cbt  6 Gun Cbt
// Marines:  1 ATV          2 Vacc Suit  3 Blade Cbt  4 Gun Cbt     5 Blade Cbt  6 Gun Cbt
// Army:     1 ATV          2 Air/Raft   3 Gun Cbt    4 Fwd Obsvr   5 Blade Cbt  6 Gun Cbt
// Scouts:   1 Air/Raft     2 Vacc Suit  3 Mechanical 4 Navigation  5 Electronics 6 Jack-o-T
// Merchant: 1 Vehicle      2 Vacc Suit  3 Jack-o-T   4 Steward     5 Electronics 6 Gun Cbt
// Other:    1 Vehicle      2 Gambling   3 Brawling   4 Bribery     5 Blade Cbt  6 Gun Cbt

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";

function st(service: string): (string | null)[] {
  const svcs = getEdition("ct-classic").data.services as
    Record<string, { skillTables?: { serviceSkills?: (string | null)[] } }>;
  return svcs[service]?.skillTables?.serviceSkills ?? [];
}

describe("CT Service Skills table (TTB p. 25 table 2)", () => {
  it("Navy: Ship's Boat / Vacc Suit / Fwd Obsvr / Gunnery / Blade Cbt / Gun Cbt", () => {
    expect(st("navy")).toEqual([
      null, "Ship's Boat", "Vacc Suit", "Fwd Obsvr",
      "Gunnery", "Blade Cbt", "Gun Cbt",
    ]);
  });

  it("Marines: ATV / Vacc Suit / Blade Cbt / Gun Cbt / Blade Cbt / Gun Cbt", () => {
    expect(st("marines")).toEqual([
      null, "ATV", "Vacc Suit", "Blade Cbt",
      "Gun Cbt", "Blade Cbt", "Gun Cbt",
    ]);
  });

  it("Army: ATV / Air/Raft / Gun Cbt / Fwd Obsvr / Blade Cbt / Gun Cbt", () => {
    expect(st("army")).toEqual([
      null, "ATV", "Air/Raft", "Gun Cbt",
      "Fwd Obsvr", "Blade Cbt", "Gun Cbt",
    ]);
  });

  it("Scouts: Air/Raft / Vacc Suit / Mechanical / Navigation / Electronics / Jack-o-T", () => {
    expect(st("scouts")).toEqual([
      null, "Air/Raft", "Vacc Suit", "Mechanical",
      "Navigation", "Electronics", "Jack-o-T",
    ]);
  });

  it("Merchants: Vehicle / Vacc Suit / Jack-o-T / Steward / Electronics / Gun Cbt", () => {
    expect(st("merchants")).toEqual([
      null, "Vehicle", "Vacc Suit", "Jack-o-T",
      "Steward", "Electronics", "Gun Cbt",
    ]);
  });

  it("Other: Vehicle / Gambling / Brawling / Bribery / Blade Cbt / Gun Cbt", () => {
    expect(st("other")).toEqual([
      null, "Vehicle", "Gambling", "Brawling",
      "Bribery", "Blade Cbt", "Gun Cbt",
    ]);
  });
});
