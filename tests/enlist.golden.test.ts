// Enlistment behavior GOLDEN LOCK for the four MT ACG pathways
// (mercenary/navy/scout/merchantPrince). Phase 6 of the pathway-as-JSON
// rewrite replaces the four hand-written enlist functions with GENERIC
// primitives driven by JSON params; this file pins the CURRENT observable
// end-state of every enlist OUTCOME so that refactor is provably
// behavior-preserving. It must stay GREEN across the rewrite — a changed
// role field, starting rank, officer flag, drafted service, or a
// disappeared EnlistmentValidationError fails a case, which is the point.
//
// Scope: this file DELIBERATELY covers the failure/edge paths the happy-path
// walks in tests/acg.runtime.test.ts do not deterministically hit —
//   - enlist-roll FAILURE -> DRAFT (mercenary, navy, scout) and the exact
//     drafted service/branch/fleet the draft table maps to (which OVERRIDES
//     the requested service/fleet), plus rank/officer stamping;
//   - draft REJECTION (a draft roll off the table) -> EnlistmentValidationError;
//   - GATE rejection -> EnlistmentValidationError (navy System-Squadron tech
//     gate, merchant starport gate, mercenary disallowed combat arm);
//   - the navy branch-assignment fleet-legality invariant across every
//     reachable die (see the reroll note below);
//   - merchant enlist-throw FAILURE, which throws instead of drafting.
// The vanilla success paths (army Infantry, navy fleet+branch, scout
// field/office, merchant Free Trader/Megacorp department) are already locked
// in tests/acg.runtime.test.ts and are NOT re-asserted here; the navy/scout/
// merchant startingRank+isOfficer assertions below fill the one gap those
// walks leave open.
//
// Navy branch-reroll (assignment item d): navyAssignBranch caps at 8
// reroll-until-legal attempts against branchFleetRestrictions. With the
// current MT JSON that restriction is Technical -> imperialNavy ONLY, and
// Technical is the die-0 row — reachable only under the imperialNavy -2 DM.
// So Technical can only ever be ROLLED in the Imperial Navy, where it is
// LEGAL: the reroll body cannot fire through the public enlist surface. The
// contract the loop guarantees IS observable, though — "enlist always yields
// a fleet-legal branch" — and the branch-legality table below locks it by
// pinning the exact branch for all 12 reachable (fleet, die) combinations,
// proving Technical surfaces only in the Imperial Navy.
//
// Scout Field->Bureaucracy transfer and merchant line Transfer Up/Down
// (assignment item e) are per-term ASSIGNMENT results, not enlist-time
// events — division/lineType at enlist come from divisionPlacement / the
// chosen line, so those transfers are out of enlist scope.
//
// Determinism. attributes are all 2, which zeroes every attribute-gated
// enlist DM in all four pathways (each DM's `min` is >= 5), so the pinned
// die IS the outcome. The only non-attribute enlist-path DM is the navy
// branch-assignment fleet=imperialNavy -2, folded into the die math below.
// The Math.random spy is installed AFTER construction (name/gender draw from
// real randomness first) and queues one value per draw via d6(v); roll(2)
// consumes two draws, roll(1) one.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { getAcgPathway } from "../lib/traveller/editions";
import { EnlistmentValidationError } from "../lib/traveller/engine/acg/pathways/shared";
import type { Homeworld } from "../lib/traveller/engine/homeworld";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Math.random value that makes Rng.roll(1) return die `v`:
 *  Math.floor(d6(v) * 6 + 1) === v. */
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

/** All-2 attributes: every attribute-gated enlist DM (min >= 5) evaluates to
 *  0, so a pinned die is the whole enlist result. */
const LOW_ATTRS = {
  strength: 2, dexterity: 2, endurance: 2,
  intelligence: 2, education: 2, social: 2,
} as const;

/** A fresh auto-mode MT ACG character with deterministic all-2 attributes.
 *  `homeworld` overrides land on a Standard world (for the gate cases that
 *  read ch.homeworld.{starport,tech}). */
function mtAcgChar(opts: { homeworld?: Partial<Homeworld> } = {}): Character {
  const c = new Character({ attributes: { ...LOW_ATTRS } });
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  if (opts.homeworld) {
    c.homeworld = {
      starport: "A", size: "Medium", atmosphere: "Standard",
      hydrosphere: "Wet World", population: "High Pop", law: "Mod Law",
      tech: "High Stellar", ...opts.homeworld,
    };
  }
  return c;
}

/** Install the Math.random spy AFTER construction so the queued sequence
 *  starts exactly at the first engine roll; each `dice` value feeds one draw,
 *  then a constant keeps any unmodeled extra draw deterministic. */
function pinDice(dice: number[]): void {
  const spy = vi.spyOn(Math, "random");
  for (const v of dice) spy.mockReturnValueOnce(d6(v));
  spy.mockReturnValue(d6(1));
}

/** Run `fn`, returning whatever it threw. Fails loudly if it returns normally
 *  — a gate/failure case that stopped throwing is exactly the regression this
 *  file guards. */
function captureThrow(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected enlistment to throw, but it returned normally");
}

// ---------------------------------------------------------------------------
// Mercenary (PM p. 50): draft on failure, draft rejection, combat-arm gate.
// ---------------------------------------------------------------------------

describe("mercenary enlist golden lock (PM p. 50)", () => {
  it("failed Army enlist drafts into Marines (1D=2), keeping the chosen arm", () => {
    // Army target 5; 2D=2 fails. Draft 1D=2 -> Marines: the draft result
    // OVERRIDES the requested Army service, but the picked combat arm stays.
    const c = mtAcgChar();
    pinDice([1, 1, 2]);
    c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" });
    const acg = c.requireMercenaryAcg();
    expect(c.drafted).toBe(true);
    expect(acg.branch).toBe("Marines");
    expect(acg.combatArm).toBe("Infantry");
    expect(acg.rankCode).toBe("E1");
    expect(acg.isOfficer).toBe(false);
  });

  it("failed Marines enlist drafts into Army (1D=3) as an enlisted E1", () => {
    // Marines target 9; 2D=2 fails. Draft 1D=3 -> Army overrides Marines.
    const c = mtAcgChar();
    pinDice([1, 1, 3]);
    c.beginAcg("mercenary", { service: "marines", combatArm: "Infantry" });
    const acg = c.requireMercenaryAcg();
    expect(c.drafted).toBe(true);
    expect(acg.branch).toBe("Army");
    expect(acg.rankCode).toBe("E1");
    expect(acg.isOfficer).toBe(false);
  });

  it("failed enlist + a draft roll off the table (1D=1) rejects with EnlistmentValidationError", () => {
    // Draft table has only 2->Marines, 3->Army; any other roll aborts.
    const c = mtAcgChar();
    pinDice([1, 1, 1]);
    const err = captureThrow(() =>
      c.beginAcg("mercenary", { service: "army", combatArm: "Infantry" }));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/draft rejection/i);
    expect(c.drafted).toBe(false);
  });

  it("a disallowed combat arm (Marines + Cavalry) is an EnlistmentValidationError", () => {
    // The message text is locked in tests/mt.pathwayFixes.test.ts; this pins
    // the ERROR TYPE — the acg model routes ONLY EnlistmentValidationError to
    // a failed-enlistment retirement, so the type is the load-bearing contract.
    const c = mtAcgChar();
    pinDice([]);
    const err = captureThrow(() =>
      c.beginAcg("mercenary", { service: "marines", combatArm: "Cavalry" }));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/Marines cannot enter combat arm/);
  });
});

// ---------------------------------------------------------------------------
// Navy (PM p. 52): tech gate, draft on failure, draft rejection, and the
// branch fleet-legality invariant.
// ---------------------------------------------------------------------------

describe("navy enlist golden lock (PM p. 52)", () => {
  it("System Squadron below the homeworld tech minimum rejects with EnlistmentValidationError", () => {
    // techMinimum = Early Stellar; homeworld Pre-Stellar is below it.
    const c = mtAcgChar({ homeworld: { tech: "Pre-Stellar" } });
    pinDice([]);
    const err = captureThrow(() =>
      c.beginAcg("navy", { fleet: "systemSquadron" }));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/System Squadron requires homeworld tech/);
  });

  it("failed Reserve Fleet enlist drafts into the Imperial Navy (1D=1) and assigns a branch", () => {
    // Reserve target 7; 2D=2 fails. Draft 1D=1 -> Imperial Navy OVERRIDES the
    // requested Reserve Fleet. Branch: enlisted column, imperialNavy DM -2, so
    // 1D=4 -> die 2 -> Crew.
    const c = mtAcgChar();
    pinDice([1, 1, 1, 4]);
    c.beginAcg("navy", { fleet: "reserveFleet" });
    const acg = c.requireNavyAcg();
    expect(c.drafted).toBe(true);
    expect(acg.fleet).toBe("imperialNavy");
    expect(acg.branch).toBe("Crew");
    expect(acg.rankCode).toBe("E1");
    expect(acg.isOfficer).toBe(false);
  });

  it("failed enlist + a draft roll off the table (1D=2) rejects with EnlistmentValidationError", () => {
    // Draft table has only 1->Imperial Navy; any other roll aborts.
    const c = mtAcgChar();
    pinDice([1, 1, 2]);
    const err = captureThrow(() =>
      c.beginAcg("navy", { fleet: "imperialNavy" }));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/draft rejection/i);
    expect(c.drafted).toBe(false);
  });

  // Branch fleet-legality invariant. For every reachable (fleet, branch-die)
  // the assigned branch must be legal for the fleet — the guarantee the
  // 8-attempt reroll loop protects. Exact branches are pinned so the case is
  // non-vacuous AND documents that Technical (die 0) surfaces only in the
  // Imperial Navy (where the -2 DM can drive the die to 0), never in the
  // Reserve Fleet — which is why the reroll body never fires.
  const navyData = getAcgPathway("mt-megatraveller", "navy");
  if (!navyData) throw new Error("MT navy pathway data is required for this suite");
  const restrictions = navyData.branchFleetRestrictions ?? {};
  const branchRows: Array<{ fleet: "imperialNavy" | "reserveFleet"; roll: number; branch: string }> = [
    { fleet: "reserveFleet", roll: 1, branch: "Crew" },
    { fleet: "reserveFleet", roll: 2, branch: "Crew" },
    { fleet: "reserveFleet", roll: 3, branch: "Engineering" },
    { fleet: "reserveFleet", roll: 4, branch: "Engineering" },
    { fleet: "reserveFleet", roll: 5, branch: "Gunnery" },
    { fleet: "reserveFleet", roll: 6, branch: "Gunnery" },
    { fleet: "imperialNavy", roll: 1, branch: "Technical" },
    { fleet: "imperialNavy", roll: 2, branch: "Technical" },
    { fleet: "imperialNavy", roll: 3, branch: "Crew" },
    { fleet: "imperialNavy", roll: 4, branch: "Crew" },
    { fleet: "imperialNavy", roll: 5, branch: "Engineering" },
    { fleet: "imperialNavy", roll: 6, branch: "Engineering" },
  ];

  it.each(branchRows)(
    "successful $fleet enlist (branch die $roll) -> legal branch $branch, E1 enlisted",
    ({ fleet, roll, branch }) => {
      // 2D=12 clears every fleet target; the third draw is the branch die.
      const c = mtAcgChar();
      pinDice([6, 6, roll]);
      c.beginAcg("navy", { fleet });
      const acg = c.requireNavyAcg();
      expect(acg.fleet).toBe(fleet);
      expect(acg.branch).toBe(branch);
      const allowed = restrictions[acg.branch];
      expect(allowed === undefined || allowed.includes(fleet)).toBe(true);
      // Navy success stamps enlisted E1 (the gap acg.runtime leaves open).
      expect(acg.rankCode).toBe("E1");
      expect(acg.isOfficer).toBe(false);
    },
  );

  it("Technical is reachable only in the Imperial Navy, never the Reserve Fleet", () => {
    // Restates the invariant's teeth as a standalone assertion: the die-0
    // Technical row is unreachable in a fleet where it is illegal.
    const reserveBranches = branchRows
      .filter((r) => r.fleet === "reserveFleet")
      .map((r) => r.branch);
    expect(reserveBranches).not.toContain("Technical");
    expect(restrictions.Technical).toEqual(["imperialNavy"]);
  });
});

// ---------------------------------------------------------------------------
// Scout (PM p. 56): draft on failure, draft rejection.
// ---------------------------------------------------------------------------

describe("scout enlist golden lock (PM p. 56)", () => {
  it("failed enlist drafts into the Scouts (1D=4), Field division, IS-1", () => {
    // Target 7; 2D=2 fails. Draft 1D=4 -> Scouts. Division = default (field).
    // Office = 2D 2..12 -> 8 -> Field "Communications".
    const c = mtAcgChar();
    pinDice([1, 1, 4, 4, 4]);
    c.beginAcg("scout");
    const acg = c.requireScoutAcg();
    expect(c.drafted).toBe(true);
    expect(acg.division).toBe("field");
    expect(acg.office).toBe("Communications");
    expect(acg.rankCode).toBe("IS-1");
    expect(acg.isOfficer).toBe(false);
  });

  it("failed enlist + a draft roll that is not Scouts (1D=1) rejects with EnlistmentValidationError", () => {
    // Draft table has only 4->Scouts; any other roll aborts.
    const c = mtAcgChar();
    pinDice([1, 1, 1]);
    const err = captureThrow(() => c.beginAcg("scout"));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/draft rejection/i);
    expect(c.drafted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merchant Prince (PM p. 60): starport gate, and enlist-throw failure (NO
// draft — a failed merchant enlistment throws rather than drafting).
// ---------------------------------------------------------------------------

describe("merchant enlist golden lock (PM p. 60)", () => {
  it("a line whose starport minimum exceeds the homeworld's rejects with EnlistmentValidationError", () => {
    // Megacorp requires starport B+; a starport-C homeworld is below it.
    const c = mtAcgChar({ homeworld: { starport: "C" } });
    pinDice([]);
    const err = captureThrow(() =>
      c.beginAcg("merchantPrince", { lineType: "Megacorp" }));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/requires homeworld starport B/);
  });

  it("a failed enlist roll throws EnlistmentValidationError and does NOT draft", () => {
    // Interface (starport 'any') target 7; 2D=2 fails. Merchants have no
    // draft table — failure throws, drafted stays false.
    const c = mtAcgChar();
    pinDice([1, 1]);
    const err = captureThrow(() =>
      c.beginAcg("merchantPrince", { lineType: "Interface" }));
    expect(err).toBeInstanceOf(EnlistmentValidationError);
    expect((err as Error).message).toMatch(/Merchant enlistment failed/);
    expect(c.drafted).toBe(false);
  });

  it("successful Interface enlist stamps an enlisted E1 in an assigned department", () => {
    // 2D=12 clears the target; department = smallMerchantLine 1D=1 -> Purser.
    // Locks merchant success startingRank+isOfficer (the gap acg.runtime
    // leaves open) on a small line acg.runtime does not cover.
    const c = mtAcgChar();
    pinDice([6, 6, 1]);
    c.beginAcg("merchantPrince", { lineType: "Interface" });
    const acg = c.requireMerchantAcg();
    expect(acg.lineType).toBe("Interface");
    expect(acg.department).toBe("Purser");
    expect(acg.rankCode).toBe("E1");
    expect(acg.isOfficer).toBe(false);
  });
});
