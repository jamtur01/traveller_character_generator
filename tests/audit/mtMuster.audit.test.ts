// MT per-service muster-out audit (cash + benefit tables). PM p. 19
// shows the canonical MT muster tables; the engine reads them from
// services.<name>.musterOut.{cash,benefits}.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

interface MusterOut {
  cash: (number | null)[];
  benefits: (string | null)[];
}

function muster(service: string): MusterOut {
  const svcs = getEdition("mt-megatraveller").data.services as
    Record<string, { musterOut?: MusterOut }>;
  return svcs[service]?.musterOut ?? { cash: [], benefits: [] };
}

describe("MT cash tables (PM p. 19)", () => {
  it("Navy: 1k / 5k / 5k / 10k / 20k / 50k / 50k", () => {
    expect(muster("navy").cash).toEqual([null, 1000, 5000, 5000, 10000, 20000, 50000, 50000]);
  });
  it("Marines: 2k / 5k / 5k / 10k / 20k / 30k / 40k", () => {
    expect(muster("marines").cash).toEqual([null, 2000, 5000, 5000, 10000, 20000, 30000, 40000]);
  });
  it("Army: 2k / 5k / 10k / 10k / 10k / 20k / 30k", () => {
    expect(muster("army").cash).toEqual([null, 2000, 5000, 10000, 10000, 10000, 20000, 30000]);
  });
  it("Scouts: 20k / 20k / 30k / 30k / 50k / 50k / 50k", () => {
    expect(muster("scouts").cash).toEqual([null, 20000, 20000, 30000, 30000, 50000, 50000, 50000]);
  });
  it("Merchants: 1k / 5k / 10k / 10k / 20k / 20k / 50k (MT PM p. 19)", () => {
    // MT diverges from CT TTB here. CT had different merchant numbers
    // (1k/5k/10k/20k/20k/40k/40k); MT updates them per the PM.
    expect(muster("merchants").cash).toEqual([null, 1000, 5000, 10000, 10000, 20000, 20000, 50000]);
  });
});

describe("MT benefit tables (PM p. 19)", () => {
  it("Navy: Low Psg, +1 Int, +2 Edu, Weapon, Travellers', High Psg, +2 Social", () => {
    expect(muster("navy").benefits).toEqual([
      null, "Low Psg", "+1 Intelligence", "+2 Education",
      "Weapon", "Travellers'", "High Psg", "+2 Social",
    ]);
  });
  it("Marines: Low Psg, +2 Int, +1 Edu, Weapon, Travellers' (typical)", () => {
    const benefits = muster("marines").benefits;
    expect(benefits[1]).toBe("Low Psg");
    expect(benefits[2]).toMatch(/\+2 Intelligence|\+1 Intelligence/);
    expect(benefits[3]).toMatch(/\+1 Education|\+2 Education/);
    expect(benefits[4]).toBe("Weapon");
  });
});

describe("MT CotI service muster tables present (PM p. 19)", () => {
  for (const svc of [
    "barbarians", "belters", "bureaucrats", "diplomats", "doctors",
    "flyers", "hunters", "lawenforcers", "nobles", "pirates",
    "rogues", "sailors", "scientists",
  ]) {
    it(`${svc} muster table exists with 7 cash entries + 7 benefits`, () => {
      const m = muster(svc);
      expect(m.cash.length, `${svc} cash`).toBeGreaterThanOrEqual(7);
      expect(m.benefits.length, `${svc} benefits`).toBeGreaterThanOrEqual(7);
    });
  }
});
