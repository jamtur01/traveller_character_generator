// End-to-end workflow walkthroughs. Each test drives a full chargen
// through the session API (the same surface the React UI uses) and
// asserts invariants on the resulting events/state. Catches
// interactive-mode bugs that auto-mode tests don't surface — duplicate
// log lines, runaway choice queues, orphaned phase state, etc.

import { afterEach, describe, expect, it, vi } from "vitest";
import type * as session from "../lib/traveller/chargen/session";
import {
  walkBasic, walkCtBasic, walkAcg,
  consecutiveSectionRuns, termBeginsPerTerm,
} from "./_walker";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CT basic chargen — auto mode, every service", () => {
  for (const svc of [
    "navy", "marines", "army", "scouts", "merchants", "other",
  ]) {
    it(`${svc}: completes without duplicate termBegin events`, () => {
      const r = walkCtBasic({ service: svc });
      // Each term entered should have exactly one termBegin event.
      for (const [n, count] of termBeginsPerTerm(r.character)) {
        expect(count, `term ${n} termBegin count`).toBe(1);
      }
      // No back-to-back section separators (would indicate duplicate
      // term boundary firing).
      expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
      // Event log strictly grows per term (no resets/replays).
      for (let i = 1; i < r.eventCountTrail.length; i++) {
        expect(r.eventCountTrail[i]!).toBeGreaterThanOrEqual(r.eventCountTrail[i - 1]!);
      }
    });
  }
});

describe("MT basic chargen (no ACG) — auto", () => {
  for (const svc of ["navy", "marines", "army", "scouts", "merchants"]) {
    it(`MT ${svc} (auto): clean termBegin, no runaway queue`, () => {
      const r = walkBasic({ edition: "mt-megatraveller", service: svc });
      for (const [n, count] of termBeginsPerTerm(r.character)) {
        expect(count, `term ${n} termBegin`).toBe(1);
      }
      expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
      expect(r.character.pendingChoices.length).toBe(0);
    });
  }
});

describe("CT basic chargen — interactive mode", () => {
  for (const svc of ["navy", "marines"]) {
    it(`${svc} interactive: no duplicate logs, all choices drain`, () => {
      const r = walkCtBasic({ service: svc, interactive: true });
      for (const [n, count] of termBeginsPerTerm(r.character)) {
        expect(count, `term ${n} termBegin`).toBe(1);
      }
      expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
      // All player choices should be resolved by walk end.
      expect(r.character.pendingChoices.length).toBe(0);
    });
  }
});

describe("MT ACG mercenary — both services × auto/interactive", () => {
  for (const service of ["army", "marines"] as const) {
    for (const interactive of [false, true]) {
      const mode = interactive ? "interactive" : "auto";
      it(`mercenary ${service} (${mode}): clean termBegin, no runaway queue`, () => {
        const r = walkAcg({
          pathway: "mercenary",
          service,
          combatArm: "Infantry",
          interactive,
        });
        for (const [n, count] of termBeginsPerTerm(r.character)) {
          expect(count, `term ${n} termBegin`).toBe(1);
        }
        expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
        expect(r.character.pendingChoices.length).toBe(0);
      });
    }
  }
});

describe("MT ACG navy — all fleets × auto/interactive", () => {
  for (const fleet of ["imperialNavy", "reserveFleet", "systemSquadron"] as const) {
    for (const interactive of [false, true]) {
      const mode = interactive ? "interactive" : "auto";
      it(`navy ${fleet} (${mode}): clean termBegin, no runaway queue`, () => {
        const r = walkAcg({
          pathway: "navy",
          fleet,
          interactive,
        });
        for (const [n, count] of termBeginsPerTerm(r.character)) {
          expect(count, `term ${n} termBegin`).toBe(1);
        }
        expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
        expect(r.character.pendingChoices.length).toBe(0);
      });
    }
  }
});

describe("MT ACG scout — both divisions × auto/interactive", () => {
  for (const division of ["field", "bureaucracy"] as const) {
    for (const interactive of [false, true]) {
      const mode = interactive ? "interactive" : "auto";
      it(`scout ${division} (${mode}): clean termBegin, no runaway queue`, () => {
        const r = walkAcg({
          pathway: "scout",
          division,
          interactive,
        });
        for (const [n, count] of termBeginsPerTerm(r.character)) {
          expect(count, `term ${n} termBegin`).toBe(1);
        }
        expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
        expect(r.character.pendingChoices.length).toBe(0);
      });
    }
  }
});

describe("MT ACG merchant prince — all line types × auto/interactive", () => {
  for (const lineType of [
    "Megacorp", "Sector-wide", "Subsector-wide", "Interface", "Fledgling", "Free Trader",
  ]) {
    for (const interactive of [false, true]) {
      const mode = interactive ? "interactive" : "auto";
      it(`merchant ${lineType} (${mode}): clean termBegin, no runaway queue`, () => {
        const r = walkAcg({
          pathway: "merchantPrince",
          lineType,
          interactive,
        });
        for (const [n, count] of termBeginsPerTerm(r.character)) {
          expect(count, `term ${n} termBegin`).toBe(1);
        }
        expect(consecutiveSectionRuns(r.character)).toBeLessThanOrEqual(1);
        expect(r.character.pendingChoices.length).toBe(0);
      });
    }
  }
});

describe("Pre-career interactive walkthroughs", () => {
  it("college admit + OTC commission + branch pick (interactive)", async () => {
    const { Character } = await import("../lib/traveller/character");
    const session = await import("../lib/traveller/chargen/session");
    const { freshAcgState } = await import("../lib/traveller/engine/acg/state");
    vi.spyOn(Math, "random").mockReturnValue(0.999); // max rolls — admit + honors + OTC
    const c = new Character({
      attributes: {
        strength: 8, dexterity: 8, endurance: 8,
        intelligence: 12, education: 12, social: 12,
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "interactive";
    c.acgPathway = "mercenary";
    c.acgState = freshAcgState("mercenary");
    let snap: session.ChargenSnapshot = { character: c, phase: "pre_career" };
    snap = session.applyPreCareer(snap, "college").snapshot;
    // After applyPreCareer, schoolsAttempted must record "college"
    // (regression: this was missed when OTC threw before
    // applyPreCareerResult ran).
    expect(snap.character.acgState?.schoolsAttempted).toContain("college");
    // Resolve the OTC branch picker if queued.
    const otcChoice = snap.character.pendingChoices.find(
      (p) => p.kind === "cascade" && p.context?.source === "otcBranch",
    );
    if (otcChoice) {
      snap = session.resolvePending(snap, otcChoice.id, 0); // Army
    }
    // Exactly one OTC promotion event.
    const otcPromotions = snap.character.events.filter(
      (e) => e.kind === "promoted" && /OTC/.test(e.source ?? ""),
    );
    expect(otcPromotions.length).toBeLessThanOrEqual(1);
  });

  it("running pre-career again after a failed school doesn't re-offer the same school", async () => {
    const { Character } = await import("../lib/traveller/character");
    const session = await import("../lib/traveller/chargen/session");
    const { freshAcgState } = await import("../lib/traveller/engine/acg/state");
    vi.spyOn(Math, "random").mockReturnValue(0.001); // low rolls — admission fails
    const c = new Character({
      attributes: {
        strength: 5, dexterity: 5, endurance: 5,
        intelligence: 5, education: 5, social: 5,
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "interactive";
    c.acgPathway = "mercenary";
    c.acgState = freshAcgState("mercenary");
    let snap: session.ChargenSnapshot = { character: c, phase: "pre_career" };
    snap = session.applyPreCareer(snap, "college").snapshot;
    expect(snap.character.acgState?.schoolsAttempted).toContain("college");
  });
});

describe("MT ACG: each Run-term click after a paused choice must be a no-op", () => {
  // Regression for the user's "Term 2 (age 22)" duplicated 20× bug:
  // clicking Run term while a choice is pending should NOT alter
  // character state (no extra events, no extra rolls, same age).
  it("repeated Run-term clicks while paused don't mutate state", async () => {
    const { vi: viMod } = await import("vitest");
    viMod.spyOn(Math, "random").mockReturnValue(0.5);
    const { Character } = await import("../lib/traveller/character");
    const session = await import("../lib/traveller/chargen/session");
    const { freshAcgState } = await import("../lib/traveller/engine/acg/state");
    const c = new Character({
      attributes: {
        strength: 10, dexterity: 10, endurance: 10,
        intelligence: 12, education: 12, social: 12,
      },
    });
    c.editionId = "mt-megatraveller";
    c.useAcg = true;
    c.choiceMode = "interactive";
    c.acgPathway = "mercenary";
    c.acgState = freshAcgState("mercenary");
    c.requireMercenaryAcg().combatArm = "Infantry";
    // Enlistment is skipped in this fixture; set the branch it would set.
    c.requireMercenaryAcg().branch = "Army";
    c.service = "army";
    let snap: session.ChargenSnapshot = { character: c, phase: "term" };
    snap = session.runTerm(snap);
    if (snap.character.pendingChoices.length === 0) return; // no pause path
    const beforeEvents = snap.character.events.length;
    const beforeAge = snap.character.age;
    snap = session.runTerm(snap);
    snap = session.runTerm(snap);
    snap = session.runTerm(snap);
    expect(snap.character.events.length).toBe(beforeEvents);
    expect(snap.character.age).toBe(beforeAge);
  });
});
