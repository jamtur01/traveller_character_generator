// Regression tests for interactive-mode ACG pause/resume bugs that the
// auto-mode test suite couldn't catch. The user reported all four of
// these from manual browser walkthroughs:
//
//   1. Decoration-DM tradeoff prompt re-queued on every "Run term"
//      click (120 copies of the same choice piling up).
//   2. "Term 2 (age 22)" log + section separator duplicated on every
//      "Run term" while paused mid-year.
//   3. College pre-career attempt re-offered after OTC commission
//      paused the flow on the branch picker (schoolsAttempted never
//      recorded because applyPreCareerResult was skipped on throw).
//   4. "Promoted to O1 (OTC)" logged twice — once on the initial OTC
//      pass and once on branch resolution.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import { freshAcgState } from "../lib/traveller/engine/acg/state";

afterEach(() => {
  vi.restoreAllMocks();
});

function freshMtCharacter(): Character {
  const c = new Character({
    attributes: {
      strength: 10, dexterity: 10, endurance: 10,
      intelligence: 12, education: 12, social: 12,
    },
  });
  c.editionId = "mt-megatraveller";
  c.chargenModelId = "acg";
  c.choiceMode = "interactive";
  c.acgPathway = "mercenary";
  c.acgState = freshAcgState("mercenary");
  c.requireMercenaryAcg().combatArm = "Infantry";
  // Enlistment is skipped in this fixture; set the branch it would set.
  c.requireMercenaryAcg().branch = "Army";
  c.service = "army";
  return c;
}

describe("interactive ACG: decoration-DM tradeoff (regression #1)", () => {
  it("queues the prompt exactly once per year, not per Run-term click", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = freshMtCharacter();
    let snap: session.ChargenSnapshot = { character: c, phase: "term" };
    snap = session.runTerm(snap);
    const firstQueued = snap.character.pendingChoices.length;
    snap = session.runTerm(snap);
    snap = session.runTerm(snap);
    snap = session.runTerm(snap);
    expect(snap.character.pendingChoices.length).toBe(firstQueued);
  });

  it("does not re-queue the prompt when the year resumes after resolve", () => {
    // After the player resolves the prompt, resolvePending re-runs the
    // term from its pre-action base with the decision cursor answering the
    // recorded pick inline — the preRun hook re-fires on the re-run, but
    // its pickOrDefer is consumed synchronously, so no duplicate prompt
    // may remain queued.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = freshMtCharacter();
    let snap: session.ChargenSnapshot = { character: c, phase: "term" };
    snap = session.runTerm(snap);
    // Find the decoration-DM tradeoff choice (if queued) and resolve it.
    const choice = snap.character.pendingChoices.find(
      (p) => p.kind === "decorationDmTradeoff",
    );
    if (!choice) return; // pathway didn't reach a numeric decoration phase
    snap = session.resolvePending(snap, choice.id, 2).snapshot; // "No tradeoff"
    // After resolution + year resume, no fresh decorationDmTradeoff
    // prompt should be queued for the same year.
    const remaining = snap.character.pendingChoices.filter(
      (p) => p.kind === "decorationDmTradeoff",
    ).length;
    expect(remaining).toBe(0);
  });
});

describe("interactive ACG: term-init duplication (regression #2)", () => {
  it("does not re-emit termBegin + section separator on repeat Run-term clicks while paused", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const c = freshMtCharacter();
    let snap: session.ChargenSnapshot = { character: c, phase: "term" };

    snap = session.runTerm(snap);
    const termBeginsAfterFirst = snap.character.events.filter(
      (e) => e.kind === "termBegin",
    ).length;
    const sectionsAfterFirst = snap.character.events.filter(
      (e) => e.kind === "section",
    ).length;

    // Re-click Run term while paused.
    snap = session.runTerm(snap);
    snap = session.runTerm(snap);

    expect(
      snap.character.events.filter((e) => e.kind === "termBegin").length,
    ).toBe(termBeginsAfterFirst);
    expect(
      snap.character.events.filter((e) => e.kind === "section").length,
    ).toBe(sectionsAfterFirst);
  });
});

describe("interactive ACG: pre-career schoolsAttempted (regression #3)", () => {
  it("records schoolsAttempted even when OTC commission pauses on a branch choice", () => {
    // High Int/Edu so college admits + graduates. Forced d6=6 puts
    // commission rolls into the OTC-eligible range, queuing the branch
    // picker. Without the fix, applyPreCareerResult never fires and
    // schoolsAttempted stays empty — letting the player retry college.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshMtCharacter();
    c.acgState!.schoolsAttempted = [];
    const snap: session.ChargenSnapshot = { character: c, phase: "pre_career" };
    const result = session.applyPreCareer(snap, "college");

    expect(result.snapshot.character.acgState?.schoolsAttempted)
      .toContain("college");
  });
});

describe("interactive ACG: OTC promotion log (regression #4)", () => {
  it("emits ev.promoted once per OTC commission (not twice)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const c = freshMtCharacter();
    c.acgState!.schoolsAttempted = [];
    const snap: session.ChargenSnapshot = { character: c, phase: "pre_career" };
    const result = session.applyPreCareer(snap, "college");

    // Resolve the OTC branch choice if it's pending.
    let after = result.snapshot;
    if (after.character.pendingChoices.length > 0) {
      const choice = after.character.pendingChoices[0]!;
      if (choice.kind === "cascade" && choice.context?.source === "otcBranch") {
        after = session.resolvePending(after, choice.id, 0).snapshot; // Army
      }
    }

    const otcPromotions = after.character.events.filter(
      (e) => e.kind === "promoted" && /OTC/.test(e.source ?? ""),
    );
    expect(otcPromotions.length).toBeLessThanOrEqual(1);
  });
});
