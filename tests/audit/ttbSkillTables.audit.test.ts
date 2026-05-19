// CT TTB skill-table audit (TTB p. 25 Acquired Skills tables).
// Focuses on Advanced Education (table 3) and Advanced Education 8+
// (table 4) which receive less coverage in
// tests/audit/ct.services.skills.audit.test.ts.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

function svc(name: string) {
  const svcs = getEdition("ct-classic").data.services as
    Record<string, { skillTables?: Record<string, (string | null)[]> }>;
  return svcs[name]?.skillTables ?? {};
}

describe("CT Advanced Education tables (TTB p. 25 table 3)", () => {
  it("Navy: Vacc Suit / Mechanical / Electronic / Engineering / Gunnery / Jack-o-T", () => {
    expect(svc("navy").advancedEducation).toEqual([
      null, "Vacc Suit", "Mechanical", "Electronic",
      "Engineering", "Gunnery", "Jack-o-T",
    ]);
  });

  it("Marines: Vehicle / Mechanical / Electronic / Tactics / Blade Cbt / Gun Cbt", () => {
    expect(svc("marines").advancedEducation).toEqual([
      null, "Vehicle", "Mechanical", "Electronic",
      "Tactics", "Blade Cbt", "Gun Cbt",
    ]);
  });

  it("Army: Vehicle / Mechanical / Electronic / Tactics / Blade Cbt / Gun Cbt", () => {
    expect(svc("army").advancedEducation).toEqual([
      null, "Vehicle", "Mechanical", "Electronic",
      "Tactics", "Blade Cbt", "Gun Cbt",
    ]);
  });

  it("Scouts: Vehicle / Mechanical / Electronic / Jack-o-T / Gunnery / Medical", () => {
    expect(svc("scouts").advancedEducation).toEqual([
      null, "Vehicle", "Mechanical", "Electronic",
      "Jack-o-T", "Gunnery", "Medical",
    ]);
  });

  it("Merchants: Streetwise / Mechanical / Electronic / Navigation / Gunnery / Medical", () => {
    expect(svc("merchants").advancedEducation).toEqual([
      null, "Streetwise", "Mechanical", "Electronic",
      "Navigation", "Gunnery", "Medical",
    ]);
  });

  it("Other: Streetwise / Mechanical / Electronic / Gambling / Brawling / Forgery", () => {
    expect(svc("other").advancedEducation).toEqual([
      null, "Streetwise", "Mechanical", "Electronic",
      "Gambling", "Brawling", "Forgery",
    ]);
  });
});

describe("CT Advanced Education 8+ tables (TTB p. 25 table 4)", () => {
  it("Navy: Medical / Navigation / Engineering / Computer / Pilot / Admin", () => {
    expect(svc("navy").advancedEducation8Plus).toEqual([
      null, "Medical", "Navigation", "Engineering",
      "Computer", "Pilot", "Admin",
    ]);
  });

  it("Marines: Medical / Tactics / Tactics / Computer / Leader / Admin", () => {
    expect(svc("marines").advancedEducation8Plus).toEqual([
      null, "Medical", "Tactics", "Tactics",
      "Computer", "Leader", "Admin",
    ]);
  });

  it("Army: Medical / Tactics / Tactics / Computer / Leader / Admin", () => {
    expect(svc("army").advancedEducation8Plus).toEqual([
      null, "Medical", "Tactics", "Tactics",
      "Computer", "Leader", "Admin",
    ]);
  });

  it("Scouts: Medical / Navigation / Engineering / Computer / Pilot / Jack-o-T", () => {
    expect(svc("scouts").advancedEducation8Plus).toEqual([
      null, "Medical", "Navigation", "Engineering",
      "Computer", "Pilot", "Jack-o-T",
    ]);
  });

  it("Merchants: Medical / Navigation / Engineering / Computer / Pilot / Admin", () => {
    expect(svc("merchants").advancedEducation8Plus).toEqual([
      null, "Medical", "Navigation", "Engineering",
      "Computer", "Pilot", "Admin",
    ]);
  });

  it("Other: Medical / Forgery / Electronics / Computer / Streetwise / Jack-o-T", () => {
    // TTB Adv Ed 8+ table prints "Electronics" (with the trailing s)
    // for Other column. The engine normalizes via skillLabelRenames
    // ("Electronics" → "Electronic") at runtime; the JSON faithfully
    // copies the TTB cell.
    expect(svc("other").advancedEducation8Plus).toEqual([
      null, "Medical", "Forgery", "Electronics",
      "Computer", "Streetwise", "Jack-o-T",
    ]);
  });
});

describe("CT Personal Development tables (TTB p. 25 table 1)", () => {
  it("Navy: +1 Stren / Dext / Endur / Intel / Educ / Social", () => {
    expect(svc("navy").personalDevelopment).toEqual([
      null, "+1 Stren", "+1 Dext", "+1 Endur",
      "+1 Intel", "+1 Educ", "+1 Social",
    ]);
  });

  it("Marines: +1 Stren / Dext / Endur / Gambling / Brawling / Blade Cbt", () => {
    expect(svc("marines").personalDevelopment).toEqual([
      null, "+1 Stren", "+1 Dext", "+1 Endur",
      "Gambling", "Brawling", "Blade Cbt",
    ]);
  });

  it("Other: +1 Stren / Dext / Endur / Blade Cbt / Brawling / -1 Social", () => {
    expect(svc("other").personalDevelopment).toEqual([
      null, "+1 Stren", "+1 Dext", "+1 Endur",
      "Blade Cbt", "Brawling", "-1 Social",
    ]);
  });
});
