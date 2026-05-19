// MT homeworld DM tables cell-for-cell audit (PM p. 15 — DMs column).
//
// Atmosphere DMs:    Size = Asteroid -9, Small -2, Large +2.
// Hydrosphere DMs:   Size = Small -2, Large +2.
// Law DMs:           Pop = Low Pop -1, High Pop +1.
// Tech DMs:          Starport A +3, B +2, C +1, X -2;
//                    Size Asteroid +1; Hydro Water World +1;
//                    Pop Low Pop +1, High Pop +2.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

interface DmRule {
  when: { column: string; equals: string };
  dm: number;
}

function dms(column: string): DmRule[] {
  const hw = getEdition("mt-megatraveller").data.homeworld as
    unknown as Record<string, unknown>;
  const dmsByCol = hw.dmsByColumn as Record<string, DmRule[]>;
  return dmsByCol[column] ?? [];
}

function dmFor(column: string, target: string, value: string): number | undefined {
  return dms(column).find((d) =>
    d.when.column === target && d.when.equals === value)?.dm;
}

describe("Atmosphere DMs (PM p. 15)", () => {
  it("Size = Asteroid → -9", () => {
    expect(dmFor("atmosphere", "size", "Asteroid")).toBe(-9);
  });
  it("Size = Small → -2", () => {
    expect(dmFor("atmosphere", "size", "Small")).toBe(-2);
  });
  it("Size = Large → +2", () => {
    expect(dmFor("atmosphere", "size", "Large")).toBe(2);
  });
});

describe("Hydrosphere DMs (PM p. 15)", () => {
  it("Size = Small → -2", () => {
    expect(dmFor("hydrosphere", "size", "Small")).toBe(-2);
  });
  it("Size = Large → +2", () => {
    expect(dmFor("hydrosphere", "size", "Large")).toBe(2);
  });
});

describe("Law DMs (PM p. 15)", () => {
  it("Population = Low Pop → -1", () => {
    expect(dmFor("law", "population", "Low Pop")).toBe(-1);
  });
  it("Population = High Pop → +1", () => {
    expect(dmFor("law", "population", "High Pop")).toBe(1);
  });
});

describe("Tech DMs (PM p. 15)", () => {
  it("Starport A +3, B +2, C +1, X -2", () => {
    expect(dmFor("tech", "starport", "A")).toBe(3);
    expect(dmFor("tech", "starport", "B")).toBe(2);
    expect(dmFor("tech", "starport", "C")).toBe(1);
    expect(dmFor("tech", "starport", "X")).toBe(-2);
  });
  it("Size = Asteroid → +1 (PM p. 15)", () => {
    expect(dmFor("tech", "size", "Asteroid")).toBe(1);
  });
  it("Hydrosphere = Water World → +1", () => {
    expect(dmFor("tech", "hydrosphere", "Water World")).toBe(1);
  });
  it("Pop Low +1, High +2 (PM p. 15)", () => {
    expect(dmFor("tech", "population", "Low Pop")).toBe(1);
    expect(dmFor("tech", "population", "High Pop")).toBe(2);
  });
});
