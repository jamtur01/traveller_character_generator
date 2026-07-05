// Regression tests for the Mongoose/ACG display-label work: the UI/sheet must
// render the JSON's human labels (career/assignment displayName, rank-ladder
// title, career-picker option labels) rather than the engine's raw ids and
// bare rank numbers, and the mongoose service history must divide into
// four-year terms like CT/MT.

import { describe, it, expect } from "vitest";
import { Character } from "@/lib/traveller/character";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import {
  currentCareerLabel,
  currentAssignmentLabel,
  currentRankTitle,
} from "@/lib/traveller/engine/mongoose/labels";
import { titleize } from "@/lib/traveller/formatting";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

const ATTRS = {
  strength: 7, dexterity: 7, endurance: 7,
  intelligence: 7, education: 7, social: 7,
};

/** A mongoose character parked in a career, ready for label resolution.
 *  Labels read only editionId + mongooseState, so attributes are irrelevant. */
function mongooseChar(over: {
  career: string; assignment: string; rank: number; commissioned?: boolean;
}): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.chargenModelId = "mongoose";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = over.career;
  c.mongooseState.assignment = over.assignment;
  c.mongooseState.rank = over.rank;
  c.mongooseState.commissioned = over.commissioned ?? false;
  return c;
}

const ENLIST: EnlistOptions = {
  verbose: true,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

// --- Group 1: currentRankTitle resolves the rank-ladder title ---------------
describe("currentRankTitle resolves the JSON rank-ladder title", () => {
  // merchant/merchantMarine enlisted ladder (Core p.34): rank 0 Crewman,
  // rank 1 Senior Crewman, rank 4 2nd Officer.
  it.each([
    [0, "Crewman"],
    [1, "Senior Crewman"],
    [4, "2nd Officer"],
  ])("merchant/merchantMarine rank %i -> %s", (rank, title) => {
    const c = mongooseChar({ career: "merchant", assignment: "merchantMarine", rank });
    expect(currentRankTitle(c)).toBe(title);
  });

  it("switches to the officer ladder once commissioned", () => {
    // navy/lineCrew rank 1: enlisted ladder title is "Able Spacehand", but a
    // commissioned officer at rank 1 is an "Ensign" (Core p.36 officer ladder).
    const enlisted = mongooseChar({ career: "navy", assignment: "lineCrew", rank: 1 });
    const officer = mongooseChar({
      career: "navy", assignment: "lineCrew", rank: 1, commissioned: true,
    });
    expect(currentRankTitle(enlisted)).toBe("Able Spacehand");
    expect(currentRankTitle(officer)).toBe("Ensign");
    // The commission must change the resolved title, not merely re-read it.
    expect(currentRankTitle(officer)).not.toBe(currentRankTitle(enlisted));
  });
});

// --- Group 2: currentCareerLabel / currentAssignmentLabel = displayNames -----
describe("current career/assignment labels use JSON displayNames", () => {
  const c = mongooseChar({ career: "merchant", assignment: "merchantMarine", rank: 0 });

  it("resolves the career displayName, not the raw id", () => {
    expect(currentCareerLabel(c)).toBe("Merchant");
    expect(currentCareerLabel(c)).not.toBe("merchant");
  });

  it("resolves the SPACED assignment displayName, not a capitalized id", () => {
    // A cap()-of-id fallback would yield "MerchantMarine" (one word); the JSON
    // displayName is the spaced "Merchant Marine".
    expect(currentAssignmentLabel(c)).toBe("Merchant Marine");
    expect(currentAssignmentLabel(c)).not.toBe("MerchantMarine");
    expect(currentAssignmentLabel(c)).not.toBe("merchantMarine");
  });
});

// --- Group 3: the career picker carries display optionLabels ----------------
describe("mongoose career picker carries displayName optionLabels", () => {
  it("options are raw ids and optionLabels are the parallel displayNames", () => {
    let s = session.startCareer({
      edition: "mongoose-2e", verbose: true, interactiveMode: true,
      supportsInteractive: true, useAcg: false, acgPathway: "", seed: 12345,
    });
    s = session.enlist(s, ENLIST);
    // Background-skill picks queue ahead of the career choice; resolve them
    // (always option 0) until the career picker is the pending frontier.
    let guard = 0;
    while (s.character.pendingChoices[0]?.kind !== "mongooseCareer" && guard++ < 40) {
      s = session.resolvePending(s, s.character.pendingChoices[0]!.id, 0).snapshot;
    }
    const pick = s.character.pendingChoices[0]!;
    expect(pick.kind).toBe("mongooseCareer");

    const { options, optionLabels } = pick;
    expect(optionLabels).toBeDefined();
    expect(optionLabels!.length).toBe(options.length);
    // Labels are the human displayNames, distinct from the raw ids.
    expect(optionLabels).not.toEqual(options);

    // Raw id present; matching label is the displayName at the SAME index.
    const idx = options.indexOf("merchant");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(optionLabels![idx]).toBe("Merchant");
    expect(optionLabels).toContain("Merchant");
    expect(options).not.toContain("Merchant");
  });
});

// --- Group 4: mongoose service history divides into terms --------------------
describe("mongoose history divides into four-year terms", () => {
  it("emits a term marker and a divider per term", () => {
    // seed 4: a multi-term merchant/other run in auto mode.
    let s = session.startCareer({
      edition: "mongoose-2e", verbose: true, interactiveMode: false,
      supportsInteractive: false, useAcg: false, acgPathway: "", seed: 4,
    });
    s = session.enlist(s, ENLIST);
    let guard = 0;
    while (s.phase === "term" && guard++ < 30) s = session.runTerm(s);

    const history = s.character.history;
    const termLines = history.filter((l) => /^Term \d+ \(age \d+\)/.test(l));
    const dividerLines = history.filter((l) => l.includes("----"));
    // Multiple terms -> multiple markers + dividers (history is not one stream).
    expect(termLines.length).toBeGreaterThanOrEqual(2);
    expect(dividerLines.length).toBeGreaterThanOrEqual(2);
  });
});

// --- Group 5: titleize splits camelCase and capitalizes ---------------------
describe("titleize turns engine ids into display labels", () => {
  it.each([
    ["freeTrader", "Free Trader"],
    ["serviceSkills", "Service Skills"],
    ["strength", "Strength"],
  ])("%s -> %s", (input, expected) => {
    expect(titleize(input)).toBe(expected);
  });
});
