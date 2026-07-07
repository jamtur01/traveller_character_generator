// Characterization ("golden") locks for the Phase-7 refactor targets that are
// NOT already covered by the existing suite: the PATHWAY-SPECIFIC school-effect
// leaves in engine/acg/schools.ts (runEffect + the branches gated on
// `pathway === ...`), and one uncovered pre-career admission branch.
//
// Phase 7 will genericize these leaves into JSON-parameterized primitives; this
// file pins their CURRENT observable outcome so the migration is a provable
// no-op. Each test names the leaf and the pathway it fires in, and asserts the
// exact end-state (arm/branch, rank/tier, officer flag, event, attribute).
//
// Already-locked leaves are intentionally NOT re-tested here:
//   - ocsCommission NAVY tier (E7->O2 + 2 service skills):
//       tests/regressions.acgFixes.test.ts "A3: navy OCS grads ...".
//   - ocsCommission drafted-first-term denial (E5 stays, isOfficer=false):
//       tests/disability.test.ts "F4/F17: drafted no OCS first term".
//   - Naval-Academy-honors -> Flight School graduation + skills:
//       tests/preCareer.test.ts "doPreCareer: Flight School".
//   - The JSON SHAPE of every effect (effect types / values / age limits):
//       tests/audit/mt.pdf.audit.test.ts.
//
// Determinism: Math.random is pinned via d6(v) — the uniform draw that makes
// Rng.roll(1) yield die `v` (roll(2) yields 2v) — or a raw constant for the
// index math of Rng.pick (pick index = floor(random * len)). The Character is
// built with explicit attributes (no constructor attribute rolls); the spy is
// installed inside each test so it governs only the leaf under test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import {
  assertPathway, freshAcgState, type AcgPathwayId,
} from "../lib/traveller/engine/acg/state";
import {
  applySpecialAssignment, applyScoutSchool,
} from "../lib/traveller/engine/acg/schools";

afterEach(() => {
  vi.restoreAllMocks();
});

// The Math.random value that makes Rng.roll(1) return die `v` (1-6):
// floor(d6(v) * 6 + 1) === v, and roll(2) === 2v.
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

const skillLevel = (c: Character, name: string): number =>
  c.skills.find(([n]) => n === name)?.[1] ?? -1;

const SERVICE_OF: Record<AcgPathwayId, string> = {
  mercenary: "army", navy: "navy", scout: "scouts", merchantPrince: "merchants",
};

/** ACG character on `pathway` with neutral (DM-free) attributes and a fresh
 *  pathway state. Mirrors tests/regressions.acgFixes.test.ts's fixture. */
function acgChar(pathway: AcgPathwayId): Character {
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7,
    },
  });
  c.editionId = "mt-megatraveller";
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.chargenModelId = "acg";
  c.service = SERVICE_OF[pathway] as Character["service"];
  c.acgState = freshAcgState(pathway);
  return c;
}

// ---------------------------------------------------------------------------
// setCombatArm — fires only when pathway === "mercenary" (schools.ts:116).
// Mercenary "Commando School" sets the combat arm to Commando, then rolls the
// 5+ skill batch. Lock: the arm becomes Commando and the batch fires.
// ---------------------------------------------------------------------------

describe("setCombatArm leaf: mercenary Commando School", () => {
  it("sets combatArm to Commando and grants the 5+ (1D) skill batch", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    assertPathway(acg, "mercenary");
    acg.combatArm = "Infantry";
    acg.branch = "Army";
    // Every 1D = 6 (>= throwTarget 5) so the whole batch lands at level 1.
    vi.spyOn(Math, "random").mockReturnValue(d6(6));

    applySpecialAssignment(c, "mercenary", "Commando School");

    // The pathway-specific leaf: the arm is reassigned to Commando.
    expect(acg.combatArm).toBe("Commando");
    // Teeth for the downstream 5+ batch: Demolitions/Stealth (target 5) landed.
    expect(skillLevel(c, "Demolitions")).toBe(1);
    expect(skillLevel(c, "Stealth")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// crossTrainCombatArm — fires only when pathway === "mercenary"
// (schools.ts:118-139). Picks a NEW combat arm (excluding Commando, the current
// arm, and previously cross-trained arms), records eligibility, logs
// ev.crossTrained. Lock the picked arm + the recorded eligibility + the event.
// ---------------------------------------------------------------------------

describe("crossTrainCombatArm leaf: mercenary Cross-Training", () => {
  it("switches combatArm and records cross-training eligibility", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    assertPathway(acg, "mercenary");
    acg.combatArm = "Infantry"; // excluded as the current arm
    acg.branch = "Army";
    // Candidates after filter (combatArms minus Commando minus Infantry) are
    // [Artillery, Cavalry, Support]; pick index = floor(0.5 * 3) = 1 -> Cavalry.
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    applySpecialAssignment(c, "mercenary", "Cross-Training");

    expect(acg.combatArm).toBe("Cavalry");
    expect(acg.crossTrainedArms).toEqual(["Cavalry"]);
    expect(
      c.events.some(
        (e) => e.kind === "crossTrained"
          && e.destination === "Cavalry" && e.kind_ === "combatArm",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// crossTrainBranch — fires for pathway "mercenary" OR "navy" (schools.ts:140).
// Records branch-change ELIGIBILITY for the next reenlistment; it does NOT
// change the current branch. Lock: branch unchanged, eligibility recorded,
// event logged. (Exercised via navy Cross-Training.)
// ---------------------------------------------------------------------------

describe("crossTrainBranch leaf: navy Cross-Training", () => {
  it("records a cross-trained branch WITHOUT changing the current branch", () => {
    const c = acgChar("navy");
    const acg = c.acgState!;
    assertPathway(acg, "navy");
    acg.branch = "Line";
    // opts = branches minus current = [Flight, Gunnery, Engineering, Medical,
    // Technical]; pick index = floor(0.5 * 5) = 2 -> Engineering.
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    applySpecialAssignment(c, "navy", "Cross-Training");

    // Current branch is NOT transferred — only eligibility is recorded.
    expect(acg.branch).toBe("Line");
    expect(acg.crossTrainedBranches).toEqual(["Engineering"]);
    expect(
      c.events.some(
        (e) => e.kind === "crossTrained"
          && e.destination === "Engineering" && e.kind_ === "branch",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ocsCommission — mercenary tiers (schools.ts:304-339). The tier table maps the
// enlisted rank to an officer rank: E7->O2, {E8,E9}->O3 (no skills, senior
// rank), everything else -> defaultToRank O1. The NAVY tier and the drafted-
// first-term denial are locked elsewhere (see header); these two mercenary
// tiers are the gap.
// ---------------------------------------------------------------------------

describe("ocsCommission leaf: mercenary rank tiers", () => {
  it("default tier: E5 sergeant commissions to O1", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    assertPathway(acg, "mercenary");
    acg.rankCode = "E5";
    acg.isOfficer = false;
    acg.combatArm = "Infantry"; // required by the post-commission MOS roll
    acg.branch = "Army";
    vi.spyOn(Math, "random").mockReturnValue(d6(6));

    applySpecialAssignment(c, "mercenary", "OCS");

    expect(acg.isOfficer).toBe(true);
    expect(acg.rankCode).toBe("O1");
    expect(
      c.events.some((e) => e.kind === "promoted" && e.source === "OCS"),
    ).toBe(true);
  });

  it("senior tier: E8 first sergeant commissions to O3 (no-skills reason)", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    assertPathway(acg, "mercenary");
    acg.rankCode = "E8";
    acg.isOfficer = false;
    acg.combatArm = "Infantry";
    acg.branch = "Army";
    vi.spyOn(Math, "random").mockReturnValue(d6(6));

    applySpecialAssignment(c, "mercenary", "OCS");

    expect(acg.isOfficer).toBe(true);
    expect(acg.rankCode).toBe("O3");
    expect(
      c.events.some(
        (e) => e.kind === "promoted"
          && e.source === "OCS (no skills, senior rank)",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// attacheOrAide — label depends on pathway ("Military Attache" for mercenary,
// "Naval Attache" for navy; schools.ts:363). On 1D <= promoteOnRollAtMost (4)
// the officer advances one rank; the +1 Social bonus applies EITHER way.
// ---------------------------------------------------------------------------

describe("attacheOrAide leaf: label + promote + social bonus", () => {
  it("mercenary Attache/Aide: 1D<=4 promotes O1->O2 as 'Military Attache', +1 Social", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    assertPathway(acg, "mercenary");
    acg.rankCode = "O1";
    acg.isOfficer = true;
    acg.branch = "Army";
    expect(c.attributes.social).toBe(7);
    vi.spyOn(Math, "random").mockReturnValue(d6(3)); // 1D = 3 <= 4 -> promote

    applySpecialAssignment(c, "mercenary", "Attache/Aide");

    expect(acg.rankCode).toBe("O2");
    expect(c.attributes.social).toBe(8);
    expect(
      c.events.some(
        (e) => e.kind === "promoted"
          && e.rank === "First Lieutenant" && e.source === "Military Attache",
      ),
    ).toBe(true);
  });

  it("mercenary Attache/Aide: 1D>4 does NOT promote but still grants +1 Social", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    assertPathway(acg, "mercenary");
    acg.rankCode = "O1";
    acg.isOfficer = true;
    acg.branch = "Army";
    vi.spyOn(Math, "random").mockReturnValue(d6(6)); // 1D = 6 > 4 -> no promote

    applySpecialAssignment(c, "mercenary", "Attache/Aide");

    expect(acg.rankCode).toBe("O1");
    expect(c.attributes.social).toBe(8);
    expect(c.events.filter((e) => e.kind === "promoted")).toHaveLength(0);
  });

  it("navy Naval Attache: 1D<=4 promotes O1->O2 as 'Naval Attache', +1 Social", () => {
    const c = acgChar("navy");
    const acg = c.acgState!;
    assertPathway(acg, "navy");
    acg.rankCode = "O1";
    acg.isOfficer = true;
    acg.branch = "Line";
    vi.spyOn(Math, "random").mockReturnValue(d6(3)); // 1D = 3 <= 4 -> promote

    applySpecialAssignment(c, "navy", "Naval Attache");

    expect(acg.rankCode).toBe("O2");
    expect(c.attributes.social).toBe(8);
    expect(
      c.events.some(
        (e) => e.kind === "promoted"
          && e.rank === "Sublieutenant" && e.source === "Naval Attache",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyScoutSchool — two variants (schools.ts:436-481): a promotesToRank school
// (Admin School -> IS-10 + officer status) and a skill-award school (Ship School
// -> two 1D rolls on the schools table's shipSchool column).
// ---------------------------------------------------------------------------

describe("applyScoutSchool: promote-to-rank vs skill-award variants", () => {
  it("Admin School (bureaucracy division) promotes to IS-10 and confers officer status", () => {
    const c = acgChar("scout");
    const acg = c.acgState!;
    assertPathway(acg, "scout");
    acg.division = "bureaucracy"; // Admin School requiresDivision
    acg.rankCode = "E1";          // does not match ^IS-1\d$ -> promotes
    vi.spyOn(Math, "random").mockReturnValue(d6(1));

    applyScoutSchool(c, "Admin School");

    expect(acg.isOfficer).toBe(true);
    expect(acg.rankCode).toBe("IS-10");
    expect(acg.schoolsAttended).toContain("Admin School");
    expect(
      c.events.some(
        (e) => e.kind === "promoted"
          && e.rank === "IS-10" && e.source === "Admin School",
      ),
    ).toBe(true);
  });

  it("Ship School awards two 1D rolls on the shipSchool column (die 1 -> Pilot x2)", () => {
    const c = acgChar("scout");
    const acg = c.acgState!;
    assertPathway(acg, "scout");
    // Every 1D = 1 -> schools table die-1 shipSchool cell = "Pilot", rolled
    // twice (rollsPerAttendance: 2) -> Pilot level 2.
    vi.spyOn(Math, "random").mockReturnValue(d6(1));

    applyScoutSchool(c, "Ship School");

    expect(acg.schoolsAttended).toContain("Ship School");
    expect(skillLevel(c, "Pilot")).toBe(2);
    // Skill-award variant does NOT promote or confer officer status.
    expect(acg.isOfficer).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pre-career walk: the commissioned-college-honors -> Flight School AUTO-ADMIT
// branch (preCareer.ts autoAdmit gate `honorsWithCommission: ["college"]`).
// The Naval-Academy-honors path is locked in preCareer.test.ts; the college
// path (a different OR-clause of evalPreCareerGate) is the gap. Teeth: the
// auto-admit branch skips the admission roll, so NO "Flight School admission"
// roll event is emitted.
// ---------------------------------------------------------------------------

describe("pre-career chain: commissioned college honors -> Flight School auto-admit", () => {
  it("auto-admits (no admission roll) and graduates with the flight skills", () => {
    const c = acgChar("mercenary");
    const acg = c.acgState!;
    // A commissioned college honors graduate (the state college OTC leaves).
    acg.schoolsAttended = ["college"];
    acg.honorsGraduations = ["college"];
    acg.preCareerCommission = true;
    c.attributes.dexterity = 12;   // help the (unused) admission DM path
    c.attributes.intelligence = 12; // success-roll DM
    vi.spyOn(Math, "random").mockReturnValue(0.999); // all rolls pass

    const r = c.doPreCareer("flightSchool");

    expect(r.admitted).toBe(true);
    expect(r.graduated).toBe(true);
    // Auto-admit skips the admission throw entirely — teeth for the college
    // clause of the autoAdmit gate.
    expect(
      c.events.some(
        (e) => e.kind === "roll" && e.rollName === "Flight School admission",
      ),
    ).toBe(false);
    // Flight School's skill grants landed on graduation.
    expect(skillLevel(c, "Ship's Boat")).toBe(1);
    expect(skillLevel(c, "Pilot")).toBeGreaterThanOrEqual(1);
  });
});
