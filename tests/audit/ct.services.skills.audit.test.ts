// Row-by-row assertion of every service's four Acquired Skills tables:
//   Table 1: Personal Development
//   Table 2: Service Skills
//   Table 3: Advanced Education
//   Table 4: Advanced Education 8+
//
// READING GUIDE FOR AUDITORS
// --------------------------
// Each `it("row N → CELL", ...)` is a claim that the code's row N output
// matches the PDF's printed cell for that service. To audit:
//
//   1. Open the rulebook to the cited page.
//   2. For each `describe` block, find the corresponding column.
//   3. Read each `it` description and confirm "CELL" matches the printed cell.
//   4. If a description doesn't match the PDF, the code (or this test) has
//      drifted — flag it.
//
// Cascade pools (Blade Cbt, Gun Cbt, Bow Cbt, Vehicle, Aircraft, Watercraft)
// are asserted by *pool membership* rather than a specific weapon, because
// the code rolls randomly within the pool.
//
// Page references: TTB p. 26 (Navy/Marines/Army/Scouts/Merchant/Other),
// CotI p. 12 (Pirate/Belter/Sailor/Diplomat/Doctor/Flyer),
// CotI p. 14 (Barbarian/Bureaucrat/Rogue/Noble/Scientist/Hunter).

import { describe, expect, it, vi, afterEach } from "vitest";
import { s, type AttributeKey, type ServiceKey } from "../../lib/traveller";
import { Character } from "../../lib/traveller/character";
import {
  AIRCRAFTS, BLADES, BOWS, GUNS, VEHICLES, WATERCRAFTS,
} from "../../lib/traveller/cascades";

const BASE = 7;
const POOLS = {
  blade: BLADES as readonly string[],
  bow: BOWS as readonly string[],
  gun: GUNS as readonly string[],
  vehicle: VEHICLES as readonly string[],
  aircraft: AIRCRAFTS as readonly string[],
  watercraft: WATERCRAFTS as readonly string[],
} as const;
type Pool = keyof typeof POOLS;

function forceD6(v: number): void {
  vi.spyOn(Math, "random").mockReturnValue((v - 1) / 6 + 0.0001);
}

function freshCharacter(svc: ServiceKey): Character {
  const c = new Character();
  c.showHistory = "none";
  c.attributes = {
    strength: BASE, dexterity: BASE, endurance: BASE,
    intelligence: BASE, education: BASE, social: BASE,
  };
  c.skills = [];
  c.benefits = [];
  c.events = [];
  c.musterLog = [];
  c.service = svc;
  c.forceTable = true;
  return c;
}

interface RowOutput {
  attrDelta: Partial<Record<AttributeKey, number>>;
  skills: [string, number][];
}

function rowFor(svc: ServiceKey, table: number, n: number): RowOutput {
  const c = freshCharacter(svc);
  c.forceTableIndex = table;
  forceD6(n);
  s[svc].acquireSkill(c);
  vi.restoreAllMocks();
  const attrDelta: Partial<Record<AttributeKey, number>> = {};
  for (const k of [
    "strength", "dexterity", "endurance",
    "intelligence", "education", "social",
  ] as AttributeKey[]) {
    const d = c.attributes[k] - BASE;
    if (d !== 0) attrDelta[k] = d;
  }
  return {
    attrDelta,
    skills: c.skills.map(([n2, l]) => [n2, l] as [string, number]),
  };
}

function assertAttr(
  svc: ServiceKey, table: number, n: number,
  attr: AttributeKey, delta: number,
) {
  const got = rowFor(svc, table, n);
  expect(got.attrDelta).toEqual({ [attr]: delta });
  expect(got.skills).toEqual([]);
}

function assertSkill(
  svc: ServiceKey, table: number, n: number,
  skill: string,
) {
  const got = rowFor(svc, table, n);
  expect(got.attrDelta).toEqual({});
  expect(got.skills).toEqual([[skill, 1]]);
}

function assertCascade(
  svc: ServiceKey, table: number, n: number, pool: Pool,
) {
  const got = rowFor(svc, table, n);
  expect(got.attrDelta).toEqual({});
  expect(got.skills).toHaveLength(1);
  const [name, level] = got.skills[0]!;
  expect(level).toBe(1);
  expect(POOLS[pool]).toContain(name);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// TTB Personal Development — page 26 (Table 1)
// ============================================================================

describe("Navy Personal Development (TTB p. 26)", () => {
  it("row 1 → +1 Stren", () => assertAttr("navy", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("navy", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("navy", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("navy", 1, 4, "intelligence", 1));
  it("row 5 → +1 Educ", () => assertAttr("navy", 1, 5, "education", 1));
  it("row 6 → +1 Social", () => assertAttr("navy", 1, 6, "social", 1));
});

describe("Marines Personal Development (TTB p. 26)", () => {
  it("row 1 → +1 Stren", () => assertAttr("marines", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("marines", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("marines", 1, 3, "endurance", 1));
  it("row 4 → Gambling", () => assertSkill("marines", 1, 4, "Gambling"));
  it("row 5 → Brawling", () => assertSkill("marines", 1, 5, "Brawling"));
  it("row 6 → Blade Cbt", () => assertCascade("marines", 1, 6, "blade"));
});

describe("Army Personal Development (TTB p. 26)", () => {
  it("row 1 → +1 Stren", () => assertAttr("army", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("army", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("army", 1, 3, "endurance", 1));
  it("row 4 → Gambling", () => assertSkill("army", 1, 4, "Gambling"));
  it("row 5 → +1 Educ", () => assertAttr("army", 1, 5, "education", 1));
  it("row 6 → Brawling", () => assertSkill("army", 1, 6, "Brawling"));
});

describe("Scouts Personal Development (TTB p. 26)", () => {
  it("row 1 → +1 Stren", () => assertAttr("scouts", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("scouts", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("scouts", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("scouts", 1, 4, "intelligence", 1));
  it("row 5 → +1 Educ", () => assertAttr("scouts", 1, 5, "education", 1));
  it("row 6 → Gun Cbt", () => assertCascade("scouts", 1, 6, "gun"));
});

describe("Merchants Personal Development (TTB p. 26)", () => {
  it("row 1 → +1 Stren", () => assertAttr("merchants", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("merchants", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("merchants", 1, 3, "endurance", 1));
  it("row 4 → +1 Stren", () => assertAttr("merchants", 1, 4, "strength", 1));
  it("row 5 → Blade Cbt", () => assertCascade("merchants", 1, 5, "blade"));
  it("row 6 → Bribery", () => assertSkill("merchants", 1, 6, "Bribery"));
});

describe("Other Personal Development (TTB p. 26)", () => {
  it("row 1 → +1 Stren", () => assertAttr("other", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("other", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("other", 1, 3, "endurance", 1));
  it("row 4 → Blade Cbt", () => assertCascade("other", 1, 4, "blade"));
  it("row 5 → Brawling", () => assertSkill("other", 1, 5, "Brawling"));
  it("row 6 → -1 Social", () => assertAttr("other", 1, 6, "social", -1));
});

// ============================================================================
// TTB Service Skills — page 26 (Table 2)
// ============================================================================

describe("Navy Service Skills (TTB p. 26)", () => {
  it("row 1 → Ship's Boat", () => assertSkill("navy", 2, 1, "Ship's Boat"));
  it("row 2 → Vacc Suit", () => assertSkill("navy", 2, 2, "Vacc Suit"));
  it("row 3 → Fwd Obsvr", () => assertSkill("navy", 2, 3, "Fwd Obsvr"));
  it("row 4 → Gunnery", () => assertSkill("navy", 2, 4, "Gunnery"));
  it("row 5 → Blade Cbt", () => assertCascade("navy", 2, 5, "blade"));
  it("row 6 → Gun Cbt", () => assertCascade("navy", 2, 6, "gun"));
});

describe("Marines Service Skills (TTB p. 26)", () => {
  it("row 1 → ATV", () => assertSkill("marines", 2, 1, "ATV"));
  it("row 2 → Vacc Suit", () => assertSkill("marines", 2, 2, "Vacc Suit"));
  it("row 3 → Blade Cbt", () => assertCascade("marines", 2, 3, "blade"));
  it("row 4 → Gun Cbt", () => assertCascade("marines", 2, 4, "gun"));
  it("row 5 → Blade Cbt", () => assertCascade("marines", 2, 5, "blade"));
  it("row 6 → Gun Cbt", () => assertCascade("marines", 2, 6, "gun"));
});

describe("Army Service Skills (TTB p. 26)", () => {
  it("row 1 → ATV", () => assertSkill("army", 2, 1, "ATV"));
  it("row 2 → Air/Raft", () => assertSkill("army", 2, 2, "Air/Raft"));
  it("row 3 → Gun Cbt", () => assertCascade("army", 2, 3, "gun"));
  it("row 4 → Fwd Obsvr", () => assertSkill("army", 2, 4, "Fwd Obsvr"));
  it("row 5 → Blade Cbt", () => assertCascade("army", 2, 5, "blade"));
  it("row 6 → Gun Cbt", () => assertCascade("army", 2, 6, "gun"));
});

describe("Scouts Service Skills (TTB p. 26)", () => {
  it("row 1 → Air/Raft", () => assertSkill("scouts", 2, 1, "Air/Raft"));
  it("row 2 → Vacc Suit", () => assertSkill("scouts", 2, 2, "Vacc Suit"));
  it("row 3 → Mechanical", () => assertSkill("scouts", 2, 3, "Mechanical"));
  it("row 4 → Navigation", () => assertSkill("scouts", 2, 4, "Navigation"));
  it("row 5 → Electronic", () => assertSkill("scouts", 2, 5, "Electronic"));
  it("row 6 → Jack-o-T", () => assertSkill("scouts", 2, 6, "Jack-o-T"));
});

describe("Merchants Service Skills (TTB p. 26)", () => {
  it("row 1 → Vehicle", () => assertCascade("merchants", 2, 1, "vehicle"));
  it("row 2 → Vacc Suit", () => assertSkill("merchants", 2, 2, "Vacc Suit"));
  it("row 3 → Jack-o-T", () => assertSkill("merchants", 2, 3, "Jack-o-T"));
  it("row 4 → Steward", () => assertSkill("merchants", 2, 4, "Steward"));
  it("row 5 → Electronic", () => assertSkill("merchants", 2, 5, "Electronic"));
  it("row 6 → Gun Cbt", () => assertCascade("merchants", 2, 6, "gun"));
});

describe("Other Service Skills (TTB p. 26)", () => {
  it("row 1 → Vehicle", () => assertCascade("other", 2, 1, "vehicle"));
  it("row 2 → Gambling", () => assertSkill("other", 2, 2, "Gambling"));
  it("row 3 → Brawling", () => assertSkill("other", 2, 3, "Brawling"));
  it("row 4 → Bribery", () => assertSkill("other", 2, 4, "Bribery"));
  it("row 5 → Blade Cbt", () => assertCascade("other", 2, 5, "blade"));
  it("row 6 → Gun Cbt", () => assertCascade("other", 2, 6, "gun"));
});

// ============================================================================
// TTB Advanced Education — page 26 (Table 3)
// ============================================================================

describe("Navy Advanced Education (TTB p. 26)", () => {
  it("row 1 → Vacc Suit", () => assertSkill("navy", 3, 1, "Vacc Suit"));
  it("row 2 → Mechanical", () => assertSkill("navy", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("navy", 3, 3, "Electronic"));
  it("row 4 → Engineering", () => assertSkill("navy", 3, 4, "Engineering"));
  it("row 5 → Gunnery", () => assertSkill("navy", 3, 5, "Gunnery"));
  it("row 6 → Jack-o-T", () => assertSkill("navy", 3, 6, "Jack-o-T"));
});

describe("Marines Advanced Education (TTB p. 26)", () => {
  it("row 1 → Vehicle", () => assertCascade("marines", 3, 1, "vehicle"));
  it("row 2 → Mechanical", () => assertSkill("marines", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("marines", 3, 3, "Electronic"));
  it("row 4 → Tactics", () => assertSkill("marines", 3, 4, "Tactics"));
  it("row 5 → Blade Cbt", () => assertCascade("marines", 3, 5, "blade"));
  it("row 6 → Gun Cbt", () => assertCascade("marines", 3, 6, "gun"));
});

describe("Army Advanced Education (TTB p. 26)", () => {
  it("row 1 → Vehicle", () => assertCascade("army", 3, 1, "vehicle"));
  it("row 2 → Mechanical", () => assertSkill("army", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("army", 3, 3, "Electronic"));
  it("row 4 → Tactics", () => assertSkill("army", 3, 4, "Tactics"));
  it("row 5 → Blade Cbt", () => assertCascade("army", 3, 5, "blade"));
  it("row 6 → Gun Cbt", () => assertCascade("army", 3, 6, "gun"));
});

describe("Scouts Advanced Education (TTB p. 26)", () => {
  it("row 1 → Vehicle", () => assertCascade("scouts", 3, 1, "vehicle"));
  it("row 2 → Mechanical", () => assertSkill("scouts", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("scouts", 3, 3, "Electronic"));
  it("row 4 → Jack-o-T", () => assertSkill("scouts", 3, 4, "Jack-o-T"));
  it("row 5 → Gunnery", () => assertSkill("scouts", 3, 5, "Gunnery"));
  it("row 6 → Medical", () => assertSkill("scouts", 3, 6, "Medical"));
});

describe("Merchants Advanced Education (TTB p. 26)", () => {
  it("row 1 → Streetwise", () => assertSkill("merchants", 3, 1, "Streetwise"));
  it("row 2 → Mechanical", () => assertSkill("merchants", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("merchants", 3, 3, "Electronic"));
  it("row 4 → Navigation", () => assertSkill("merchants", 3, 4, "Navigation"));
  it("row 5 → Gunnery", () => assertSkill("merchants", 3, 5, "Gunnery"));
  it("row 6 → Medical", () => assertSkill("merchants", 3, 6, "Medical"));
});

describe("Other Advanced Education (TTB p. 26)", () => {
  it("row 1 → Streetwise", () => assertSkill("other", 3, 1, "Streetwise"));
  it("row 2 → Mechanical", () => assertSkill("other", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("other", 3, 3, "Electronic"));
  it("row 4 → Gambling", () => assertSkill("other", 3, 4, "Gambling"));
  it("row 5 → Brawling", () => assertSkill("other", 3, 5, "Brawling"));
  it("row 6 → Forgery", () => assertSkill("other", 3, 6, "Forgery"));
});

// ============================================================================
// TTB Advanced Education 8+ — page 26 (Table 4)
// ============================================================================

describe("Navy Advanced Education 8+ (TTB p. 26)", () => {
  it("row 1 → Medical", () => assertSkill("navy", 4, 1, "Medical"));
  it("row 2 → Navigation", () => assertSkill("navy", 4, 2, "Navigation"));
  it("row 3 → Engineering", () => assertSkill("navy", 4, 3, "Engineering"));
  it("row 4 → Computer", () => assertSkill("navy", 4, 4, "Computer"));
  it("row 5 → Pilot", () => assertSkill("navy", 4, 5, "Pilot"));
  it("row 6 → Admin", () => assertSkill("navy", 4, 6, "Admin"));
});

describe("Marines Advanced Education 8+ (TTB p. 26)", () => {
  it("row 1 → Medical", () => assertSkill("marines", 4, 1, "Medical"));
  it("row 2 → Tactics", () => assertSkill("marines", 4, 2, "Tactics"));
  it("row 3 → Tactics", () => assertSkill("marines", 4, 3, "Tactics"));
  it("row 4 → Computer", () => assertSkill("marines", 4, 4, "Computer"));
  it("row 5 → Leader", () => assertSkill("marines", 4, 5, "Leader"));
  it("row 6 → Admin", () => assertSkill("marines", 4, 6, "Admin"));
});

describe("Army Advanced Education 8+ (TTB p. 26)", () => {
  it("row 1 → Medical", () => assertSkill("army", 4, 1, "Medical"));
  it("row 2 → Tactics", () => assertSkill("army", 4, 2, "Tactics"));
  it("row 3 → Tactics", () => assertSkill("army", 4, 3, "Tactics"));
  it("row 4 → Computer", () => assertSkill("army", 4, 4, "Computer"));
  it("row 5 → Leader", () => assertSkill("army", 4, 5, "Leader"));
  it("row 6 → Admin", () => assertSkill("army", 4, 6, "Admin"));
});

describe("Scouts Advanced Education 8+ (TTB p. 26)", () => {
  it("row 1 → Medical", () => assertSkill("scouts", 4, 1, "Medical"));
  it("row 2 → Navigation", () => assertSkill("scouts", 4, 2, "Navigation"));
  it("row 3 → Engineering", () => assertSkill("scouts", 4, 3, "Engineering"));
  it("row 4 → Computer", () => assertSkill("scouts", 4, 4, "Computer"));
  it("row 5 → Pilot", () => assertSkill("scouts", 4, 5, "Pilot"));
  it("row 6 → Jack-o-T", () => assertSkill("scouts", 4, 6, "Jack-o-T"));
});

describe("Merchants Advanced Education 8+ (TTB p. 26)", () => {
  it("row 1 → Medical", () => assertSkill("merchants", 4, 1, "Medical"));
  it("row 2 → Navigation", () => assertSkill("merchants", 4, 2, "Navigation"));
  it("row 3 → Engineering", () => assertSkill("merchants", 4, 3, "Engineering"));
  it("row 4 → Computer", () => assertSkill("merchants", 4, 4, "Computer"));
  it("row 5 → Pilot", () => assertSkill("merchants", 4, 5, "Pilot"));
  it("row 6 → Admin", () => assertSkill("merchants", 4, 6, "Admin"));
});

describe("Other Advanced Education 8+ (TTB p. 26)", () => {
  it("row 1 → Medical", () => assertSkill("other", 4, 1, "Medical"));
  it("row 2 → Forgery", () => assertSkill("other", 4, 2, "Forgery"));
  it("row 3 → Electronics", () => assertSkill("other", 4, 3, "Electronic"));
  it("row 4 → Computer", () => assertSkill("other", 4, 4, "Computer"));
  it("row 5 → Streetwise", () => assertSkill("other", 4, 5, "Streetwise"));
  it("row 6 → Jack-o-T", () => assertSkill("other", 4, 6, "Jack-o-T"));
});

// ============================================================================
// CotI Personal Development — page 12 (Table 1)
// Column order: Pirate / Belter / Sailor / Diplomat / Doctor / Flyer
// ============================================================================

describe("Pirates Personal Development (CotI p. 12)", () => {
  it("row 1 → +1 Stren", () => assertAttr("pirates", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("pirates", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("pirates", 1, 3, "endurance", 1));
  it("row 4 → Gambling", () => assertSkill("pirates", 1, 4, "Gambling"));
  it("row 5 → Brawling", () => assertSkill("pirates", 1, 5, "Brawling"));
  it("row 6 → Blade Cbt", () => assertCascade("pirates", 1, 6, "blade"));
});

describe("Belters Personal Development (CotI p. 12)", () => {
  it("row 1 → +1 Stren", () => assertAttr("belters", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("belters", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("belters", 1, 3, "endurance", 1));
  it("row 4 → Gambling", () => assertSkill("belters", 1, 4, "Gambling"));
  it("row 5 → Brawling", () => assertSkill("belters", 1, 5, "Brawling"));
  it("row 6 → Vacc Suit", () => assertSkill("belters", 1, 6, "Vacc Suit"));
});

describe("Sailors Personal Development (CotI p. 12)", () => {
  it("row 1 → +1 Stren", () => assertAttr("sailors", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("sailors", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("sailors", 1, 3, "endurance", 1));
  it("row 4 → Gambling", () => assertSkill("sailors", 1, 4, "Gambling"));
  it("row 5 → Brawling", () => assertSkill("sailors", 1, 5, "Brawling"));
  it("row 6 → Carousing", () => assertSkill("sailors", 1, 6, "Carousing"));
});

describe("Diplomats Personal Development (CotI p. 12)", () => {
  it("row 1 → +1 Stren", () => assertAttr("diplomats", 1, 1, "strength", 1));
  it("row 2 → +1 Educ", () => assertAttr("diplomats", 1, 2, "education", 1));
  it("row 3 → +1 Intel", () => assertAttr("diplomats", 1, 3, "intelligence", 1));
  it("row 4 → Blade Cbt", () => assertCascade("diplomats", 1, 4, "blade"));
  it("row 5 → Gun Cbt", () => assertCascade("diplomats", 1, 5, "gun"));
  it("row 6 → Carousing", () => assertSkill("diplomats", 1, 6, "Carousing"));
});

describe("Doctors Personal Development (CotI p. 12)", () => {
  it("row 1 → +1 Stren", () => assertAttr("doctors", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("doctors", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("doctors", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("doctors", 1, 4, "intelligence", 1));
  it("row 5 → +1 Educ", () => assertAttr("doctors", 1, 5, "education", 1));
  it("row 6 → +1 Social", () => assertAttr("doctors", 1, 6, "social", 1));
});

describe("Flyers Personal Development (CotI p. 12)", () => {
  it("row 1 → +1 Stren", () => assertAttr("flyers", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("flyers", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("flyers", 1, 3, "endurance", 1));
  it("row 4 → Gambling", () => assertSkill("flyers", 1, 4, "Gambling"));
  it("row 5 → Brawling", () => assertSkill("flyers", 1, 5, "Brawling"));
  it("row 6 → Carousing", () => assertSkill("flyers", 1, 6, "Carousing"));
});

// ============================================================================
// CotI Service Skills — page 12 (Table 2)
// ============================================================================

describe("Pirates Service Skills (CotI p. 12)", () => {
  it("row 1 → Blade Cbt", () => assertCascade("pirates", 2, 1, "blade"));
  it("row 2 → Vacc Suit", () => assertSkill("pirates", 2, 2, "Vacc Suit"));
  it("row 3 → Gun Cbt", () => assertCascade("pirates", 2, 3, "gun"));
  it("row 4 → Gunnery", () => assertSkill("pirates", 2, 4, "Gunnery"));
  it("row 5 → Zero-G Cbt", () => assertSkill("pirates", 2, 5, "Zero-G Cbt"));
  it("row 6 → Gun Cbt", () => assertCascade("pirates", 2, 6, "gun"));
});

describe("Belters Service Skills (CotI p. 12)", () => {
  it("row 1 → Vacc Suit", () => assertSkill("belters", 2, 1, "Vacc Suit"));
  it("row 2 → Vacc Suit", () => assertSkill("belters", 2, 2, "Vacc Suit"));
  it("row 3 → Prospecting", () => assertSkill("belters", 2, 3, "Prospecting"));
  it("row 4 → Fwd Obsv", () => assertSkill("belters", 2, 4, "Fwd Obsvr"));
  it("row 5 → Prospecting", () => assertSkill("belters", 2, 5, "Prospecting"));
  it("row 6 → Ship's Boat", () => assertSkill("belters", 2, 6, "Ship's Boat"));
});

describe("Sailors Service Skills (CotI p. 12)", () => {
  it("row 1 → Gun Cbt", () => assertCascade("sailors", 2, 1, "gun"));
  it("row 2 → Commo", () => assertSkill("sailors", 2, 2, "Commo"));
  it("row 3 → Fwd Obsv", () => assertSkill("sailors", 2, 3, "Fwd Obsvr"));
  it("row 4 → Vehicle", () => assertCascade("sailors", 2, 4, "vehicle"));
  it("row 5 → Vehicle", () => assertCascade("sailors", 2, 5, "vehicle"));
  it("row 6 → Battle Dress", () => assertSkill("sailors", 2, 6, "Battle Dress"));
});

describe("Diplomats Service Skills (CotI p. 12)", () => {
  it("row 1 → +1 Intel", () => assertAttr("diplomats", 2, 1, "intelligence", 1));
  it("row 2 → Vacc Suit", () => assertSkill("diplomats", 2, 2, "Vacc Suit"));
  it("row 3 → Vehicle", () => assertCascade("diplomats", 2, 3, "vehicle"));
  it("row 4 → Vehicle", () => assertCascade("diplomats", 2, 4, "vehicle"));
  it("row 5 → Gambling", () => assertSkill("diplomats", 2, 5, "Gambling"));
  it("row 6 → Computer", () => assertSkill("diplomats", 2, 6, "Computer"));
});

describe("Doctors Service Skills (CotI p. 12)", () => {
  it("row 1 → +1 Dext", () => assertAttr("doctors", 2, 1, "dexterity", 1));
  it("row 2 → Electronic", () => assertSkill("doctors", 2, 2, "Electronic"));
  it("row 3 → Medical", () => assertSkill("doctors", 2, 3, "Medical"));
  it("row 4 → Streetwise", () => assertSkill("doctors", 2, 4, "Streetwise"));
  it("row 5 → Medical", () => assertSkill("doctors", 2, 5, "Medical"));
  it("row 6 → Blade Cbt", () => assertCascade("doctors", 2, 6, "blade"));
});

describe("Flyers Service Skills (CotI p. 12)", () => {
  it("row 1 → Brawling", () => assertSkill("flyers", 2, 1, "Brawling"));
  it("row 2 → Vacc Suit", () => assertSkill("flyers", 2, 2, "Vacc Suit"));
  it("row 3 → Gun Cbt", () => assertCascade("flyers", 2, 3, "gun"));
  it("row 4 → Vehicle", () => assertCascade("flyers", 2, 4, "vehicle"));
  it("row 5 → Vehicle", () => assertCascade("flyers", 2, 5, "vehicle"));
  it("row 6 → Vehicle", () => assertCascade("flyers", 2, 6, "vehicle"));
});

// ============================================================================
// CotI Advanced Education — page 12 (Table 3)
// ============================================================================

describe("Pirates Advanced Education (CotI p. 12)", () => {
  it("row 1 → Streetwise", () => assertSkill("pirates", 3, 1, "Streetwise"));
  it("row 2 → Gunnery", () => assertSkill("pirates", 3, 2, "Gunnery"));
  it("row 3 → Engnrng", () => assertSkill("pirates", 3, 3, "Engineering"));
  it("row 4 → Ship Tactic", () => assertSkill("pirates", 3, 4, "Ship Tactic"));
  it("row 5 → Tactics", () => assertSkill("pirates", 3, 5, "Tactics"));
  it("row 6 → Mechanical", () => assertSkill("pirates", 3, 6, "Mechanical"));
});

describe("Belters Advanced Education (CotI p. 12)", () => {
  it("row 1 → Ship's Boat", () => assertSkill("belters", 3, 1, "Ship's Boat"));
  it("row 2 → Electronic", () => assertSkill("belters", 3, 2, "Electronic"));
  it("row 3 → Prospecting", () => assertSkill("belters", 3, 3, "Prospecting"));
  it("row 4 → Mechanical", () => assertSkill("belters", 3, 4, "Mechanical"));
  it("row 5 → Prospecting", () => assertSkill("belters", 3, 5, "Prospecting"));
  it("row 6 → Instruction", () => assertSkill("belters", 3, 6, "Instruction"));
});

describe("Sailors Advanced Education (CotI p. 12)", () => {
  it("row 1 → Water Craft", () => assertCascade("sailors", 3, 1, "watercraft"));
  it("row 2 → Electronic", () => assertSkill("sailors", 3, 2, "Electronic"));
  it("row 3 → Mechanical", () => assertSkill("sailors", 3, 3, "Mechanical"));
  it("row 4 → Gravitics", () => assertSkill("sailors", 3, 4, "Gravitics"));
  it("row 5 → Navigation", () => assertSkill("sailors", 3, 5, "Navigation"));
  it("row 6 → Demolition", () => assertSkill("sailors", 3, 6, "Demolition"));
});

describe("Diplomats Advanced Education (CotI p. 12)", () => {
  it("row 1 → Forgery", () => assertSkill("diplomats", 3, 1, "Forgery"));
  it("row 2 → Streetwise", () => assertSkill("diplomats", 3, 2, "Streetwise"));
  it("row 3 → Interrogation", () => assertSkill("diplomats", 3, 3, "Interrogation"));
  it("row 4 → Recruiting", () => assertSkill("diplomats", 3, 4, "Recruiting"));
  it("row 5 → Instruction", () => assertSkill("diplomats", 3, 5, "Instruction"));
  it("row 6 → Admin", () => assertSkill("diplomats", 3, 6, "Admin"));
});

describe("Doctors Advanced Education (CotI p. 12)", () => {
  it("row 1 → Medical", () => assertSkill("doctors", 3, 1, "Medical"));
  it("row 2 → Medical", () => assertSkill("doctors", 3, 2, "Medical"));
  it("row 3 → Mechanical", () => assertSkill("doctors", 3, 3, "Mechanical"));
  it("row 4 → Electronic", () => assertSkill("doctors", 3, 4, "Electronic"));
  it("row 5 → Computer", () => assertSkill("doctors", 3, 5, "Computer"));
  it("row 6 → Admin", () => assertSkill("doctors", 3, 6, "Admin"));
});

describe("Flyers Advanced Education (CotI p. 12)", () => {
  it("row 1 → Air Craft", () => assertCascade("flyers", 3, 1, "aircraft"));
  it("row 2 → Mechanical", () => assertSkill("flyers", 3, 2, "Mechanical"));
  it("row 3 → Electronic", () => assertSkill("flyers", 3, 3, "Electronic"));
  it("row 4 → Gravitics", () => assertSkill("flyers", 3, 4, "Gravitics"));
  it("row 5 → Gun Cbt", () => assertCascade("flyers", 3, 5, "gun"));
  it("row 6 → Survival", () => assertSkill("flyers", 3, 6, "Survival"));
});

// ============================================================================
// CotI Advanced Education 8+ — page 12 (Table 4)
// ============================================================================

describe("Pirates Advanced Education 8+ (CotI p. 12)", () => {
  it("row 1 → Navigation", () => assertSkill("pirates", 4, 1, "Navigation"));
  it("row 2 → Pilot", () => assertSkill("pirates", 4, 2, "Pilot"));
  it("row 3 → Forgery", () => assertSkill("pirates", 4, 3, "Forgery"));
  it("row 4 → Computer", () => assertSkill("pirates", 4, 4, "Computer"));
  it("row 5 → Leader", () => assertSkill("pirates", 4, 5, "Leader"));
  it("row 6 → Electronic", () => assertSkill("pirates", 4, 6, "Electronic"));
});

describe("Belters Advanced Education 8+ (CotI p. 12)", () => {
  it("row 1 → Navigation", () => assertSkill("belters", 4, 1, "Navigation"));
  it("row 2 → Medical", () => assertSkill("belters", 4, 2, "Medical"));
  it("row 3 → Pilot", () => assertSkill("belters", 4, 3, "Pilot"));
  it("row 4 → Computer", () => assertSkill("belters", 4, 4, "Computer"));
  it("row 5 → Engnrng", () => assertSkill("belters", 4, 5, "Engineering"));
  it("row 6 → Jack-o-T", () => assertSkill("belters", 4, 6, "Jack-o-T"));
});

describe("Sailors Advanced Education 8+ (CotI p. 12)", () => {
  it("row 1 → Medical", () => assertSkill("sailors", 4, 1, "Medical"));
  it("row 2 → Vehicle", () => assertCascade("sailors", 4, 2, "vehicle"));
  it("row 3 → Streetwise", () => assertSkill("sailors", 4, 3, "Streetwise"));
  it("row 4 → Computer", () => assertSkill("sailors", 4, 4, "Computer"));
  it("row 5 → Admin", () => assertSkill("sailors", 4, 5, "Admin"));
  it("row 6 → Jack-o-T", () => assertSkill("sailors", 4, 6, "Jack-o-T"));
});

describe("Diplomats Advanced Education 8+ (CotI p. 12)", () => {
  it("row 1 → Liaison", () => assertSkill("diplomats", 4, 1, "Liaison"));
  it("row 2 → Liaison", () => assertSkill("diplomats", 4, 2, "Liaison"));
  it("row 3 → Admin", () => assertSkill("diplomats", 4, 3, "Admin"));
  it("row 4 → Computer", () => assertSkill("diplomats", 4, 4, "Computer"));
  it("row 5 → +1 Social", () => assertAttr("diplomats", 4, 5, "social", 1));
  it("row 6 → Jack-o-T", () => assertSkill("diplomats", 4, 6, "Jack-o-T"));
});

describe("Doctors Advanced Education 8+ (CotI p. 12)", () => {
  it("row 1 → Medical", () => assertSkill("doctors", 4, 1, "Medical"));
  it("row 2 → Medical", () => assertSkill("doctors", 4, 2, "Medical"));
  it("row 3 → Admin", () => assertSkill("doctors", 4, 3, "Admin"));
  it("row 4 → Computer", () => assertSkill("doctors", 4, 4, "Computer"));
  it("row 5 → +1 Intel", () => assertAttr("doctors", 4, 5, "intelligence", 1));
  it("row 6 → +1 Educ", () => assertAttr("doctors", 4, 6, "education", 1));
});

describe("Flyers Advanced Education 8+ (CotI p. 12)", () => {
  it("row 1 → Medical", () => assertSkill("flyers", 4, 1, "Medical"));
  it("row 2 → Leader", () => assertSkill("flyers", 4, 2, "Leader"));
  it("row 3 → Pilot", () => assertSkill("flyers", 4, 3, "Pilot"));
  it("row 4 → Computer", () => assertSkill("flyers", 4, 4, "Computer"));
  it("row 5 → Admin", () => assertSkill("flyers", 4, 5, "Admin"));
  it("row 6 → Jack-o-T", () => assertSkill("flyers", 4, 6, "Jack-o-T"));
});

// ============================================================================
// CotI Personal Development — page 14 (Table 1)
// Column order: Barbarian / Bureaucrat / Rogue / Noble / Scientist / Hunter
// ============================================================================

describe("Barbarians Personal Development (CotI p. 14)", () => {
  it("row 1 → +1 Stren", () => assertAttr("barbarians", 1, 1, "strength", 1));
  it("row 2 → +2 Stren", () => assertAttr("barbarians", 1, 2, "strength", 2));
  it("row 3 → +1 Stren", () => assertAttr("barbarians", 1, 3, "strength", 1));
  it("row 4 → Carousing", () => assertSkill("barbarians", 1, 4, "Carousing"));
  it("row 5 → +1 Dext", () => assertAttr("barbarians", 1, 5, "dexterity", 1));
  it("row 6 → +1 Endur", () => assertAttr("barbarians", 1, 6, "endurance", 1));
});

describe("Bureaucrats Personal Development (CotI p. 14)", () => {
  it("row 1 → +1 Endur", () => assertAttr("bureaucrats", 1, 1, "endurance", 1));
  it("row 2 → +1 Educ", () => assertAttr("bureaucrats", 1, 2, "education", 1));
  it("row 3 → +1 Intel", () => assertAttr("bureaucrats", 1, 3, "intelligence", 1));
  it("row 4 → Brawling", () => assertSkill("bureaucrats", 1, 4, "Brawling"));
  it("row 5 → Carousing", () => assertSkill("bureaucrats", 1, 5, "Carousing"));
  it("row 6 → +1 Dext", () => assertAttr("bureaucrats", 1, 6, "dexterity", 1));
});

describe("Rogues Personal Development (CotI p. 14)", () => {
  it("row 1 → +1 Stren", () => assertAttr("rogues", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("rogues", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("rogues", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("rogues", 1, 4, "intelligence", 1));
  it("row 5 → Brawling", () => assertSkill("rogues", 1, 5, "Brawling"));
  it("row 6 → Carousing", () => assertSkill("rogues", 1, 6, "Carousing"));
});

describe("Nobles Personal Development (CotI p. 14)", () => {
  it("row 1 → +1 Stren", () => assertAttr("nobles", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("nobles", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("nobles", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("nobles", 1, 4, "intelligence", 1));
  it("row 5 → Carousing", () => assertSkill("nobles", 1, 5, "Carousing"));
  it("row 6 → Brawling", () => assertSkill("nobles", 1, 6, "Brawling"));
});

describe("Scientists Personal Development (CotI p. 14)", () => {
  it("row 1 → +1 Stren", () => assertAttr("scientists", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("scientists", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("scientists", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("scientists", 1, 4, "intelligence", 1));
  it("row 5 → +1 Educ", () => assertAttr("scientists", 1, 5, "education", 1));
  it("row 6 → Carousing", () => assertSkill("scientists", 1, 6, "Carousing"));
});

describe("Hunters Personal Development (CotI p. 14)", () => {
  it("row 1 → +1 Stren", () => assertAttr("hunters", 1, 1, "strength", 1));
  it("row 2 → +1 Dext", () => assertAttr("hunters", 1, 2, "dexterity", 1));
  it("row 3 → +1 Endur", () => assertAttr("hunters", 1, 3, "endurance", 1));
  it("row 4 → +1 Intel", () => assertAttr("hunters", 1, 4, "intelligence", 1));
  it("row 5 → Gun Cbt", () => assertCascade("hunters", 1, 5, "gun"));
  it("row 6 → Blade Cbt", () => assertCascade("hunters", 1, 6, "blade"));
});

// ============================================================================
// CotI Service Skills — page 14 (Table 2)
// ============================================================================

describe("Barbarians Service Skills (CotI p. 14)", () => {
  it("row 1 → Brawling", () => assertSkill("barbarians", 2, 1, "Brawling"));
  it("row 2 → Blade Cbt", () => assertCascade("barbarians", 2, 2, "blade"));
  it("row 3 → Blade Cbt", () => assertCascade("barbarians", 2, 3, "blade"));
  it("row 4 → Bow Cbt", () => assertCascade("barbarians", 2, 4, "bow"));
  it("row 5 → Bow Cbt", () => assertCascade("barbarians", 2, 5, "bow"));
  it("row 6 → Gun Cbt", () => assertCascade("barbarians", 2, 6, "gun"));
});

describe("Bureaucrats Service Skills (CotI p. 14)", () => {
  it("row 1 → Gun Cbt", () => assertCascade("bureaucrats", 2, 1, "gun"));
  it("row 2 → Vehicle", () => assertCascade("bureaucrats", 2, 2, "vehicle"));
  it("row 3 → Blade Cbt", () => assertCascade("bureaucrats", 2, 3, "blade"));
  it("row 4 → Instruction", () => assertSkill("bureaucrats", 2, 4, "Instruction"));
  it("row 5 → Vehicle", () => assertCascade("bureaucrats", 2, 5, "vehicle"));
  it("row 6 → +1 Educ", () => assertAttr("bureaucrats", 2, 6, "education", 1));
});

describe("Rogues Service Skills (CotI p. 14)", () => {
  it("row 1 → Blade Cbt", () => assertCascade("rogues", 2, 1, "blade"));
  it("row 2 → Gun Cbt", () => assertCascade("rogues", 2, 2, "gun"));
  it("row 3 → Demolition", () => assertSkill("rogues", 2, 3, "Demolition"));
  it("row 4 → Vehicle", () => assertCascade("rogues", 2, 4, "vehicle"));
  it("row 5 → +1 Educ", () => assertAttr("rogues", 2, 5, "education", 1));
  it("row 6 → Vehicle", () => assertCascade("rogues", 2, 6, "vehicle"));
});

describe("Nobles Service Skills (CotI p. 14)", () => {
  it("row 1 → Gun Cbt", () => assertCascade("nobles", 2, 1, "gun"));
  it("row 2 → Blade Cbt", () => assertCascade("nobles", 2, 2, "blade"));
  it("row 3 → Hunting", () => assertSkill("nobles", 2, 3, "Hunting"));
  it("row 4 → Vehicle", () => assertCascade("nobles", 2, 4, "vehicle"));
  it("row 5 → Bribery", () => assertSkill("nobles", 2, 5, "Bribery"));
  it("row 6 → +1 Dext", () => assertAttr("nobles", 2, 6, "dexterity", 1));
});

describe("Scientists Service Skills (CotI p. 14)", () => {
  it("row 1 → Gun Cbt", () => assertCascade("scientists", 2, 1, "gun"));
  it("row 2 → Blade Cbt", () => assertCascade("scientists", 2, 2, "blade"));
  it("row 3 → Vehicle", () => assertCascade("scientists", 2, 3, "vehicle"));
  it("row 4 → Jack-o-T", () => assertSkill("scientists", 2, 4, "Jack-o-T"));
  it("row 5 → Navigation", () => assertSkill("scientists", 2, 5, "Navigation"));
  it("row 6 → Survival", () => assertSkill("scientists", 2, 6, "Survival"));
});

describe("Hunters Service Skills (CotI p. 14)", () => {
  it("row 1 → Gun Cbt", () => assertCascade("hunters", 2, 1, "gun"));
  it("row 2 → Blade Cbt", () => assertCascade("hunters", 2, 2, "blade"));
  it("row 3 → Survival", () => assertSkill("hunters", 2, 3, "Survival"));
  it("row 4 → Hunting", () => assertSkill("hunters", 2, 4, "Hunting"));
  it("row 5 → Vehicle", () => assertCascade("hunters", 2, 5, "vehicle"));
  it("row 6 → Hunting", () => assertSkill("hunters", 2, 6, "Hunting"));
});

// ============================================================================
// CotI Advanced Education — page 14 (Table 3)
// ============================================================================

describe("Barbarians Advanced Education (CotI p. 14)", () => {
  it("row 1 → Blade Cbt", () => assertCascade("barbarians", 3, 1, "blade"));
  it("row 2 → Mechanical", () => assertSkill("barbarians", 3, 2, "Mechanical"));
  it("row 3 → Survival", () => assertSkill("barbarians", 3, 3, "Survival"));
  it("row 4 → Recon", () => assertSkill("barbarians", 3, 4, "Recon"));
  it("row 5 → Streetwise", () => assertSkill("barbarians", 3, 5, "Streetwise"));
  it("row 6 → Bow Cbt", () => assertCascade("barbarians", 3, 6, "bow"));
});

describe("Bureaucrats Advanced Education (CotI p. 14)", () => {
  it("row 1 → Recruiting", () => assertSkill("bureaucrats", 3, 1, "Recruiting"));
  it("row 2 → Vehicle", () => assertCascade("bureaucrats", 3, 2, "vehicle"));
  it("row 3 → Liaison", () => assertSkill("bureaucrats", 3, 3, "Liaison"));
  it("row 4 → Interrogation", () => assertSkill("bureaucrats", 3, 4, "Interrogation"));
  it("row 5 → Admin", () => assertSkill("bureaucrats", 3, 5, "Admin"));
  it("row 6 → Admin", () => assertSkill("bureaucrats", 3, 6, "Admin"));
});

describe("Rogues Advanced Education (CotI p. 14)", () => {
  it("row 1 → Streetwise", () => assertSkill("rogues", 3, 1, "Streetwise"));
  it("row 2 → Forgery", () => assertSkill("rogues", 3, 2, "Forgery"));
  it("row 3 → Bribery", () => assertSkill("rogues", 3, 3, "Bribery"));
  it("row 4 → Carousing", () => assertSkill("rogues", 3, 4, "Carousing"));
  it("row 5 → Liaison", () => assertSkill("rogues", 3, 5, "Liaison"));
  it("row 6 → Ship Tactics", () => assertSkill("rogues", 3, 6, "Ship Tactics"));
});

describe("Nobles Advanced Education (CotI p. 14)", () => {
  it("row 1 → Pilot", () => assertSkill("nobles", 3, 1, "Pilot"));
  it("row 2 → Ship's Boat", () => assertSkill("nobles", 3, 2, "Ship's Boat"));
  it("row 3 → Vehicle", () => assertCascade("nobles", 3, 3, "vehicle"));
  it("row 4 → Navigation", () => assertSkill("nobles", 3, 4, "Navigation"));
  it("row 5 → Engnrng", () => assertSkill("nobles", 3, 5, "Engineering"));
  it("row 6 → Leader", () => assertSkill("nobles", 3, 6, "Leader"));
});

describe("Scientists Advanced Education (CotI p. 14)", () => {
  it("row 1 → Mechanical", () => assertSkill("scientists", 3, 1, "Mechanical"));
  it("row 2 → Electronic", () => assertSkill("scientists", 3, 2, "Electronic"));
  it("row 3 → Gravitics", () => assertSkill("scientists", 3, 3, "Gravitics"));
  it("row 4 → Computer", () => assertSkill("scientists", 3, 4, "Computer"));
  it("row 5 → +1 Intel", () => assertAttr("scientists", 3, 5, "intelligence", 1));
  it("row 6 → +1 Educ", () => assertAttr("scientists", 3, 6, "education", 1));
});

describe("Hunters Advanced Education (CotI p. 14)", () => {
  it("row 1 → Mechanical", () => assertSkill("hunters", 3, 1, "Mechanical"));
  it("row 2 → Electronic", () => assertSkill("hunters", 3, 2, "Electronic"));
  it("row 3 → Gravitics", () => assertSkill("hunters", 3, 3, "Gravitics"));
  it("row 4 → Computer", () => assertSkill("hunters", 3, 4, "Computer"));
  it("row 5 → Hunting", () => assertSkill("hunters", 3, 5, "Hunting"));
  it("row 6 → Admin", () => assertSkill("hunters", 3, 6, "Admin"));
});

// ============================================================================
// CotI Advanced Education 8+ — page 14 (Table 4)
// ============================================================================

describe("Barbarians Advanced Education 8+ (CotI p. 14)", () => {
  it("row 1 → Medical", () => assertSkill("barbarians", 4, 1, "Medical"));
  it("row 2 → Interrogation", () => assertSkill("barbarians", 4, 2, "Interrogation"));
  it("row 3 → Tactics", () => assertSkill("barbarians", 4, 3, "Tactics"));
  it("row 4 → Leader", () => assertSkill("barbarians", 4, 4, "Leader"));
  it("row 5 → Instruction", () => assertSkill("barbarians", 4, 5, "Instruction"));
  it("row 6 → Jack-o-T", () => assertSkill("barbarians", 4, 6, "Jack-o-T"));
});

describe("Bureaucrats Advanced Education 8+ (CotI p. 14)", () => {
  it("row 1 → Admin", () => assertSkill("bureaucrats", 4, 1, "Admin"));
  it("row 2 → Admin", () => assertSkill("bureaucrats", 4, 2, "Admin"));
  it("row 3 → Computer", () => assertSkill("bureaucrats", 4, 3, "Computer"));
  it("row 4 → Admin", () => assertSkill("bureaucrats", 4, 4, "Admin"));
  it("row 5 → Jack-o-T", () => assertSkill("bureaucrats", 4, 5, "Jack-o-T"));
  it("row 6 → Leader", () => assertSkill("bureaucrats", 4, 6, "Leader"));
});

describe("Rogues Advanced Education 8+ (CotI p. 14)", () => {
  it("row 1 → Medical", () => assertSkill("rogues", 4, 1, "Medical"));
  it("row 2 → Bribery", () => assertSkill("rogues", 4, 2, "Bribery"));
  it("row 3 → Forgery", () => assertSkill("rogues", 4, 3, "Forgery"));
  it("row 4 → Computer", () => assertSkill("rogues", 4, 4, "Computer"));
  it("row 5 → Leader", () => assertSkill("rogues", 4, 5, "Leader"));
  it("row 6 → Jack-o-T", () => assertSkill("rogues", 4, 6, "Jack-o-T"));
});

describe("Nobles Advanced Education 8+ (CotI p. 14)", () => {
  it("row 1 → Medical", () => assertSkill("nobles", 4, 1, "Medical"));
  it("row 2 → Computer", () => assertSkill("nobles", 4, 2, "Computer"));
  it("row 3 → Admin", () => assertSkill("nobles", 4, 3, "Admin"));
  it("row 4 → Liaison", () => assertSkill("nobles", 4, 4, "Liaison"));
  it("row 5 → Leader", () => assertSkill("nobles", 4, 5, "Leader"));
  it("row 6 → Jack-o-T", () => assertSkill("nobles", 4, 6, "Jack-o-T"));
});

describe("Scientists Advanced Education 8+ (CotI p. 14)", () => {
  it("row 1 → Medical", () => assertSkill("scientists", 4, 1, "Medical"));
  it("row 2 → Computer", () => assertSkill("scientists", 4, 2, "Computer"));
  it("row 3 → Admin", () => assertSkill("scientists", 4, 3, "Admin"));
  it("row 4 → Leader", () => assertSkill("scientists", 4, 4, "Leader"));
  it("row 5 → +1 Intel", () => assertAttr("scientists", 4, 5, "intelligence", 1));
  it("row 6 → Jack-o-T", () => assertSkill("scientists", 4, 6, "Jack-o-T"));
});

describe("Hunters Advanced Education 8+ (CotI p. 14)", () => {
  it("row 1 → Medical", () => assertSkill("hunters", 4, 1, "Medical"));
  it("row 2 → Computer", () => assertSkill("hunters", 4, 2, "Computer"));
  it("row 3 → Hunting", () => assertSkill("hunters", 4, 3, "Hunting"));
  it("row 4 → Leader", () => assertSkill("hunters", 4, 4, "Leader"));
  it("row 5 → Survival", () => assertSkill("hunters", 4, 5, "Survival"));
  it("row 6 → Admin", () => assertSkill("hunters", 4, 6, "Admin"));
});
