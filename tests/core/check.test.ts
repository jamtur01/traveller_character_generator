import { describe, it, expect, vi } from "vitest";
import { Rng } from "@/lib/traveller/random";
import { characteristicDm, rollCheck, type DmBand } from "@/lib/traveller/core";

// The Mongoose 2e Characteristic Modifiers table (Core p.9) as fixture data —
// the same shape the edition JSON declares. Verifies the interpreter, not JSON.
const MG_BANDS: readonly DmBand[] = [
  { min: 0, max: 0, dm: -3 },
  { min: 1, max: 2, dm: -2 },
  { min: 3, max: 5, dm: -1 },
  { min: 6, max: 8, dm: 0 },
  { min: 9, max: 11, dm: 1 },
  { min: 12, max: 14, dm: 2 },
  { min: 15, max: 99, dm: 3 },
];

describe("characteristicDm", () => {
  it("maps each band and its boundaries to the Mongoose 2e modifier", () => {
    expect(characteristicDm(0, MG_BANDS)).toBe(-3);
    expect(characteristicDm(1, MG_BANDS)).toBe(-2);
    expect(characteristicDm(2, MG_BANDS)).toBe(-2);
    expect(characteristicDm(3, MG_BANDS)).toBe(-1);
    expect(characteristicDm(5, MG_BANDS)).toBe(-1);
    expect(characteristicDm(6, MG_BANDS)).toBe(0);
    expect(characteristicDm(8, MG_BANDS)).toBe(0);
    expect(characteristicDm(9, MG_BANDS)).toBe(1);
    expect(characteristicDm(11, MG_BANDS)).toBe(1);
    expect(characteristicDm(14, MG_BANDS)).toBe(2);
    expect(characteristicDm(15, MG_BANDS)).toBe(3);
    expect(characteristicDm(20, MG_BANDS)).toBe(3);
  });

  it("throws when no band covers the score (never silently defaults to 0)", () => {
    expect(() => characteristicDm(-1, MG_BANDS)).toThrow(/no band/);
    expect(() => characteristicDm(5, [])).toThrow(/no band/);
  });
});

describe("rollCheck", () => {
  const d6 = (v: number) => (v - 1) / 6 + 0.001;

  it("succeeds when 2D + DMs meets the target and reports the effect margin", () => {
    const seq = [d6(4), d6(3)]; // 2D = 7
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    const r = rollCheck(new Rng(), [3], 8); // 7 + 3 = 10 vs 8
    vi.restoreAllMocks();
    expect(r.roll).toBe(7);
    expect(r.total).toBe(10);
    expect(r.success).toBe(true);
    expect(r.effect).toBe(2);
  });

  it("fails when the modified total is below the target", () => {
    const seq = [d6(2), d6(2)]; // 2D = 4
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    const r = rollCheck(new Rng(), [-1], 8); // 4 - 1 = 3 vs 8
    vi.restoreAllMocks();
    expect(r.roll).toBe(4);
    expect(r.total).toBe(3);
    expect(r.success).toBe(false);
    expect(r.effect).toBe(-5);
  });

  it("sums multiple DMs and treats a met target as marginal success (effect 0)", () => {
    const seq = [d6(3), d6(3)]; // 2D = 6
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    const r = rollCheck(new Rng(), [1, 1], 8); // 6 + 2 = 8 vs 8
    vi.restoreAllMocks();
    expect(r.total).toBe(8);
    expect(r.success).toBe(true);
    expect(r.effect).toBe(0);
  });
});
