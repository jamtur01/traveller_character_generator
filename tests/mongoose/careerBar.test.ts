// Red-green lock for the Mongoose 2e "cannot return to a career next term"
// rule (Core p.18; reference/mongoose-2e.md:203): "If you leave a career, you
// cannot return to it in the next term. Exceptions: the draft (may re-enter a
// career you were previously ejected from) and the Drifter career (always
// open)."
//
// The fix lives in three pieces, each pinned below:
//   1. availableCareerIds (engine/mongoose/enlist.ts) — the pure filter the
//      NORMAL picker applies: drops the just-left career unless it is Drifter
//      (empty qualification characteristics, always open); null → no bar.
//   2. musterOut (engine/mongoose/muster.ts) records state.lastLeftCareer, and
//      pickCareerNormally (chargen/models/mongoose.ts) feeds it to the filter —
//      so a career left via the session is absent from the next normal prompt.
//   3. the draft path (rollDraftAndEnter) never consults the filter, so a
//      forced draft can still land in the just-left career (the exception).
//
// Determinism: interactive re-execution requires a seeded rng OR a fully pinned
// Math.random (session.ts:116-122). These integration cases pin Math.random to
// 0.5 — every die reads floor(0.5*6+1)=4, so 2D=8 and 1D=4 on every draw and
// every re-run — which clears merchant Qualification (target 4), Survival
// (target 5), and Advancement (target 7), and steers the draft roll to row 4
// (merchant/merchantMarine), all without a natural 2 or 12.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";
import { availableCareerIds } from "@/lib/traveller/engine/mongoose/enlist";
import { getEdition } from "@/lib/traveller/editions";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";

const ENLIST: EnlistOptions = {
  verbose: false,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

// The real mongoose career data the engine sees. `allIds` is the VOLUNTARY
// career domain (every career minus the forcedOnly Prisoner) — exactly what
// pickCareerNormally passes to availableCareerIds.
const CAREERS = getEdition("mongoose-2e").data.mongoose!.careers;
const ALL_IDS = optionDomain("mongoose-2e", "mongoose.career").values;

// --- Lock 1: availableCareerIds — the pure next-term filter ------------------
describe("availableCareerIds bars the just-left non-Drifter career (Core p.18)", () => {
  it("just-left non-Drifter (merchant) is dropped; every other career + drifter stay", () => {
    const result = availableCareerIds(ALL_IDS, CAREERS, "merchant");
    expect(result).not.toContain("merchant"); // the bar
    expect(result).toContain("drifter"); // always open
    expect(result).toContain("agent"); // an unrelated career is untouched
    // Exact membership: precisely the full domain minus merchant, order kept.
    expect(result).toEqual(ALL_IDS.filter((id) => id !== "merchant"));
  });

  it("just-left Drifter is NOT dropped — the Drifter career is always open", () => {
    const result = availableCareerIds(ALL_IDS, CAREERS, "drifter");
    expect(result).toContain("drifter");
    expect(result).toEqual([...ALL_IDS]); // nothing filtered
  });

  it("no career left yet (null) offers every career (first choice)", () => {
    expect(availableCareerIds(ALL_IDS, CAREERS, null)).toEqual([...ALL_IDS]);
  });
});

// --- Lock 2: end-to-end — leaving a career bars it next term -----------------
describe("a career left via the session is absent from the next normal prompt", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Resolve every pending choice (always option 0) until the frontier is a
   *  mongooseCareer prompt or the action completes. Mirrors the drive-to-career
   *  loop in tests/mongooseLabels.test.ts. */
  function drainToCareer(s: session.ChargenSnapshot): session.ChargenSnapshot {
    for (let guard = 0; guard < 300; guard++) {
      const p = s.character.pendingChoices[0];
      if (!p || p.kind === "mongooseCareer") return s;
      s = session.resolvePending(s, p.id, 0).snapshot;
    }
    throw new Error("drainToCareer: exceeded guard without reaching a career prompt");
  }

  it("merchant, once mustered out of, is not re-offered while drifter still is", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // pinned: 2D=8, 1D=4 every draw
    const start = session.startCareer({
      edition: "mongoose-2e", verbose: false,
      interactiveMode: true, supportsInteractive: true,
      useAcg: false, acgPathway: "",
    });

    // Enlist and drive to the FIRST career prompt — merchant is offered here
    // (nothing left yet), so pick it, then let qualification + entry finish.
    let s = drainToCareer(session.enlist(start, ENLIST));
    const first = s.character.pendingChoices[0]!;
    expect(first.kind).toBe("mongooseCareer");
    expect(first.options).toContain("merchant"); // available on the first choice
    const mIdx = first.options.indexOf("merchant");
    s = drainToCareer(session.resolvePending(s, first.id, mIdx).snapshot);
    expect(s.phase).toBe("term");
    expect(s.character.mongooseState!.career).toBe("merchant");

    // Serve one term, then voluntarily muster out of merchant.
    s = drainToCareer(session.runTerm(s));
    expect(s.phase).toBe("term");
    s = drainToCareer(session.attemptMusterOut(s));
    expect(s.phase).toBe("career");
    expect(s.character.mongooseState!.lastLeftCareer).toBe("merchant");

    // Re-enlist: the next NORMAL career prompt must omit merchant (just left)
    // but still offer drifter (always open) and unrelated careers.
    s = drainToCareer(session.enlist(s, ENLIST));
    const next = s.character.pendingChoices[0]!;
    expect(next.kind).toBe("mongooseCareer");
    expect(next.options).not.toContain("merchant"); // the next-term bar
    expect(next.options).toContain("drifter"); // exception: always open
    expect(next.options).toContain("agent"); // unrelated careers remain
    expect(next.options).toEqual(ALL_IDS.filter((id) => id !== "merchant"));
  });
});

// --- Lock 3: the draft exception ignores the bar ----------------------------
describe("the draft path ignores the next-term career bar (Core p.18 exception)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a forced draft re-enters the just-left career the normal picker would bar", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // 1D=4 -> draft row 4 = merchant
    const snap = session.startCareer({
      edition: "mongoose-2e", verbose: false,
      interactiveMode: false, supportsInteractive: false,
      useAcg: false, acgPathway: "",
    });
    const st = snap.character.mongooseState!;
    st.lastLeftCareer = "merchant"; // merchant was just left
    st.careerCount = 1; // a subsequent term (skip background skills)
    st.mustDraft = true; // an event forcibly drafts the Traveller

    // The NORMAL picker would bar merchant in this exact state...
    expect(availableCareerIds(ALL_IDS, CAREERS, "merchant")).not.toContain("merchant");

    // ...but the draft path enters it regardless: draft row 4 is merchant.
    const after = session.enlist(snap, ENLIST);
    expect(after.character.mongooseState!.career).toBe("merchant");
    // No normal career prompt was raised — the draft bypassed the picker.
    expect(after.character.pendingChoices.some((p) => p.kind === "mongooseCareer")).toBe(false);
  });
});
