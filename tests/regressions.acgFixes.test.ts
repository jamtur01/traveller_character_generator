// Regression tests for the ACG (Advanced Character Generation) behavioral
// fixes A3/A4/A5 (commit 4fe5776 "Fix chargen bugs and migrate hardcoded
// rules to edition JSON") and C1/C2/C3/C4 (commit 6469eaf "Fix ACG logic
// bugs (court-martial, Frozen Watch, scout/merchant skills)"). Each describe
// block names the fix ID, the observable contract it defends, and — inline —
// the pre-fix behavior the assertion catches (the "teeth").
//
// Determinism: Math.random is pinned via d6(v), which returns the uniform
// draw that makes Rng.roll(1) yield die `v` (roll(2) yields 2v). Constructing
// `new Character({ attributes })` bypasses the 12 attribute rolls. Every
// state is built directly with freshAcgState + the require*Acg accessors so
// the roll under test is the only source of randomness.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { requireAcgPathway } from "../lib/traveller";
import { freshAcgState, type AcgPathwayId } from "../lib/traveller/engine/acg/state";
import { runCourtMartial } from "../lib/traveller/engine/acg/awards";
import { navyResolveAssignment } from "../lib/traveller/engine/acg/pathways/navy";
import { scoutResolveAssignment } from "../lib/traveller/engine/acg/pathways/scout";
import { merchantResolveAssignment } from "../lib/traveller/engine/acg/pathways/merchantPrince";
import { mercenaryResolveAssignment } from "../lib/traveller/engine/acg/pathways/mercenary";
import { applySpecialAssignment } from "../lib/traveller/engine/acg/schools";
import { rollSkillFromColumn } from "../lib/traveller/engine/acg/pathways/shared";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Math.random value that makes Rng.roll(1) return die `v` (1-6):
 *  floor(d6(v) * 6 + 1) === v, and roll(2) === 2v. */
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

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
  // Mirror enlistment.ts's pathway->service mapping: production ACG always
  // assigns a real edition service before any term (and thus any doAging)
  // runs, and strict JSON reads reject the pre-enlistment "other" default.
  c.service = ({
    mercenary: "army", navy: "navy", scout: "scouts", merchantPrince: "merchants",
  } as const)[pathway];
  c.acgState = freshAcgState(pathway);
  return c;
}

const skillLevel = (c: Character, name: string): number =>
  c.skills.find(([n]) => n === name)?.[1] ?? 0;

// ---------------------------------------------------------------------------
// A3 — pre-fix the navy pathway had no skillColumnPolicy, so an OCS grad's
// service-skill roll resolved its column via serviceSkillColumnFor's default
// ("staffSkills"/"commandSkills"), which is NOT a column in the navy
// serviceSkills table — every cell read missed and the grad banked 0 skills.
// Fix (4fe5776): navy.skillColumnPolicy maps officerStaff -> "staffOfficer",
// so an OCS grad's two Service Skill rolls land on a real column.
// ---------------------------------------------------------------------------

describe("A3: navy OCS grads receive their 2 service skills (not 0)", () => {
  it("E7 OCS grad rolls 2 service skills from the staffOfficer column", () => {
    // Every 1D roll -> die 6. staffOfficer[6] = "Ship Tactics" (O2 OCS grad,
    // no rank DM), taken twice -> level 2. The branch-skill roll lands on
    // lineCrew[8]="Vacc Suit" (imperialNavy +2 DM), so it never collides.
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("navy");
    c.requireNavyAcg().branch = "Line";
    c.acgState!.rankCode = "E7";
    c.acgState!.isOfficer = false;

    applySpecialAssignment(c, "navy", "OCS");

    // OCS commissioned the E7 to O2...
    expect(c.acgState!.isOfficer).toBe(true);
    expect(c.acgState!.rankCode).toBe("O2");
    // ...and the two Service Skill rolls both landed (staffOfficer[6]).
    // Teeth: pre-fix the column resolved to "staffSkills" (absent from the
    // navy table) -> 0 service skills -> Ship Tactics would be 0.
    expect(skillLevel(c, "Ship Tactics")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// A4 — a Marine's Counterinsurgency/Internal Security assignment reroutes to
// "Ship's Troops" (PM p. 48). Pre-fix labelToColumnKey split on the
// apostrophe, yielding "shipSTroops", which is not a resolution column — so
// the assignment fell through to the garrison-style escape: automatic
// survival, no combat resolution, no rewards. Fix (4fe5776): labelToColumnKey
// strips apostrophes -> "shipsTroops", the real combat-resolution column.
// ---------------------------------------------------------------------------

describe("A4: Marine Ship's Troops gets real combat resolution (not garrison escape)", () => {
  it("resolves the shipsTroops column: survival roll fires and a Combat Ribbon is earned", () => {
    // Ship's Troops is a mercenary combat assignment, so a resolved (non-
    // garrison) run awards a Combat Ribbon via combatFinalize. Constant die 6
    // -> 2D=12 passes survival (4+), promotion (6+), skills (6+).
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("mercenary");
    const m = c.requireMercenaryAcg();
    m.branch = "Marines";
    m.combatArm = "Infantry";
    c.acgState!.rankCode = "E2";
    c.acgState!.currentAssignment = "Ship's Troops";

    mercenaryResolveAssignment(c, "Ship's Troops");

    // Real resolution ran: a Survival roll was recorded...
    const survivalRolls = c.events.filter(
      (e) => e.kind === "roll" && e.rollName === "Survival",
    );
    expect(survivalRolls.length).toBe(1);
    // ...a skill was earned from the shipboard column...
    expect(skillLevel(c, "Vacc Suit")).toBeGreaterThanOrEqual(1);
    // ...and the combat assignment awarded a Combat Ribbon.
    // Teeth: pre-fix "shipSTroops" missed every column -> garrison escape ->
    // no Survival roll, no skill, combatRibbons stays 0.
    expect(c.requireMercenaryAcg().combatRibbons).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A5 — skill-table columns print per-column DMs ("DM +4 for O7+"); without
// applying them a 1D roll tops out at die 6, so the die 7-10 rows are
// unreachable. Pre-fix the navy service-skill roll was a bare roll(1). Fix
// (4fe5776): the roll adds columnDmFor(table.dms, column, ch) before
// clamping to [1, maxDie], so a high-rank officer reaches the high rows.
// navyServiceSkillRoll delegates to the exported rollSkillFromColumn (this
// helper), which is the exact call site.
// ---------------------------------------------------------------------------

describe("A5: column DMs let an O7+ navy service-skill roll reach die 7-10 rows", () => {
  it("O7 staffOfficer roll reaches die 10 (Fleet Tactics)", () => {
    // staffOfficer DMs: O4+ (+2) and O7+ (+2) -> +4 at O7. Base die 6 + 4 = 10
    // -> staffOfficer[10] = "Fleet Tactics". Fleet Tactics appears only in the
    // die 7-10 rows of that column.
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("navy");
    c.requireNavyAcg().branch = "Line";
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "O7";

    const navy = requireAcgPathway("mt-megatraveller", "navy") as {
      serviceSkills: Parameters<typeof rollSkillFromColumn>[1];
    };
    rollSkillFromColumn(c, navy.serviceSkills, "staffOfficer", "Navy staffOfficer");

    // Teeth: pre-fix bare roll(1) tops out at die 6 -> staffOfficer[6]="Ship
    // Tactics"; "Fleet Tactics" is unreachable without the +4 column DM.
    expect(skillLevel(c, "Fleet Tactics")).toBe(1);
    expect(skillLevel(c, "Ship Tactics")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C1 — a court-martial result composes several effects. Pre-fix the applier
// returned after the FIRST matching branch, so combined results dropped an
// effect: result 4 ("Jail 2D months; reduce rank -2") applied the rank
// reduction but skipped the jail sentence; results 5-7 ("Jail ND years;
// dishonorable discharge") applied the discharge but skipped the jail-years
// aging. Fix (6469eaf): effects apply in turn, then the terminal disposition
// resolves once.
// ---------------------------------------------------------------------------

describe("C1: court-martial applies combined disciplinary effects", () => {
  it("result 4 = rank reduction AND jail-months (no discharge)", () => {
    // Enlisted (E4) => auto-guilty, so the officer guilt roll is skipped and
    // the first (only) 1D roll is the result roll. d6(4) -> result 4.
    vi.spyOn(Math, "random").mockReturnValue(d6(4));
    const c = acgChar("mercenary");
    c.acgState!.rankCode = "E4";
    c.acgState!.isOfficer = false;
    c.acgState!.browniePoints = 0; // no auto-mitigation
    c.age = 30;

    runCourtMartial(c);

    // Rank reduced E4 -> E2 (reduce rank -2).
    expect(c.acgState!.rankCode).toBe("E2");
    // Jail-months sentence logged. Teeth: pre-fix the reduce-rank branch
    // returned first, so no "jailed" statusChange was ever emitted.
    const jailed = c.events.filter(
      (e) => e.kind === "statusChange" && e.kind_ === "jailed",
    );
    expect(jailed.length).toBe(1);
    // Jail-months neither ends chargen nor forfeits the pension.
    expect(c.isChargenEnded).toBe(false);
    expect(c.acgState!.pensionForfeit ?? false).toBe(false);
  });

  it("result 5 = dishonorable discharge AND jail-years aging + forced muster-out", () => {
    // d6(5) -> result roll 5 = "Jail 1D years; dishonorable discharge", then
    // the jail-years 1D roll (same pin) = 5 -> age 30 + 5 = 35.
    vi.spyOn(Math, "random").mockReturnValue(d6(5));
    const c = acgChar("mercenary");
    c.acgState!.rankCode = "E4";
    c.acgState!.isOfficer = false;
    c.acgState!.browniePoints = 0;
    c.age = 30;

    runCourtMartial(c);

    // Dishonorable discharge flags.
    expect(c.acgState!.pensionForfeit).toBe(true);
    expect(c.acgState!.musterRollPenalty).toBe(-3);
    // Forced muster-out (as a discharge, not a pensioned retirement).
    expect(c.isChargenEnded).toBe(true);
    expect(c.retired).toBe(false);
    // Jail-years aging applied. Teeth: pre-fix the dishonorable branch
    // returned before the jail branch, so age stayed 30.
    expect(c.age).toBe(35);
  });
});

// ---------------------------------------------------------------------------
// C2 — a Navy Frozen Watch year is spent in cold sleep: the character ages
// chronologically but not physically (PM p. 56). Pre-fix doAging set apparent
// age to chronological age and drove the aging saving throws off chronological
// terms. Fix (6469eaf): each Frozen Watch year accumulates AcgState
// .physicalAgeOffset (<= 0); doAging drives the aging basis off physical age
// (chronological + offset) and sets apparent age behind chronological.
// ---------------------------------------------------------------------------

describe("C2: Frozen Watch advances chronological age but not physical age", () => {
  it("cold-sleep years pull apparent (physical) age behind chronological age", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // aging saves all pass
    const c = acgChar("navy");
    // Enlistment is skipped in this fixture; set the branch it would set.
    c.requireNavyAcg().branch = "Line";
    c.age = 50;

    // Eight one-year Frozen Watch assignments (two four-year cold-sleep
    // terms). Each accumulates physicalAgeOffset -1 (the special-rule branch
    // rolls no dice).
    for (let i = 0; i < 8; i++) navyResolveAssignment(c, "Frozen Watch");
    expect(c.requireNavyAcg().physicalAgeOffset).toBe(-8);

    c.doAging();

    // Chronological age is untouched; physical (apparent) age trails it by
    // the eight cold-sleep years. Teeth: pre-fix apparentAge = age (50) with
    // no offset, and the aging basis used chronological terms.
    expect(c.age).toBe(50);
    expect(c.apparentAge).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// C3 — a Scout officer's promotion grants a skill from the administrator-rank
// column. Pre-fix promoteScout read column "administratorRank", which is not
// a column in the bureaucracy skill table, so it silently fell back to the
// office skill roll (the first/"admin" column). Fix (6469eaf): it reads the
// real "adminRank" column.
// ---------------------------------------------------------------------------

describe("C3: scout officer promotion draws from the adminRank column", () => {
  it("a promoted administrator gets the adminRank cell, not the office admin cell", () => {
    // Bureaucracy officer, office Administration, IS-13. Constant die 6 ->
    // 2D=12 passes promotion (7+) and skills (7+); survival is auto. The
    // promotion advances IS-13 -> IS-14, then rolls adminRank: die 6 + 4 DM
    // (IS-13+) = 10 -> adminRank[10]="+1 Social" -> social 9 -> 10. The
    // separate skills phase rolls admin[10]="Academic".
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("scout");
    const s = c.requireScoutAcg();
    s.division = "bureaucracy";
    s.office = "Administration";
    c.acgState!.isOfficer = true;
    c.acgState!.rankCode = "IS-13";

    scoutResolveAssignment(c, "Routine");

    expect(c.acgState!.rankCode).toBe("IS-14");
    // adminRank[10] = "+1 Social" applied. Teeth: pre-fix the promotion skill
    // fell back to the admin column (admin[10]="Academic"), leaving social 9.
    expect(c.attributes.social).toBe(10);
    // The office skills phase still rolls the admin column.
    expect(skillLevel(c, "Academic")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C4 — a merchant's department skill roll must take the column for the
// character's department (PM p. 63). Pre-fix the roll always took the first
// non-die column ("deck"), so a Purser got Deck skills. Fix (6469eaf):
// skillTables.*.columnAvailability filters columns to the department, so a
// Purser rolls the "purser" column.
// ---------------------------------------------------------------------------

describe("C4: Purser merchant rolls the purser column, not deck", () => {
  it("a Purser's department skill roll takes purser[6], not deck[6]", () => {
    // Enlisted Purser (skips the officer available-position check). year 2 ->
    // the year round-robin selects the department table (available tables are
    // [service, department]; life is filtered out). purser is the first
    // department-available column. Constant die 6: survival auto, skills 6+
    // passes (2D=12), department roll die 6 -> purser[6]="Liaison".
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("merchantPrince");
    const m = c.requireMerchantAcg();
    m.department = "Purser";
    m.lineType = "Sector-wide";
    c.acgState!.rankCode = "E1";
    c.acgState!.isOfficer = false;
    c.acgState!.year = 2;

    merchantResolveAssignment(c, "Route");

    // Teeth: pre-fix always took the first column (deck[6]="Leader").
    expect(skillLevel(c, "Liaison")).toBe(1);
    expect(skillLevel(c, "Leader")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rules-lock fix — garrison resolution now routes through the JSON-declared
// assignmentResolution.garrisonDuty row (PM p. 49): survival automatic, no
// decoration or skills, enlisted promotion on 7+. Pre-fix the code hardcoded
// "automatic survival, no rewards" and DROPPED the enlisted 7+ promotion
// throw entirely.
// ---------------------------------------------------------------------------

describe("garrison duty resolves via assignmentResolution.garrisonDuty (PM p. 49)", () => {
  it("an enlisted mercenary on Garrison rolls the 7+ promotion throw and advances", () => {
    // Constant die 6 -> 2D=12 >= 7: promotion passes. E1 -> E2.
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("mercenary");
    const m = c.requireMercenaryAcg();
    m.branch = "Army";
    m.combatArm = "Infantry";
    c.acgState!.rankCode = "E1";
    c.acgState!.currentAssignment = "Garrison";

    mercenaryResolveAssignment(c, "Garrison");

    // Teeth: pre-fix garrison skipped resolution entirely — no Promotion
    // roll fired and the rank stayed E1 forever on garrison years.
    expect(c.acgState!.rankCode).toBe("E2");
    const promoRolls = c.events.filter(
      (e) => e.kind === "roll" && e.rollName === "Promotion",
    );
    expect(promoRolls.length).toBe(1);
    // No decoration and no skill can be earned on garrison duty.
    expect(c.acgState!.decorations.length).toBe(0);
    expect(c.skills.length).toBe(0);
    // The year is still recorded in the assignment history.
    expect(c.acgState!.assignmentHistory).toContain("Garrison");
  });

  it("a failed 7+ throw (2D=6) leaves the rank unchanged", () => {
    vi.spyOn(Math, "random").mockReturnValue(d6(3));
    const c = acgChar("mercenary");
    const m = c.requireMercenaryAcg();
    m.branch = "Army";
    m.combatArm = "Infantry";
    c.acgState!.rankCode = "E1";
    c.acgState!.currentAssignment = "Garrison";

    mercenaryResolveAssignment(c, "Garrison");

    expect(c.acgState!.rankCode).toBe("E1");
  });

  it("officers do not roll the enlisted-only garrison promotion", () => {
    vi.spyOn(Math, "random").mockReturnValue(d6(6));
    const c = acgChar("mercenary");
    const m = c.requireMercenaryAcg();
    m.branch = "Army";
    m.combatArm = "Infantry";
    c.acgState!.rankCode = "O1";
    c.acgState!.isOfficer = true;
    c.acgState!.currentAssignment = "Garrison";

    mercenaryResolveAssignment(c, "Garrison");

    expect(c.acgState!.rankCode).toBe("O1");
    const promoRolls = c.events.filter(
      (e) => e.kind === "roll" && e.rollName === "Promotion",
    );
    expect(promoRolls.length).toBe(0);
  });
});
