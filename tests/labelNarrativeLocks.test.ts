// Behaviour locks for the label / narrative / blurb work:
//   b9741b1 — ACG skill-table columns render cited display names, never raw
//             camelCase keys, in picker optionLabels and history skill-sources.
//   bc21a3e — every ACG assignment (including a transfer reroll's REAL
//             assignment) logs its cited narrative when rolled.
//   1f78320 — a service's / career's cited description is logged at
//             enlistment / career entry; a service with no description logs no
//             (empty) blurb line.
//
// Each test names the observable contract it defends. Where a fix commit
// exists the test is confirmed to redden when that commit is reverted (see the
// yielded report); the gap-service test is a forward guard against a dropped
// fail-soft check.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/traveller/character";
import { assertPathway, freshAcgState } from "@/lib/traveller/engine/acg/state";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";
import { mercenaryResolveAssignment } from "@/lib/traveller/engine/acg/pathways/mercenary";
import { merchantResolveAssignment } from "@/lib/traveller/engine/acg/pathways/merchantPrince";
import { enterCareer } from "@/lib/traveller/engine/mongoose/enlist";
import { runAcgYear } from "@/lib/traveller/engine/runners/acg";
import type { Attributes } from "@/lib/traveller/types";

afterEach(() => {
  vi.restoreAllMocks();
});

const ATTRS: Attributes = {
  strength: 10, dexterity: 10, endurance: 10,
  intelligence: 10, education: 10, social: 10,
};

// One d6 face -> the Math.random value that produces it (roll = floor(x*6+1)).
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

/** Return the given faces in order, then fall through to a max (6) roll so
 *  the later resolution phases (survival/skills/bonus) pass unattended. */
function facesThenMax(...faces: number[]): () => number {
  let i = 0;
  return () => (i < faces.length ? d6(faces[i++]!) : d6(6));
}

// ---------------------------------------------------------------------------
// b9741b1 — LOCK 1: mercenary service-skills column picker renders cited
// display names, not the raw camelCase column keys.
// ---------------------------------------------------------------------------

describe("servicePolicy picker optionLabels are cited display names (b9741b1)", () => {
  it("an NCO's service-skills column choice labels 'Army Life' / 'NCO Skills', never armyLife", () => {
    // An Army NCO (E3+) rolling a service skill can pick Army Life OR NCO Skills
    // (servicePolicyColumns, PM p.51). "Training" resolves with decoration
    // "none" so the survival↔decoration tradeoff prompt does not fire — the
    // service-skills column picker is the ONLY interactive choice, and it
    // queues (ChoicePendingError) so we can read its option labels.
    const c = new Character({ attributes: ATTRS });
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "interactive";
    c.chargenModelId = "acg";
    c.acgPathway = "mercenary";
    const acg = freshAcgState("mercenary");
    assertPathway(acg, "mercenary");
    acg.combatArm = "Infantry";
    acg.branch = "Army";
    acg.rankCode = "E3";
    acg.isOfficer = false;
    c.acgState = acg;
    vi.spyOn(Math, "random").mockReturnValue(0.999); // survival/promotion pass

    expect(() => mercenaryResolveAssignment(c, "Training")).toThrow(ChoicePendingError);

    const picker = c.pendingChoices.find((p) => p.kind === "skillTable");
    expect(picker, "an NCO service-skills roll must queue a skillTable picker").toBeDefined();
    // The RAW resolution values stay camelCase (replay stability)...
    expect(picker!.options).toEqual(["armyLife", "ncoSkills"]);
    // ...but the player-facing labels are the PM's printed column headers.
    expect(picker!.optionLabels).toEqual(["Army Life", "NCO Skills"]);
    for (const label of picker!.optionLabels ?? []) {
      expect(label, `optionLabel "${label}" leaked a raw camelCase key`).not.toMatch(/[a-z][A-Z]/);
    }
  });
});

// ---------------------------------------------------------------------------
// b9741b1 — LOCK 2: merchant skill-roll history source renders the cited
// column display name, not the raw camelCase key.
// ---------------------------------------------------------------------------

describe("merchant skill-source history renders the cited display name (b9741b1)", () => {
  it("a service-table skill roll is sourced 'Merchant Service Merchant Life', never merchantLife", () => {
    const c = new Character({ attributes: ATTRS });
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.chargenModelId = "acg";
    c.acgPathway = "merchantPrince";
    const acg = freshAcgState("merchantPrince");
    assertPathway(acg, "merchantPrince");
    acg.lineType = "Sector-wide"; // Large line
    acg.department = "Deck";
    acg.rankCode = "E2";
    acg.isOfficer = false;
    acg.year = 1; // (year-1)%3 = 0 -> the "service" table, whose first column is merchantLife
    c.acgState = acg;
    vi.spyOn(Math, "random").mockReturnValue(0.999);

    merchantResolveAssignment(c, "Route");

    const merchantSkillSources: string[] = [];
    for (const e of c.events) {
      if (e.kind !== "skillLearned" && e.kind !== "skillImproved" && e.kind !== "attributeChange") {
        continue;
      }
      if (typeof e.source === "string" && e.source.startsWith("Merchant ")) {
        merchantSkillSources.push(e.source);
      }
    }
    expect(merchantSkillSources.length).toBeGreaterThan(0);
    for (const source of merchantSkillSources) {
      expect(source).toContain("Merchant Life"); // cited display header
      expect(source).not.toContain("merchantLife"); // raw column key
      expect(source, `skill source "${source}" leaked a raw camelCase key`).not.toMatch(/[a-z][A-Z]/);
    }
  });
});

// ---------------------------------------------------------------------------
// bc21a3e — LOCK 3: a normal per-year merchant assignment logs its cited
// narrative when it is rolled (through the runner).
// ---------------------------------------------------------------------------

describe("a rolled merchant assignment logs its cited narrative (bc21a3e)", () => {
  it("Route logs 'Route: duty on a merchant ship ...' alongside the assignmentRolled event", () => {
    const c = new Character({ attributes: ATTRS });
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.chargenModelId = "acg";
    c.acgPathway = "merchantPrince";
    c.service = "merchants";
    const acg = freshAcgState("merchantPrince");
    assertPathway(acg, "merchantPrince");
    acg.lineType = "Sector-wide"; // Large line: die 3 -> Route
    acg.department = "Deck";
    acg.rankCode = "E2";
    acg.isOfficer = false;
    acg.year = 2; // not year 1 term 1, so runAcgYear rolls a normal assignment (no initial training)
    c.acgState = acg;
    // 2D = 1+2 = 3 -> largeLine "Route"; the rest max out so resolution passes.
    vi.spyOn(Math, "random").mockImplementation(facesThenMax(1, 2));

    runAcgYear(c);

    const rolled = c.events.find((e) => e.kind === "assignmentRolled" && e.assignment === "Route");
    expect(rolled, "Route must be logged as the rolled assignment").toBeDefined();
    const narrative = c.events.find(
      (e) => e.kind === "raw"
        && e.text === "Route: duty on a merchant ship serving an established trade route "
          + "consistent with the size of the merchant line.",
    );
    expect(narrative, "Route must log its cited PM p.60 narrative line").toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// bc21a3e — LOCK 4: a merchant transfer reroll logs + narrates the REAL
// post-transfer assignment, not just the routing "Transfer Down".
// ---------------------------------------------------------------------------

describe("a merchant transfer reroll logs+narrates the REAL assignment (bc21a3e)", () => {
  it("Transfer Down rerolls to Route and logs Route's assignment + narrative", () => {
    const c = new Character({ attributes: ATTRS });
    c.editionId = "mt-megatraveller";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.chargenModelId = "acg";
    c.acgPathway = "merchantPrince";
    c.service = "merchants";
    const acg = freshAcgState("merchantPrince");
    assertPathway(acg, "merchantPrince");
    acg.lineType = "Sector-wide"; // Large; transfers DOWN to Subsector-wide (Small)
    acg.department = "Deck";
    acg.rankCode = "E2";
    acg.isOfficer = false;
    acg.year = 2;
    c.acgState = acg;
    // No dice for the transfer; then 2D = 1+2 = 3 -> smallLine "Route"; rest max.
    vi.spyOn(Math, "random").mockImplementation(facesThenMax(1, 2));

    merchantResolveAssignment(c, "Transfer Down");

    // The routing transfer actually happened...
    expect(c.events.some((e) => e.kind === "transferred")).toBe(true);
    // ...and the REAL rerolled assignment (not "Transfer Down") reached history.
    const rolledAssignments: string[] = [];
    for (const e of c.events) {
      if (e.kind === "assignmentRolled") rolledAssignments.push(e.assignment);
    }
    expect(rolledAssignments, "the rerolled real assignment must be logged").toContain("Route");
    // The bare routing result never becomes a logged assignment.
    expect(rolledAssignments).not.toContain("Transfer Down");
    const narrative = c.events.find(
      (e) => e.kind === "raw"
        && e.text === "Route: duty on a merchant ship serving an established trade route "
          + "consistent with the size of the merchant line.",
    );
    expect(narrative, "the rerolled Route must narrate itself").toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 1f78320 — LOCK 5: cited service / career descriptions log at enlistment /
// career entry; a gap service logs no (empty) blurb line.
// ---------------------------------------------------------------------------

describe("service / career descriptions log at enlistment / entry (1f78320)", () => {
  it("a CotI CT service (Pirates) logs its cited blurb at enlistment", () => {
    const c = new Character({ attributes: ATTRS });
    c.editionId = "ct-classic";
    c.showHistory = "none";
    c.choiceMode = "auto";
    vi.spyOn(Math, "random").mockReturnValue(0.999); // 2D = 12 -> enlistment succeeds

    const svc = c.doEnlistment("pirates");
    expect(svc).toBe("pirates");
    const blurb = c.events.find(
      (e) => e.kind === "raw"
        && e.text === "Pirates: Individuals crewing interplanetary or interstellar vessels, "
          + "who make their living by attacking, hijacking, or plundering commerce.",
    );
    expect(blurb, "Pirates must log its CotI p.5 description at enlistment").toBeDefined();
  });

  it("a documented-gap CT core service (Navy) logs NO blurb line", () => {
    const c = new Character({ attributes: ATTRS });
    c.editionId = "ct-classic";
    c.showHistory = "none";
    c.choiceMode = "auto";
    vi.spyOn(Math, "random").mockReturnValue(0.999); // 2D = 12 -> enlistment succeeds

    const svc = c.doEnlistment("navy");
    expect(svc).toBe("navy");
    // No description -> logServiceDescription is fail-soft: NO "Navy: ..." raw
    // line (and never an empty "Navy: undefined" line).
    const strayBlurb = c.events.filter((e) => e.kind === "raw" && /^Navy:\s/.test(e.text));
    expect(strayBlurb).toHaveLength(0);
  });

  it("a Mongoose career (Agent) logs its cited blurb at enterCareer", () => {
    const c = new Character({ attributes: ATTRS });
    c.editionId = "mongoose-2e";
    c.showHistory = "none";
    c.choiceMode = "auto";
    c.mongooseState = freshMongooseState();

    enterCareer(c, "agent", "lawEnforcement");

    const blurb = c.events.find(
      (e) => e.kind === "raw"
        && e.text === "Agent: Law enforcement agencies, corporate operatives, spies and others "
          + "who work in the shadows.",
    );
    expect(blurb, "Agent must log its MgT2 Core p.22 career intro at entry").toBeDefined();
  });
});
