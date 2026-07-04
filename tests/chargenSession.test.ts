// Tests for the chargen session module. Locks in the flow-control
// extraction from app/page.tsx: each session action takes a snapshot
// and returns a new snapshot. Bugs in the React handler used to be in
// here; centralizing them lets us test without React.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  startCareer, enlist, musterChoice,
  attemptMusterOut, resolvePending,
  type ChargenSnapshot,
} from "../lib/traveller/chargen/session";

afterEach(() => {
  vi.restoreAllMocks();
});

function freshSnap(): ChargenSnapshot {
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  const snap = startCareer({
    edition: "ct-classic",
    verbose: false,
    interactiveMode: false,
    supportsInteractive: false,
    useAcg: false,
    acgPathway: "",
  });
  vi.restoreAllMocks();
  return snap;
}

describe("session.startCareer", () => {
  it("creates a fresh character at phase=career for basic chargen", () => {
    const snap = freshSnap();
    expect(snap.character).toBeInstanceOf(Character);
    expect(snap.phase).toBe("career");
    expect(snap.character.terms).toBe(0);
  });

  it("routes ACG characters to pre_career first", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const snap = startCareer({
      edition: "mt-megatraveller",
      verbose: false,
      interactiveMode: false,
      supportsInteractive: true,
      useAcg: true,
      acgPathway: "mercenary",
    });
    expect(snap.phase).toBe("pre_career");
    expect(snap.character.useAcg).toBe(true);
    expect(snap.character.acgPathway).toBe("mercenary");
  });

  it("routes ACG-flag without pathway to plain career", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const snap = startCareer({
      edition: "mt-megatraveller",
      verbose: false,
      interactiveMode: false,
      supportsInteractive: true,
      useAcg: true,
      acgPathway: "", // no pathway picked
    });
    expect(snap.phase).toBe("career");
  });
});

describe("session.enlist + runTerm + muster (basic chargen)", () => {
  it("enlist into navy → term → eventually retire/muster", () => {
    // freshSnap restores all mocks before returning, so the Math.random
    // mock must be installed AFTER it. Without this ordering, enlist()
    // runs with unmocked randomness and the test flakes: a low draft
    // roll routes the character into scouts/army/other instead of navy.
    let snap = freshSnap();
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    snap.character.attributes = {
      strength: 12, dexterity: 12, endurance: 12,
      intelligence: 12, education: 12, social: 12,
    };
    snap = enlist(snap, {
      verbose: false,
      preferredService: "navy",
      acgService: "army", acgCombatArm: "Infantry",
      acgFleet: "imperialNavy", acgDivision: "field",
      acgLineType: "Free Trader", acgSubsectorTech: "",
      acgMerchantAcademy: false,
    });
    expect(snap.phase).toBe("term");
    expect(snap.character.service).toBe("navy");
  });
});

describe("session.musterChoice phase routing", () => {
  it("rolls cash → decrements musterRolls and stays in muster", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 2;
    c.enterMustered();
    c.muster.musterRolls = 3;
    c.choiceMode = "auto";
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const snap = musterChoice({ character: c, phase: "muster" }, "cash");
    expect(snap.character.muster.musterRolls).toBe(2);
    expect(snap.phase).toBe("muster");
    expect(snap.character.muster.musterCashUsed).toBe(1);
  });

  it("last muster roll routes to end and emits endGeneration", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 2;
    c.enterMustered();
    c.muster.musterRolls = 1;
    c.choiceMode = "auto";
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const snap = musterChoice({ character: c, phase: "muster" }, "cash");
    expect(snap.phase).toBe("end");
    expect(snap.character.events.some(
      (e) => e.kind === "endGeneration"),
    ).toBe(true);
  });

  it("max cash rolls routes to muster_no_cash", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 2;
    c.enterMustered();
    c.muster.musterRolls = 2;
    c.muster.musterCashUsed = 2; // CT cap is 3 — about to hit it
    c.choiceMode = "auto";
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const snap = musterChoice({ character: c, phase: "muster" }, "cash");
    expect(snap.phase).toBe("muster_no_cash");
    expect(snap.character.muster.musterCashUsed).toBe(3);
  });
});

describe("session.attemptMusterOut", () => {
  it("voluntary muster fires endChargenRetired and routes to muster", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 5;
    c.choiceMode = "auto";
    const snap = attemptMusterOut({ character: c, phase: "term" });
    expect(snap.character.events.some(
      (e) => e.kind === "endGeneration" && e.reason === "retired"),
    ).toBe(true);
    // Two events of endGeneration would indicate the duplicate bug
    // that was fixed earlier in the review pass.
    expect(
      snap.character.events.filter((e) => e.kind === "endGeneration").length,
    ).toBe(1);
  });

  it("noop when character is in mandatory reenlist", () => {
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 2;
    c.enterMandatoryReenlist();
    const before = c.terms;
    const snap = attemptMusterOut({ character: c, phase: "term" });
    expect(snap.character.terms).toBe(before);
    expect(snap.character).toBe(c); // identity-equal — no clone made
  });
});

describe("session.resolvePending — muster cascade finalization", () => {
  it("nested skillCap choice still finalizes the muster roll", () => {
    // Setup: a muster cascade just paused. pendingMusterRoll is true.
    // We simulate the cascade resolving (no pending choices), and the
    // session should decrement musterRolls + route phase.
    const c = new Character();
    c.editionId = "ct-classic";
    c.service = "navy";
    c.terms = 2;
    c.enterMustered();
    c.muster.musterRolls = 2;
    c.muster.pendingMusterRoll = true;
    c.choiceMode = "auto";
    // No actual pending choice to resolve — pass a non-existent id;
    // resolveChoice will be a no-op but the finalization should still run.
    const snap = resolvePending({ character: c, phase: "muster" }, "nope", 0);
    expect(snap.character.muster.musterRolls).toBe(1);
    expect(snap.character.muster.pendingMusterRoll).toBe(false);
    expect(snap.phase).toBe("muster");
  });
});
