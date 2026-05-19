import { afterEach, describe, expect, it, vi } from "vitest";
import { getEditionServices } from "../lib/traveller";
import { Character } from "../lib/traveller/character";

const ctServices = getEditionServices("ct-classic");

afterEach(() => {
  vi.restoreAllMocks();
});

// The muster-out log shows what each roll produced. Cover the four outcome
// shapes: new benefit, attribute boost, weapon (skill+benefit combo), and
// "no benefit".

describe("musterOutCash", () => {
  it("records the cash amount in the log", () => {
    const c = new Character();
    c.service = "navy";
    // Force the d6 to roll 3 → Navy cash table 3 = Cr5,000.
    vi.spyOn(Math, "random").mockReturnValue(2 / 6 + 0.001);
    c.musterOutCash(0);
    expect(c.musterLog[0]).toMatch(/^Cr[\d,]+ cash$/);
    expect(c.credits).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});

describe("musterOutBenefit — outcome descriptions", () => {
  it("attribute-boost rolls show as '+N Edu'", () => {
    const c = new Character();
    c.service = "navy";
    // Navy benefit roll 3 → +2 Education (post-fix).
    vi.spyOn(Math, "random").mockReturnValue(2 / 6 + 0.001);
    c.musterOutBenefit(0);
    expect(c.musterLog[0]).toContain("+2 Edu");
    vi.restoreAllMocks();
  });

  it("ship rolls add the ship name to the log", () => {
    const c = new Character();
    c.service = "scouts";
    // Scout benefit roll 6 → Scout Ship.
    vi.spyOn(Math, "random").mockReturnValue(5 / 6 + 0.001);
    c.musterOutBenefit(0);
    expect(c.musterLog[0]).toBe("Scout Ship");
    expect(c.ship).toBe(true);
    vi.restoreAllMocks();
  });

  it("a 'no benefit' roll yields the literal 'No benefit' marker", () => {
    const c = new Character();
    c.service = "pirates";
    // Pirate benefit roll 4 is a no-op in CotI.
    vi.spyOn(Math, "random").mockReturnValue(3 / 6 + 0.001);
    c.musterOutBenefit(0);
    expect(c.musterLog[0]).toBe("No benefit");
    vi.restoreAllMocks();
  });

  it("weapon-benefit first occurrence does not duplicate as 'Cutlass-0'", () => {
    const c = new Character();
    c.service = "marines";
    // Marine benefit roll 4 → blade. doBladeBenefit picks one and adds the
    // weapon name to benefits + level 0 skill. The log must only mention the
    // weapon once, as the bare weapon name.
    vi.spyOn(Math, "random").mockReturnValue(3 / 6 + 0.001);
    c.musterOutBenefit(0);
    const entry = c.musterLog[0]!;
    expect(entry).not.toMatch(/-0/);
    expect(entry).toBe(c.bladeBenefit);
    vi.restoreAllMocks();
  });
});

describe("doBladeBenefit — second occurrence promotes to skill", () => {
  it("first call adds benefit + skill-0; second call bumps skill to 1", () => {
    // Pin Math.random so the blade pick is deterministic — otherwise the
    // optional-chain assertions below mask any regression that picks
    // nothing at all.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const c = new Character();
    c.service = "marines";
    // First call sets blade benefit + skill-0.
    c.doBladeBenefit();
    const chosen = c.bladeBenefit;
    expect(chosen).toBeTruthy();
    expect(c.benefits).toContain(chosen);
    expect(c.skills.find(([n]) => n === chosen)?.[1]).toBe(0);

    // Second call should bump skill, not duplicate the benefit.
    c.doBladeBenefit();
    expect(c.benefits.filter((b) => b === chosen)).toHaveLength(1);
    expect(c.skills.find(([n]) => n === chosen)?.[1]).toBe(1);
    vi.restoreAllMocks();
  });
});

describe("musterCash bounds", () => {
  it("clamps high cashDM to the 7 row, not undefined", () => {
    const c = new Character();
    c.service = "navy";
    // Force roll 6 + DM 5 → 11; should clamp to row 7.
    vi.spyOn(Math, "random").mockReturnValue(5 / 6 + 0.001);
    c.musterOutCash(5);
    expect(c.credits).toBe(ctServices.navy!.musterCash[7]);
    vi.restoreAllMocks();
  });

  it("clamps low cashDM to the 1 row, not undefined", () => {
    const c = new Character();
    c.service = "navy";
    vi.spyOn(Math, "random").mockReturnValue(0); // d6 → 1
    c.musterOutCash(-5);
    expect(c.credits).toBe(ctServices.navy!.musterCash[1]);
    vi.restoreAllMocks();
  });
});
