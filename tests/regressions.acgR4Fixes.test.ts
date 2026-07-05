// Round-4 ACG fix regressions. Each describe names the finding ID, the
// contract it defends, and — inline — the pre-fix behavior the assertion
// catches (the "teeth"). Reverting any fix turns its test red.
//
//   BUG-2 (chargen/models/acg.ts doEnlist): the enlist catch retires the
//     character ONLY for an EnlistmentValidationError (bad combat arm / unmet
//     starport-tech gate / rejected draft). requireRule failures and
//     unexpected engine errors propagate (fail loud), no longer masquerading
//     as a normally "retired" character.
//   BUG-3 (engine/runners/acg.ts runAcgTerm): a term whose FINAL year is
//     fully served but ends non-active (discharge / death) still counts one
//     term — matching a mid-term exit, which always counted.
//   MT-F1 (engine/acg/pathways/merchantPrince.ts): free-trader detection
//     resolves the JSON lineSize field via lineSizeFor(), never the raw
//     "Free Trader" typeOfLine label.
//   MT-F7 (merchantPrince.ts): the special-duty exam DM reads its magnitude
//     from the prose (not a hardcoded +1) and the transfer target accepts
//     multi-word department names.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import type { EnlistOptions } from "../lib/traveller/chargen/session";
import { freshAcgState, type AcgPathwayId } from "../lib/traveller/engine/acg/state";
import { formatEvent } from "../lib/traveller/history";
import { getAcgPathway, getEdition } from "../lib/traveller/editions";
import type { AcgPathwayImpl } from "../lib/traveller/editions/types";
import { EnlistmentValidationError } from "../lib/traveller/engine/acg/pathways/shared";
import {
  merchantFinalizeMuster, merchantResolveAssignment, merchantSpecialAssignment,
} from "../lib/traveller/engine/acg/pathways/merchantPrince";
import { runAcgTerm } from "../lib/traveller/engine/runners/acg";

afterEach(() => { vi.restoreAllMocks(); });

/** Math.random value that makes Rng.roll(1) return die `v` (1-6). */
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

const ENLIST_OPTS: EnlistOptions = {
  verbose: false, preferredService: "random",
  acgService: "army", acgCombatArm: "Infantry",
  acgFleet: "imperialNavy", acgDivision: "field",
  acgLineType: "Free Trader", acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

function acgChar(pathway: AcgPathwayId): Character {
  const c = new Character({
    attributes: {
      strength: 9, dexterity: 9, endurance: 9,
      intelligence: 9, education: 9, social: 9,
    },
  });
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.chargenModelId = "acg";
  c.acgPathway = pathway;
  c.service = ({
    mercenary: "army", navy: "navy", scout: "scouts", merchantPrince: "merchants",
  } as const)[pathway];
  c.acgState = freshAcgState(pathway);
  return c;
}

// ---------------------------------------------------------------------------
// BUG-2 — enlist catch narrowed to EnlistmentValidationError.
// ---------------------------------------------------------------------------

describe("BUG-2: ACG enlist only retires on a validation error; other errors propagate", () => {
  it("propagates a non-validation error thrown during enlistment (fail loud)", () => {
    const c = acgChar("mercenary");
    vi.spyOn(Character.prototype, "beginAcg").mockImplementation(() => {
      throw new Error("simulated requireRule failure (broken edition JSON)");
    });
    // Teeth: pre-fix the broad catch swallowed EVERY non-ChoicePendingError
    // into ev.endGeneration("retired"), returning a normal snapshot instead
    // of surfacing the broken-data/engine fault.
    expect(() =>
      session.enlist({ character: c, phase: "acg_enlist" }, ENLIST_OPTS),
    ).toThrow("simulated requireRule failure");
  });

  it("routes an EnlistmentValidationError to a retired outcome", () => {
    const c = acgChar("mercenary");
    vi.spyOn(Character.prototype, "beginAcg").mockImplementation(() => {
      throw new EnlistmentValidationError("combat arm gated by honors");
    });
    const snap = session.enlist({ character: c, phase: "acg_enlist" }, ENLIST_OPTS);
    expect(snap.phase).toBe("end");
    const end = snap.character.events.find((e) => e.kind === "endGeneration");
    expect(end).toBeDefined();
    expect(formatEvent(end!)).toContain("Character retired");
  });

  it("a real combat-arm gate (Commando without honors) is a validation error and retires", () => {
    // Commando is gated to Military Academy honors graduates (PM p. 50); a
    // plain character throws EnlistmentValidationError from the real gate.
    const c = acgChar("mercenary");
    const snap = session.enlist(
      { character: c, phase: "acg_enlist" },
      { ...ENLIST_OPTS, acgService: "army", acgCombatArm: "Commando" },
    );
    // Teeth for the gate conversion: if this gate had been left a plain
    // Error, the narrowed catch would now PROPAGATE it instead of retiring.
    expect(snap.phase).toBe("end");
    const end = snap.character.events.find((e) => e.kind === "endGeneration");
    expect(end).toBeDefined();
    expect(formatEvent(end!)).toContain("ACG enlistment failed");
  });
});

// ---------------------------------------------------------------------------
// BUG-3 — term counter credits a full-length final year that ends non-active.
// A tiny controllable pathway is registered under the "mercenary" key for the
// duration of the test; it discharges (or kills) the character in the term's
// final year, exactly reproducing the uncounted boundary.
// ---------------------------------------------------------------------------

describe("BUG-3: a fully-served final year that ends non-active still counts a term", () => {
  function runFinalYearExitTerm(mode: "discharge" | "death"): Character {
    const c = acgChar("mercenary");
    const impl: AcgPathwayImpl = {
      pathway: "mercenary",
      enlist: () => {},
      rollAssignment: () => "TestDuty",
      resolveAssignment: (ch) => {
        // Exit in the LAST year of the term, after serving every year — the
        // exact BUG-3 boundary (yearsThisTerm === termLength, !activeDuty).
        if (ch.acgState!.year === ch.fullTermYears()) {
          if (mode === "death") ch.endChargenDeceased("killed in the final year");
          else ch.endChargenDischarged();
        }
      },
      reenlist: () => false,
    };
    const acgPathways = getEdition("mt-megatraveller").hooks.acgPathways;
    expect(acgPathways).toBeDefined();
    const original = acgPathways!["mercenary"];
    acgPathways!["mercenary"] = () => impl;
    try {
      runAcgTerm(c);
    } finally {
      acgPathways!["mercenary"] = original!;
    }
    return c;
  }

  it("a final-year discharge yields terms += 1 (one more muster-out roll)", () => {
    const c = runFinalYearExitTerm("discharge");
    expect(c.deceased).toBe(false);
    expect(c.activeDuty).toBe(false);
    expect(c.acgState!.yearsServed).toBe(4);
    // Teeth: pre-fix the full-term branch required !deceased && activeDuty, so
    // a full-length term ending in discharge matched NEITHER branch and terms
    // stayed 0 — serving year 4 credited LESS than a year-3 (partial) exit,
    // silently dropping a muster-out roll (musterOutRolls reads ch.terms).
    expect(c.terms).toBe(1);
  });

  it("a final-year death stays deceased and is counted consistently", () => {
    const c = runFinalYearExitTerm("death");
    expect(c.deceased).toBe(true);
    expect(c.acgState!.yearsServed).toBe(4);
    // A mid-term death always counted (partial branch); a full-length term
    // ending in death now counts the same one term — consistent, and
    // harmless (a deceased character never musters).
    expect(c.terms).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MT-F1 — free-trader routing keys off the JSON lineSize field, not the label.
// The free-trader enlistment row is relabeled (typeOfLine renamed, lineSize
// kept null) so the label check and the lineSize check diverge; the fix must
// still route the line as a Free Trader.
// ---------------------------------------------------------------------------

describe("MT-F1: free-trader detection uses lineSize (JSON), not the typeOfLine label", () => {
  const RELABELED = "Independent Trader";

  function withRelabeledFreeTraderLine(body: () => void): void {
    const data = getAcgPathway("mt-megatraveller", "merchantPrince");
    expect(data).toBeDefined();
    const freeRow = data!.enlistment.rows.find((r) => r.lineSize === null);
    expect(freeRow).toBeDefined();
    const originalLabel = freeRow!.typeOfLine;
    freeRow!.typeOfLine = RELABELED; // lineSize stays null → still a free trader
    try {
      body();
    } finally {
      freeRow!.typeOfLine = originalLabel;
    }
  }

  it("merchantFinalizeMuster grants the free-trader ship for a relabeled line", () => {
    withRelabeledFreeTraderLine(() => {
      const c = acgChar("merchantPrince");
      const m = c.requireMerchantAcg();
      m.lineType = RELABELED;
      c.acgState!.rankCode = "O5"; // Owner/Captain ≥ O5
      c.acgState!.isOfficer = true;
      merchantFinalizeMuster(c);
      // Teeth: pre-fix `acg.lineType !== "Free Trader"` returned early for the
      // relabeled line → no ship. The fix routes on lineSize: null.
      expect(c.benefits).toContain("Free Trader");
      expect(c.acgState!.freeTraderShipEarned).toBe(true);
    });
  });

  it("selectMerchantResolutionTable routes a relabeled free trader onto the free-trader tables", () => {
    withRelabeledFreeTraderLine(() => {
      vi.spyOn(Math, "random").mockReturnValue(0.999); // survive, drive rolls high
      const c = acgChar("merchantPrince");
      const m = c.requireMerchantAcg();
      m.lineType = RELABELED;
      m.department = "Free Trader";
      c.acgState!.rankCode = "E1";
      c.acgState!.isOfficer = false;
      c.acgState!.year = 2;
      // Teeth: pre-fix `isFreeTrader` was false for the relabeled line, so the
      // resolver looked up assignmentResolution["freeTrader"] (no such table)
      // and THREW. The fix routes Smuggling onto freeTraderOther (survival 6+).
      expect(() => merchantResolveAssignment(c, "Smuggling")).not.toThrow();
      const survival = c.events.find(
        (e) => e.kind === "roll" && /Survival/.test(formatEvent(e)),
      );
      expect(survival).toBeDefined();
      expect(formatEvent(survival!)).toContain("vs 6+");
    });
  });
});

// ---------------------------------------------------------------------------
// MT-F7 — special-duty exam DM magnitude read from prose; multi-word transfer.
// The businessSchool resolution effect is temporarily rewritten to a +2 DM
// (no rank qualifier) and a multi-word transfer target, then the special-duty
// roll is pinned to select Business School (officers column, die 6).
// ---------------------------------------------------------------------------

describe("MT-F7: special-duty effect parsing reads the DM magnitude and multi-word targets", () => {
  it("applies the prose magnitude (+2) and a multi-word transfer target", () => {
    const data = getAcgPathway("mt-megatraveller", "merchantPrince");
    expect(data).toBeDefined();
    const businessSchool = data!.specialDutyResolution?.businessSchool;
    expect(businessSchool).toBeDefined();
    const originalEffect = businessSchool!.effect!;
    // +2 (not +1), no "for O6+" qualifier, and a multi-word transfer target.
    businessSchool!.effect = "DM +2 on exam; transfer to Ship's Troops.";
    try {
      vi.spyOn(Math, "random").mockReturnValue(d6(6)); // die 6 → officers: Business School
      const c = acgChar("merchantPrince");
      c.attributes.education = 7; // suppress the Edu-9 special-duty DM
      const acg = c.requireMerchantAcg();
      acg.isOfficer = true;
      acg.rankCode = "O2"; // < O5 transfer-block, no exam rank floor
      acg.department = "Deck"; // so the transfer to Ship's Troops actually moves

      merchantSpecialAssignment(c);

      // Teeth: pre-fix `/Transfer to (\w+)/` captured only "Ship"; the fix
      // captures the whole "Ship's Troops".
      expect(c.requireMerchantAcg().department).toBe("Ship's Troops");
      // Teeth: pre-fix `/DM \+1 .../` + unconditional `+ 1` added 1 (and would
      // not even match "DM +2"); the fix reads the magnitude from the prose.
      expect(c.requireMerchantAcg().perTerm.examDm).toBe(2);
    } finally {
      businessSchool!.effect = originalEffect;
    }
  });
});
