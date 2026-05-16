// Cell-by-cell validation of mt-megatraveller.json against the MegaTraveller
// Players' Manual. Each assertion encodes a verbatim fact from the manual
// (cited by page) so the JSON cannot silently drift from the source.
//
// When a test fails, the JSON is wrong — re-check the manual page in the
// assertion, then fix the JSON. Do not "fix" the test by changing the
// asserted value unless you have the manual in front of you.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const json = JSON.parse(
  readFileSync(
    resolve(__dirname, "../data/editions/mt-megatraveller.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const acg = (json.advancedCharacterGeneration ?? {}) as Record<string, unknown>;
const common = (acg.common ?? {}) as Record<string, unknown>;
const mercenary = (acg.mercenary ?? {}) as Record<string, unknown>;
const navy = (acg.navy ?? {}) as Record<string, unknown>;

function getSpec<T = Record<string, unknown>>(
  bag: Record<string, unknown>,
  path: string[],
): T {
  let cur: unknown = bag;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as object)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      throw new Error(`Missing JSON path: ${path.join(".")}`);
    }
  }
  return cur as T;
}

describe("MT Players' Manual p. 47 — pre-career options", () => {
  it("Naval Academy: 4+ on 1D for Vacc Suit, Navigation, Engineering", () => {
    const sk = getSpec(common, ["preCareerOptions", "navalAcademy", "skills"]) as {
      throw: string; skills: string[];
    };
    expect(sk.throw).toMatch(/4\+/);
    expect(sk.skills).toEqual(["Vacc Suit", "Navigation", "Engineering"]);
  });

  it("Military Academy: automatic Combat Rifleman + 4+ for 6 skills", () => {
    const auto = getSpec<string[]>(common, [
      "preCareerOptions", "militaryAcademy", "automaticSkills",
    ]);
    expect(auto).toEqual(["Combat Rifleman"]);
    const sk = getSpec(common, ["preCareerOptions", "militaryAcademy", "skills"]) as {
      throw: string; skills: string[];
    };
    expect(sk.throw).toMatch(/4\+/);
    expect(sk.skills).toEqual([
      "Tactics", "Leader", "Admin",
      "Heavy Weapons", "Forward Observer", "Computer",
    ]);
  });

  it("Merchant Academy: select one department and throw for three department skills", () => {
    const sk = getSpec(common, ["preCareerOptions", "merchantAcademy", "skills"]) as {
      rule: string;
    };
    expect(sk.rule).toMatch(/department/i);
    expect(sk.rule).toMatch(/three/i);
  });

  it("Medical School: automatic +1 Edu, Medical-3, Admin; honors adds Medical + Computer", () => {
    const auto = getSpec<string[]>(common, [
      "preCareerOptions", "medicalSchool", "automaticSkills",
    ]);
    expect(auto).toEqual(["+1 Education", "Medical-3", "Admin"]);
    const hon = getSpec<string[]>(common, [
      "preCareerOptions", "medicalSchool", "honorsSkills",
    ]);
    expect(hon).toEqual(["Medical", "Computer"]);
  });

  it("Flight School: Ship's Boat, Navigation, 1D-3 (min 1) Pilot", () => {
    const sk = getSpec<string[]>(common, [
      "preCareerOptions", "flightSchool", "skills",
    ]);
    expect(sk).toContain("Ship's Boat");
    expect(sk).toContain("Navigation");
    expect(sk.some((s) => /1D-3|Pilot/.test(s))).toBe(true);
  });
});

describe("MT Players' Manual p. 47 — Brownie point awards", () => {
  const awards = getSpec<Array<{ event: string; points: number }>>(common, [
    "browniePoints", "awards",
  ]);
  const byEvent = (e: string) =>
    awards.find((a) => a.event.toLowerCase().includes(e.toLowerCase()))?.points;

  it("Term completion = 1", () => expect(byEvent("4-year term")).toBe(1));
  it("College graduation = 1", () => expect(byEvent("Graduation from College")).toBe(1));
  it("Service Academy = 1", () => expect(byEvent("Service Academy")).toBe(1));
  it("Medical School = 1", () => expect(byEvent("Medical School")).toBe(1));
  it("Flight School = 1", () => expect(byEvent("Flight School")).toBe(1));
  it("Honors = 1", () => expect(byEvent("Honors")).toBe(1));
  it("Special assignment = 1", () => expect(byEvent("Special assignment")).toBe(1));
  it("MCUF = 1", () => expect(byEvent("MCUF")).toBe(1));
  it("MCG = 2", () => expect(byEvent("MCG")).toBe(2));
  it("SEH = 3", () => expect(byEvent("SEH")).toBe(3));
  it("Purple Heart = 0", () => expect(byEvent("Purple Heart")).toBe(0));
});

describe("MT Players' Manual p. 47 — Court martial", () => {
  it("Triggered when decoration roll fails by 6+", () => {
    const t = getSpec<{ rule: string }>(common, ["courtMartial", "trigger"]);
    expect(t.rule).toMatch(/6 or more|by six/i);
  });

  it("Enlisted automatically guilty; officers throw 10+ (DM +1 per Admin level)", () => {
    const g = getSpec<{
      enlisted: string;
      officer: { avoidTarget: number; dms: Array<{ skill: string; dm: number }> };
    }>(common, ["courtMartial", "guilt"]);
    expect(g.enlisted).toMatch(/guilty/i);
    expect(g.officer.avoidTarget).toBe(10);
    const adminDm = g.officer.dms.find((d) => d.skill === "Admin");
    expect(adminDm?.dm).toBe(1);
  });

  it("Result rolled on 1D with DMs per manual", () => {
    const r = getSpec<{ die: string; dms: Array<{ condition: string; dm: number }> }>(
      common, ["courtMartial", "resultRoll"]);
    expect(r.die).toBe("1D");
    const want: Array<[RegExp, number]> = [
      [/E7 to E9/, 1],
      [/combat assignment/i, 2],
      [/training/i, -2],
      [/O7\+/, -1],
      [/command duty/i, 2],
    ];
    for (const [re, dm] of want) {
      const found = r.dms.find((d) => re.test(d.condition));
      expect(found?.dm).toBe(dm);
    }
  });
});

describe("MT Players' Manual p. 51 — Mercenary special assignment details", () => {
  const details = getSpec<Record<string, {
    summary: string;
    effects: Array<Record<string, unknown>>;
    ageLimit?: number;
  }>>(mercenary, ["specialAssignmentDetails"]);

  it("Cross-Training: any combat arm except Commando, roll on MOS table", () => {
    const d = details["Cross-Training"]!;
    const cross = d.effects.find((e) => e.type === "crossTrainCombatArm")!;
    expect(cross.exclude).toEqual(["Commando"]);
    const mos = d.effects.find((e) => e.type === "rollOnMosTable");
    expect(mos).toBeDefined();
  });

  it("Commando School: sets Commando arm; 5+ for ten skills", () => {
    const d = details["Commando School"]!;
    const setArm = d.effects.find((e) => e.type === "setCombatArm")!;
    expect(setArm.value).toBe("Commando");
    const batch = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(batch.throwTarget).toBe(5);
    expect(batch.skills).toEqual([
      "Brawling", "Gun Combat", "Demolitions", "Intrusion", "Stealth",
      "Survival", "Recon", "Vacc Suit", "Blade Combat", "Instruction",
    ]);
  });

  it("Protected Forces: 3+ for Vacc Suit, High-G, Zero-G", () => {
    const d = details["Protected Forces"]!;
    const batch = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(batch.throwTarget).toBe(3);
    expect(batch.skills).toEqual(["Vacc Suit", "High-G Environ", "Zero-G Environ"]);
  });

  it("Recruiting Duty: fixed Recruiting skill", () => {
    const d = details["Recruiting Duty"]!;
    const f = d.effects.find((e) => e.type === "fixedSkill") as
      { skill: string; levels: number };
    expect(f.skill).toBe("Recruiting");
  });

  it("OCS: commission + roll Service Skills twice + MOS once; age limit 38", () => {
    const d = details["OCS"]!;
    expect(d.ageLimit).toBe(38);
    expect(d.effects.some((e) => e.type === "ocsCommission")).toBe(true);
    const svc = d.effects.find((e) => e.type === "rollOnServiceSkillsTable") as
      { rolls: number };
    expect(svc.rolls).toBe(2);
    const mos = d.effects.find((e) => e.type === "rollOnMosTable") as
      { rolls: number };
    expect(mos.rolls).toBe(1);
  });

  it("Intelligence School: 4+ for five listed skills", () => {
    const d = details["Intelligence School"]!;
    const batch = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(batch.throwTarget).toBe(4);
    expect(batch.skills).toEqual([
      "Forgery", "Bribery", "Streetwise", "Interrogation", "Vice",
    ]);
  });

  it("Command College: 4+ for Tactics, Leader, Recon", () => {
    const d = details["Command College"]!;
    const batch = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(batch.throwTarget).toBe(4);
    expect(batch.skills).toEqual(["Tactics", "Leader", "Recon"]);
  });

  it("Staff College: 4+ for Admin, Combat Engineering, Computer, Robot Ops", () => {
    const d = details["Staff College"]!;
    const batch = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(batch.throwTarget).toBe(4);
    expect(batch.skills).toEqual([
      "Admin", "Combat Engineering", "Computer", "Robot Ops",
    ]);
  });

  it("Attache/Aide effect present", () => {
    const d = details["Attache/Aide"]!;
    expect(d.effects.some((e) => e.type === "attacheOrAide")).toBe(true);
  });
});

describe("MT Players' Manual p. 50-51 — Mercenary combat assignments + reroutes", () => {
  it("Combat assignments: Police Action, Counterinsurgency, Raid, Ship's Troops", () => {
    const c = getSpec<string[]>(mercenary, ["combatAssignments"]);
    expect(c.sort()).toEqual(
      ["Counterinsurgency", "Police Action", "Raid", "Ship's Troops"].sort(),
    );
  });

  it("Marines reroute: Counterinsurgency/Internal Security → Ship's Troops", () => {
    const r = getSpec<{
      marines: { fromAssignments: string[]; toAssignment: string };
    }>(mercenary, ["assignmentReroutes"]);
    expect(r.marines.fromAssignments.sort()).toEqual(
      ["Counterinsurgency", "Internal Security"].sort(),
    );
    expect(r.marines.toAssignment).toBe("Ship's Troops");
  });
});

describe("MT Players' Manual p. 55 — Navy special assignment details", () => {
  const details = getSpec<Record<string, {
    summary: string;
    effects: Array<Record<string, unknown>>;
    ageLimit?: number;
  }>>(navy, ["specialAssignmentDetails"]);

  it("Cross-Training: any branch; roll one skill on that branch table", () => {
    const d = details["Cross-Training"]!;
    expect(d.effects.some((e) => e.type === "crossTrainBranch")).toBe(true);
    const r = d.effects.find((e) => e.type === "rollOnBranchSkillsTable") as
      { rolls: number };
    expect(r.rolls).toBe(1);
  });

  it("Gunnery School: four throws of 5+, all Gunnery", () => {
    const d = details["Gunnery School"]!;
    const b = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(b.throwTarget).toBe(5);
    expect(b.skills).toEqual(["Gunnery", "Gunnery", "Gunnery", "Gunnery"]);
  });

  it("Engineer School: 5+ for Mechanical, Electronics, Gravitics, Engineering", () => {
    const d = details["Engineer School"]!;
    const b = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(b.throwTarget).toBe(5);
    expect(b.skills).toEqual([
      "Mechanical", "Electronics", "Gravitics", "Engineering",
    ]);
  });

  it("OCS: commission, twice Service Skills, once Branch Skills; age 38", () => {
    const d = details["OCS"]!;
    expect(d.ageLimit).toBe(38);
    expect(d.effects.some((e) => e.type === "ocsCommission")).toBe(true);
    const svc = d.effects.find((e) => e.type === "rollOnServiceSkillsTable") as
      { rolls: number };
    expect(svc.rolls).toBe(2);
    const br = d.effects.find((e) => e.type === "rollOnBranchSkillsTable") as
      { rolls: number };
    expect(br.rolls).toBe(1);
  });

  it("Intelligence School: 4+ for Forgery, Gun Combat, Bribery, Streetwise, Interrogation", () => {
    const d = details["Intelligence School"]!;
    const b = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(b.throwTarget).toBe(4);
    expect(b.skills).toEqual([
      "Forgery", "Gun Combat", "Bribery", "Streetwise", "Interrogation",
    ]);
  });

  it("Command College: 4+ for Ship Tactics, Fleet Tactics, Leader, Admin", () => {
    const d = details["Command College"]!;
    const b = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(b.throwTarget).toBe(4);
    expect(b.skills).toEqual([
      "Ship Tactics", "Fleet Tactics", "Leader", "Admin",
    ]);
  });

  it("Staff College: 4+ for Fleet Tactics, Admin, Liaison, Computer, Robot Ops", () => {
    const d = details["Staff College"]!;
    const b = d.effects.find((e) => e.type === "rollSkillBatch") as
      { throwTarget: number; skills: string[] };
    expect(b.throwTarget).toBe(4);
    expect(b.skills).toEqual([
      "Fleet Tactics", "Admin", "Liaison", "Computer", "Robot Ops",
    ]);
  });
});

describe("MT Players' Manual p. 53 — Navy combat assignments + rank caps", () => {
  it("Combat assignments: Battle, Siege, Strike", () => {
    const c = getSpec<string[]>(navy, ["combatAssignments"]);
    expect(c.sort()).toEqual(["Battle", "Siege", "Strike"].sort());
  });

  it("Rank caps: Imperial Navy 10 (grand admiral), Reserve Fleet 8 (fleet admiral), System Squadron 7 (commodore)", () => {
    const c = getSpec<{
      imperialNavy: number; reserveFleet: number; systemSquadron: number;
    }>(navy, ["rankCaps"]);
    expect(c.imperialNavy).toBe(10);
    expect(c.reserveFleet).toBe(8);
    expect(c.systemSquadron).toBe(7);
  });
});
