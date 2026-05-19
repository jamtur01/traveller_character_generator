// Aging table audit against TTB p. 24 and MT PM p. 47.
// Both editions share the same breakpoints:
//   34 / 38 / 42 / 46: -1 Str (8+), -1 Dex (7+), -1 End (8+).
//   50 / 54 / 58 / 62: -1 Str (9+), -1 Dex (8+), -1 End (9+).
//   66+:               -2 Str (9+), -2 Dex (9+), -2 End (9+), -1 Int (9+).
// Aging crisis at any characteristic reduced to 0 → save 8+.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

type AttrName = "strength" | "dexterity" | "endurance" | "intelligence";
interface AgingRow {
  age: number | string;
  endOfTerm: number;
  effects: Partial<Record<AttrName, { delta: number; save: number }>>;
}
interface AgingTable {
  rows: AgingRow[];
  agingCrisis?: { whenAttributeReducedTo?: number; save?: number; dice?: string };
}

function aging(editionId: string): AgingTable {
  return getEdition(editionId).data.aging as unknown as AgingTable;
}

for (const editionId of ["ct-classic", "mt-megatraveller"]) {
  describe(`${editionId}: aging table breakpoints (TTB p. 24 / PM p. 47)`, () => {
    const rows = aging(editionId).rows;
    const row = (age: number | string) =>
      rows.find((r) => String(r.age) === String(age));

    it("9 rows (age 34/38/42/46/50/54/58/62/66+)", () => {
      expect(rows.length).toBe(9);
      const ages = rows.map((r) => String(r.age));
      expect(ages).toEqual([
        "34", "38", "42", "46", "50", "54", "58", "62", "66+",
      ]);
    });

    it("Ages 34-46: Str -1 (8+), Dex -1 (7+), End -1 (8+)", () => {
      for (const age of [34, 38, 42, 46]) {
        const r = row(age);
        expect(r?.effects.strength).toEqual({ delta: -1, save: 8 });
        expect(r?.effects.dexterity).toEqual({ delta: -1, save: 7 });
        expect(r?.effects.endurance).toEqual({ delta: -1, save: 8 });
      }
    });

    it("Ages 50-62: Str -1 (9+), Dex -1 (8+), End -1 (9+)", () => {
      for (const age of [50, 54, 58, 62]) {
        const r = row(age);
        expect(r?.effects.strength).toEqual({ delta: -1, save: 9 });
        expect(r?.effects.dexterity).toEqual({ delta: -1, save: 8 });
        expect(r?.effects.endurance).toEqual({ delta: -1, save: 9 });
      }
    });

    it("Age 66+: Str -2 (9+), Dex -2 (9+), End -2 (9+), Int -1 (9+)", () => {
      const r = row("66+");
      expect(r?.effects.strength).toEqual({ delta: -2, save: 9 });
      expect(r?.effects.dexterity).toEqual({ delta: -2, save: 9 });
      expect(r?.effects.endurance).toEqual({ delta: -2, save: 9 });
      expect(r?.effects.intelligence).toEqual({ delta: -1, save: 9 });
    });

    it("endOfTerm advances by 1 per row, starting at term 4", () => {
      const expected = [4, 5, 6, 7, 8, 9, 10, 11, 12];
      expect(rows.map((r) => r.endOfTerm)).toEqual(expected);
    });

    it("Aging crisis: characteristic to 0 → save 8+", () => {
      const crisis = aging(editionId).agingCrisis;
      expect(crisis?.whenAttributeReducedTo).toBe(0);
      expect(crisis?.save).toBe(8);
    });
  });
}

describe("MT Aging unaffected attributes (PM p. 47)", () => {
  it("Education and Social Standing never aged", () => {
    const a = aging("mt-megatraveller") as unknown as {
      unaffected?: string[];
    };
    expect(a.unaffected).toEqual(expect.arrayContaining([
      "education", "social",
    ]));
  });
});
