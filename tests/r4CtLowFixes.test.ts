// Round-4 CT LOW-priority regressions. Each group locks a committed fix on
// feat/chargen-models against reversion by constructing characters, running the
// real engine paths, and asserting the observable contract the fix established:
//   CT-1  (a3cfed4) — the CotI position check logs "Position", TTB "Commission".
//   CT-6  (5017c73) — an explicit Nobility pick honors the Social 10+ gate.
//   CT-L2 (50e160c) — the CotI "+1 if retired" cash DM, non-cumulative, scoped
//                     to CotI careers via serviceIn.
// Mirrors tests/musterDms.audit.test.ts + tests/r4Behavioral.test.ts.

import { describe, expect, it } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes, ServiceKey } from "@/lib/traveller/types";
import { getEditionServices } from "@/lib/traveller/services";
import { doEnlistment } from "@/lib/traveller/chargen/enlistment";
import { cashDmFor } from "@/lib/traveller/engine/musterDm";

// ---------------------------------------------------------------------------
// CT-1: the position check's roll-log label is edition-data driven. CotI
// careers (pirates, source "coti") declare label "Position"; TTB careers
// (navy, source "ttb") declare "Commission". Before the fix, checkCommission
// hard-coded the log label to "Commission", so a pirate's position roll was
// mislabeled. The mechanic is identical either way — only the label differs.
// ---------------------------------------------------------------------------

describe("CT-1: position check logs the edition label (CotI 'Position' / TTB 'Commission')", () => {
  it("pirates (CotI) expose positionLabel 'Position', navy (TTB) 'Commission'", () => {
    const svc = getEditionServices("ct-classic");
    expect(svc.pirates!.positionLabel).toBe("Position");
    expect(svc.navy!.positionLabel).toBe("Commission");
  });

  it("checkCommission logs the CotI 'Position' label on the roll event", () => {
    const svc = getEditionServices("ct-classic");
    const ch = new Character({
      seed: 1,
      attributes: {
        strength: 12, dexterity: 12, endurance: 12,
        intelligence: 12, education: 12, social: 8,
      },
    });
    ch.service = "pirates";
    svc.pirates!.checkCommission(ch);
    const roll = ch.events.find((e) => e.kind === "roll");
    expect(roll).toMatchObject({ rollName: "Position" });
  });
});

// ---------------------------------------------------------------------------
// CT-6: the automatic-only Nobility enrolls on Social 10+ (CotI) or not at
// all — there is no 2D enlistment roll. An explicit "nobles" pick now routes
// through tryNobilityAutoEnroll, which drafts a sub-Soc-10 pick. Before the
// fix an explicit nobles pick fell through to the normal enlistment roll,
// where the automaticIf gate encodes enlistmentThrow = 0, so any 2D result
// "succeeded" and the unqualified character wrongly enrolled as a noble.
// ---------------------------------------------------------------------------

describe("CT-6: explicit Nobility pick honors the Social 10+ auto-enroll gate", () => {
  const A = (social: number): Attributes => ({
    strength: 7, dexterity: 7, endurance: 7,
    intelligence: 7, education: 7, social,
  });

  it("Social 6 nobles pick is refused and drafted, not enrolled", () => {
    const low = new Character({ seed: 42, attributes: A(6) });
    expect(doEnlistment(low, "nobles")).not.toBe("nobles");
    expect(low.drafted).toBe(true);
  });

  it("Social 11 nobles pick auto-enrolls as nobles", () => {
    const high = new Character({ seed: 42, attributes: A(11) });
    expect(doEnlistment(high, "nobles")).toBe("nobles");
  });
});

// ---------------------------------------------------------------------------
// CT-L2: CotI grants a +1 cash-table DM for having retired, but the footnote
// says it is NOT cumulative with the Gambling-1+ +1 — take the single largest
// matching +1, not the sum (cashTableDmCumulative:false). The retired rule is
// scoped by serviceIn to CotI careers, so a TTB career (marines) gets 0.
//   - retired Nobles + Gambling-1 → +1 (non-cumulative), not +2.
//   - retired Nobles, no Gambling → +1 (CotI retired rule matches).
//   - retired Marines, no Gambling → 0 (TTB career: retired rule scoped out).
// ---------------------------------------------------------------------------

describe("CT-L2: CotI retired cash DM is +1, non-cumulative, CotI-only", () => {
  const mk = (svc: ServiceKey, gambling: boolean): number => {
    const c = new Character({
      seed: 1,
      attributes: {
        strength: 12, dexterity: 12, endurance: 12,
        intelligence: 12, education: 12, social: 11,
      },
    });
    c.service = svc;
    c.chargenStatus = { kind: "retired", reason: "t", withPension: true };
    if (gambling) c.addSkill("Gambling", 1);
    return cashDmFor(c);
  };

  it("retired Nobles + Gambling-1 sums to +1, not +2 (non-cumulative)", () => {
    expect(mk("nobles", true)).toBe(1);
  });

  it("retired Nobles with no Gambling still gets the CotI retired +1", () => {
    expect(mk("nobles", false)).toBe(1);
  });

  it("retired Marines (TTB) gets 0 — retired DM scoped out by serviceIn", () => {
    expect(mk("marines", false)).toBe(0);
  });
});
