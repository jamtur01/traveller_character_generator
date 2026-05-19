// ACG checklist audit (PM pp. 64-65). Each pathway declares a
// checklist of canonical steps; verify the JSON matches the PM's
// per-pathway summary.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

function checklist(pathway: string): string[] {
  const acg = getEdition("mt-megatraveller").data.advancedCharacterGeneration!;
  const p = acg[pathway] as unknown as { checklist?: string[] };
  return p.checklist ?? [];
}

describe("Mercenary checklist (PM p. 64)", () => {
  const c = checklist("mercenary");

  it("7-step canonical sequence", () => {
    expect(c.length).toBe(7);
  });

  it("Step 1: Generate character + homeworld", () => {
    expect(c[0]).toMatch(/Generate character.*homeworld/i);
  });

  it("Step 2: Pre-enlistment options", () => {
    expect(c[1]).toMatch(/pre-enlistment|pre-career/i);
  });

  it("Step 3: Enlist Army or Marines", () => {
    expect(c[2]).toMatch(/Army.*Marines/i);
  });

  it("Step 4: Select combat arm", () => {
    expect(c[3]).toMatch(/combat arm/i);
  });

  it("Step 5: Initial training", () => {
    expect(c[4]).toMatch(/initial training/i);
  });

  it("Step 6: Four one-year assignments", () => {
    expect(c[5]).toMatch(/four one-year assignments/i);
  });

  it("Step 7: Aging / reenlistment / muster", () => {
    expect(c[6]).toMatch(/aging.*reenlist.*muster|muster.*reenlist/i);
  });
});

describe("Navy checklist (PM p. 64)", () => {
  const c = checklist("navy");

  it("8-step canonical sequence (extra retention check)", () => {
    expect(c.length).toBe(8);
  });

  it("Step 1 mentions subsector tech code (navy-specific)", () => {
    expect(c[0]).toMatch(/subsector tech/i);
  });

  it("Step 3: Enlist in Imperial / Reserve / System Squadron", () => {
    expect(c[2]).toMatch(/Imperial.*Reserve.*System Squadron|fleet/i);
  });

  it("Step 4: Branch assignment", () => {
    expect(c[3]).toMatch(/branch/i);
  });

  it("Step 7: Retention in assignment (PM p. 55 mechanic)", () => {
    expect(c[6]).toMatch(/retention/i);
  });
});

describe("Scout checklist (PM p. 64)", () => {
  const c = checklist("scout");

  it("7-step sequence with office selection", () => {
    expect(c.length).toBe(7);
    expect(c[3]).toMatch(/office/i);
  });
});

describe("Merchant Prince checklist (PM p. 64)", () => {
  const c = checklist("merchantPrince");

  it("8-step sequence (Merchant Academy + exam steps)", () => {
    expect(c.length).toBe(8);
  });

  it("Step 4: Merchant Academy (opt-in for Megacorp/Sector-wide)", () => {
    expect(c[3]).toMatch(/Merchant Academy/i);
  });

  it("Step 5: Department assignment", () => {
    expect(c[4]).toMatch(/department/i);
  });

  it("Step 7: Exam for promotion (PM p. 65)", () => {
    expect(c[6]).toMatch(/exam.*promotion|promotion.*exam/i);
  });
});
