// Round-4 behavioral regressions. Each group locks a committed fix
// (commits 36edfb8 + ba55a2b) against reversion: constructs characters,
// runs the real engine paths, and asserts the observable contract the fix
// established. Mirrors tests/edition.behavior.test.ts + tests/ctBasic.audit.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { type ServiceKey } from "../lib/traveller";
import { Character } from "../lib/traveller/character";
import { Rng } from "../lib/traveller/random";
import * as session from "../lib/traveller/chargen/session";
import { doMusterChoice } from "../lib/traveller/chargen/flow";
import { musterOutRolls } from "../lib/traveller/chargen/muster";

afterEach(() => {
  vi.restoreAllMocks();
});

function ctChar(service: ServiceKey, attrs: Partial<Record<string, number>> = {}): Character {
  const base = {
    strength: 8, dexterity: 8, endurance: 8,
    intelligence: 8, education: 8, social: 8,
  };
  const c = new Character({ attributes: { ...base, ...attrs } });
  c.editionId = "ct-classic";
  c.chargenModelId = "classic";
  c.service = service;
  c.showHistory = "none";
  return c;
}

// ---------------------------------------------------------------------------
// (1) rankBySocial clamps starting rank to maxRank instead of gating on it.
//     classic.ts:44 — Math.min(social + rankOffset, maxRank). CotI p.8:
//     noble rank = Social - 10, capped at rank 5 (Duke). Before the fix a
//     Social>15 noble whose computed rank exceeded maxRank was gated out
//     and dropped to rank 0 (then re-commissioned to 1 off the term roll).
//     RNG is mocked via Rng.prototype (NOT an instance spy) because
//     session.runTerm clones the character, forking a fresh Rng stream.
// ---------------------------------------------------------------------------

describe("rankBySocial clamps noble starting rank to maxRank (CotI p.8)", () => {
  it("Social 16 → rank 5 (Duke, clamped), not dropped below the cap", () => {
    // Survival (target 3) passes; promotion (target 12, no DM at Int 8)
    // fails — isolating the rankBySocial-set rank from a term promotion.
    vi.spyOn(Rng.prototype, "roll").mockReturnValue(7);
    const noble = ctChar("nobles", { social: 16 });
    const snap = session.runTerm({ character: noble, phase: "term" });
    expect(snap.character.rank).toBe(5);
  });

  it("Social 13 → rank 3 (Marquis): rank = Social - 10", () => {
    vi.spyOn(Rng.prototype, "roll").mockReturnValue(7);
    const noble = ctChar("nobles", { social: 13 });
    const snap = session.runTerm({ character: noble, phase: "term" });
    expect(snap.character.rank).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (2) doMusterChoice fail-loud guards (flow.ts). The UI enforced the cash
//     cap and roll count, but a RunLog replay calling the engine directly
//     could over-roll silently. The guards throw instead.
// ---------------------------------------------------------------------------

describe("doMusterChoice fail-loud guards (flow.ts)", () => {
  function midMuster(cashUsed: number, rolls: number): Character {
    const c = ctChar("navy");
    c.muster.musterRolls = rolls;
    c.muster.musterCashUsed = cashUsed;
    return c;
  }

  it("throws on a cash roll past the cash cap (CT cap = 3)", () => {
    // Rolls remain, so the no-rolls guard is not what fires — this
    // exercises the cash-cap guard specifically.
    const c = midMuster(3, 2);
    expect(() => doMusterChoice(c, "cash")).toThrow(/cash roll past the 3-roll cap/);
  });

  it("throws when no muster rolls remain", () => {
    const c = midMuster(0, 0);
    expect(() => doMusterChoice(c, "cash")).toThrow(/no muster rolls remaining/);
  });
});

// ---------------------------------------------------------------------------
// (3) improveAttribute renders the "now X" value edition-aware
//     (character.ts): decimal for Mongoose, extended-hex for CT/MT, so the
//     history line matches the sheet. Education 9 -> 10 is the boundary
//     where hex (A) and decimal (10) diverge.
// ---------------------------------------------------------------------------

describe("improveAttribute renders 'now X' edition-aware", () => {
  function attrChar(editionId: string, modelId: string): Character {
    const c = new Character({
      attributes: {
        strength: 8, dexterity: 8, endurance: 8,
        intelligence: 8, education: 9, social: 8,
      },
    });
    c.editionId = editionId;
    c.chargenModelId = modelId;
    c.showHistory = "simple";
    return c;
  }

  it("Mongoose Education 9->10 logs 'now 10' (decimal), never 'now A'", () => {
    const c = attrChar("mongoose-2e", "mongoose");
    c.improveAttribute("education");
    const line = c.renderHistory().find((s) => s.includes("Edu") && s.includes("now"));
    expect(line).toContain("now 10");
    expect(line).not.toContain("now A");
  });

  it("CT Education 9->10 logs 'now A' (extended hex)", () => {
    const c = attrChar("ct-classic", "classic");
    c.improveAttribute("education");
    const line = c.renderHistory().find((s) => s.includes("Edu") && s.includes("now"));
    expect(line).toContain("now A");
    expect(line).not.toContain("now 10");
  });
});

// ---------------------------------------------------------------------------
// (4) CT skill eligibility (ct-classic.json). CotI p.3 gives every career
//     2 skills the first term and 1 thereafter; only Scouts (TTB p.24) get
//     2/term. The removed exception had wrongly given Belters/Doctors/
//     Rogues/Scientists/Hunters 2/term. Rankless careers run no
//     commission/promotion, so a subsequent term's count is exactly
//     skillEligibility.subsequentTerm (= 1) — allocateSkills runs first and
//     is deterministic, so the mocked survival roll only keeps the run alive.
// ---------------------------------------------------------------------------

describe("CT skill eligibility: only Scouts get 2/term (CotI p.3)", () => {
  it("Belter on a subsequent term gains exactly 1 skill", () => {
    vi.spyOn(Rng.prototype, "roll").mockReturnValue(10);
    const c = ctChar("belters", { strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9 });
    c.terms = 1; // a prior term already served → this step is subsequent
    c.doServiceTermStep();
    expect(c.skillPoints).toBe(1);
  });

  it("Scout on a subsequent term still gains 2 skills (TTB p.24 exception)", () => {
    vi.spyOn(Rng.prototype, "roll").mockReturnValue(10);
    const c = ctChar("scouts", { strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9 });
    c.terms = 1;
    c.doServiceTermStep();
    expect(c.skillPoints).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (5) Per-source muster-out rolls (ct-classic.json rankExtraRollsBySource +
//     muster.ts). TTB p.24 gives Book 1 services +3 rolls at rank 5-6; CotI
//     p.4/6/8 gives the Supplement 4 careers only +2. The band is selected
//     by each service's `source`. terms=1 -> 1 base roll; the difference is
//     purely the rank-band bonus.
// ---------------------------------------------------------------------------

describe("Per-source muster-out rank-band rolls (TTB p.24 / CotI)", () => {
  function ranked(service: ServiceKey): Character {
    const c = ctChar(service);
    c.rank = 5;
    c.terms = 1;
    return c;
  }

  it("CotI ranked career (sailors) at rank 5 → +2 band (1 base + 2 = 3)", () => {
    expect(musterOutRolls(ranked("sailors"))).toBe(3);
  });

  it("TTB service (navy) at rank 5 → +3 band (1 base + 3 = 4)", () => {
    expect(musterOutRolls(ranked("navy"))).toBe(4);
  });
});
