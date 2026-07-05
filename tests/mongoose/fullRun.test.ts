import { describe, it, expect } from "vitest";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

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

function start(seed: number): session.ChargenSnapshot {
  return session.startCareer({
    edition: "mongoose-2e",
    verbose: false,
    interactiveMode: false,
    supportsInteractive: false,
    useAcg: false,
    acgPathway: "",
    seed,
  });
}

/** Drive a full character: enlist, serve up to 3 terms, muster out, finish. */
function generate(seed: number): session.ChargenSnapshot {
  let snap = session.enlist(start(seed), ENLIST);
  for (let i = 0; i < 3 && snap.phase === "term"; i++) snap = session.runTerm(snap);
  if (snap.phase === "term") snap = session.attemptMusterOut(snap); // leave career
  if (snap.phase === "career") snap = session.attemptMusterOut(snap); // finish
  return snap;
}

describe("Mongoose full character generation", () => {
  it("selects the mongoose model and starts between careers", () => {
    const snap = start(9876);
    expect(snap.character.chargenModelId).toBe("mongoose");
    expect(snap.character.useAcg).toBe(false);
    expect(snap.phase).toBe("career");
  });

  it("enlists into a career with background skills and basic training", () => {
    const snap = session.enlist(start(9876), ENLIST);
    expect(snap.phase).toBe("term");
    expect(snap.character.mongooseState!.career).toBeTruthy();
    expect(snap.character.mongooseState!.assignment).toBeTruthy();
    expect(snap.character.skills.length).toBeGreaterThan(0);
  });

  it("runs to completion with a career history and advanced age", () => {
    const snap = generate(9876);
    expect(snap.phase).toBe("end");
    const st = snap.character.mongooseState!;
    expect(st.history.length).toBeGreaterThanOrEqual(1);
    expect(st.history[0]!.career).toBeTruthy();
    expect(snap.character.age).toBeGreaterThanOrEqual(18);
    expect(snap.character.events.length).toBeGreaterThan(0);
  });

  it("is deterministic for a fixed seed (event-sourced re-execution)", () => {
    const a = generate(4242).character;
    const b = generate(4242).character;
    expect(a.attributes).toEqual(b.attributes);
    expect(a.skills).toEqual(b.skills);
    expect(a.mongooseState!.history).toEqual(b.mongooseState!.history);
    expect(a.credits).toBe(b.credits);
  });

  it("produces different characters for different seeds", () => {
    const a = generate(1).character;
    const b = generate(2).character;
    // Extremely unlikely to match across every skill + history for two seeds.
    const same = JSON.stringify(a.skills) === JSON.stringify(b.skills)
      && JSON.stringify(a.mongooseState!.history) === JSON.stringify(b.mongooseState!.history);
    expect(same).toBe(false);
  });
});
