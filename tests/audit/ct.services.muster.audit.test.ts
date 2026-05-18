// Row-by-row assertion of every service's Material Benefits muster-out table.
//
// READING GUIDE FOR AUDITORS
// --------------------------
// Each `it("row N → CELL", ...)` is a claim that the code's row N output
// matches the PDF's printed cell content for that service. To audit:
//
//   1. Open the rulebook to the cited page.
//   2. For each `describe` block, find the corresponding column.
//   3. Read each `it` description and confirm "CELL" matches the printed cell.
//   4. If a description doesn't match the PDF, the code (or this test) has
//      drifted — flag it and we'll fix the *code* to match the PDF.
//
// The test bodies use vitest mocks to force roll(1) to a specific value and
// then verify the observable state changes the code produced. Test names use
// PDF-style abbreviations ("Mid Psg", "+1 Intel"); the code emits slightly
// different strings (e.g. "Mid Passage") which is the value we assert against.
//
// Page references: TTB p. 24 (Navy/Marines/Army/Scouts/Merchants/Other),
// CotI p. 6 (Pirate/Belter/Sailor/Diplomat/Doctor/Flyer), CotI p. 8 (Barbarian/
// Bureaucrat/Rogue/Noble/Scientist/Hunter).
//
// Row 7 is reachable only with a rank-5/6 +1 DM. For careers without ranks
// (Belters, Doctors, Rogues, Scientists, Hunters, Scouts, Other) row 7 is
// unreachable in play; we still assert the code's behavior for documentation.

import { describe, expect, it, vi, afterEach } from "vitest";
import { s, type AttributeKey, type ServiceKey } from "../../lib/traveller";
import { Character } from "../../lib/traveller/character";

const BASE = 7;

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
  c.bladeBenefit = "";
  c.gunBenefit = "";
  c.mortgage = 40;
  c.mortgages = 0;
  c.ship = false;
  c.TAS = false;
  c.service = svc;
  return c;
}

interface Diff {
  benefits: string[];
  attrDelta: Partial<Record<AttributeKey, number>>;
  ship: boolean;
  TAS: boolean;
  skills: [string, number][];
  mortgageDelta: number;
}

function rowFor(svc: ServiceKey, n: number): Diff {
  const c = freshCharacter(svc);
  forceD6(n);
  s[svc].musterBenefits(c, 0);
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
    benefits: c.benefits,
    attrDelta,
    ship: c.ship,
    TAS: c.TAS,
    skills: c.skills.map(([n2, l]) => [n2, l] as [string, number]),
    mortgageDelta: 40 - c.mortgage,
  };
}

interface Expected {
  benefit?: string;
  attr?: Partial<Record<AttributeKey, number>>;
  ship?: boolean;
  TAS?: boolean;
  noop?: true;
}

function assertRow(svc: ServiceKey, n: number, expected: Expected) {
  const got = rowFor(svc, n);
  if (expected.noop) {
    expect(got.benefits).toEqual([]);
    expect(got.attrDelta).toEqual({});
    expect(got.ship).toBe(false);
    expect(got.TAS).toBe(false);
    expect(got.skills).toEqual([]);
    expect(got.mortgageDelta).toBe(0);
    return;
  }
  expect(got.benefits).toEqual(expected.benefit ? [expected.benefit] : []);
  expect(got.attrDelta).toEqual(expected.attr ?? {});
  expect(got.ship).toBe(expected.ship ?? false);
  expect(got.TAS).toBe(expected.TAS ?? false);
  expect(got.skills).toEqual([]);
}

/** Weapon benefit: cascades to a specific weapon, adds it as benefit + skill-0. */
function assertWeaponRow(svc: ServiceKey, n: number) {
  const got = rowFor(svc, n);
  expect(got.benefits).toHaveLength(1);
  expect(got.skills).toHaveLength(1);
  expect(got.skills[0]![1]).toBe(0);
  expect(got.skills[0]![0]).toBe(got.benefits[0]);
  expect(got.attrDelta).toEqual({});
  expect(got.ship).toBe(false);
  expect(got.TAS).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// TTB Material Benefits — page 24
// Column order: Navy / Marines / Army / Scouts / Merchants / Other
// ============================================================================

describe("Navy Material Benefits (TTB p. 24)", () => {
  it("row 1 → Low Psg", () => assertRow("navy", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("navy", 2, { attr: { intelligence: 1 } }));
  it("row 3 → +2 Educ", () => assertRow("navy", 3, { attr: { education: 2 } }));
  it("row 4 → Blade", () => assertWeaponRow("navy", 4));
  it("row 5 → Travellers'", () => assertRow("navy", 5, {
    benefit: "Travellers' Aid Society", TAS: true,
  }));
  it("row 6 → High Psg", () => assertRow("navy", 6, { benefit: "High Passage" }));
  it("row 7 → +2 Social (rank 5/6 only)", () => assertRow("navy", 7, {
    attr: { social: 2 },
  }));
});

describe("Marines Material Benefits (TTB p. 24)", () => {
  it("row 1 → Low Psg", () => assertRow("marines", 1, { benefit: "Low Passage" }));
  it("row 2 → +2 Intel", () => assertRow("marines", 2, { attr: { intelligence: 2 } }));
  it("row 3 → +1 Educ", () => assertRow("marines", 3, { attr: { education: 1 } }));
  it("row 4 → Blade", () => assertWeaponRow("marines", 4));
  it("row 5 → Travellers'", () => assertRow("marines", 5, {
    benefit: "Travellers' Aid Society", TAS: true,
  }));
  it("row 6 → High Psg", () => assertRow("marines", 6, { benefit: "High Passage" }));
  it("row 7 → +2 Social (rank 5/6 only)", () => assertRow("marines", 7, {
    attr: { social: 2 },
  }));
});

describe("Army Material Benefits (TTB p. 24)", () => {
  it("row 1 → Low Psg", () => assertRow("army", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("army", 2, { attr: { intelligence: 1 } }));
  it("row 3 → +2 Educ", () => assertRow("army", 3, { attr: { education: 2 } }));
  it("row 4 → Gun", () => assertWeaponRow("army", 4));
  it("row 5 → High Psg", () => assertRow("army", 5, { benefit: "High Passage" }));
  it("row 6 → Mid Psg", () => assertRow("army", 6, { benefit: "Mid Passage" }));
  it("row 7 → +1 Social (rank 5/6 only)", () => assertRow("army", 7, {
    attr: { social: 1 },
  }));
});

describe("Scouts Material Benefits (TTB p. 24)", () => {
  it("row 1 → Low Psg", () => assertRow("scouts", 1, { benefit: "Low Passage" }));
  it("row 2 → +2 Intel", () => assertRow("scouts", 2, { attr: { intelligence: 2 } }));
  it("row 3 → +2 Educ", () => assertRow("scouts", 3, { attr: { education: 2 } }));
  it("row 4 → Blade", () => assertWeaponRow("scouts", 4));
  it("row 5 → Gun", () => assertWeaponRow("scouts", 5));
  it("row 6 → Scout Ship", () => {
    const got = rowFor("scouts", 6);
    expect(got.benefits).toEqual(["Scout Ship"]);
    expect(got.ship).toBe(true);
  });
  it("row 7 → no benefit (—, unreachable, no rank in Scouts)", () => {
    assertRow("scouts", 7, { noop: true });
  });
});

describe("Merchants Material Benefits (TTB p. 24)", () => {
  it("row 1 → Low Psg", () => assertRow("merchants", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("merchants", 2, { attr: { intelligence: 1 } }));
  it("row 3 → +1 Educ", () => assertRow("merchants", 3, { attr: { education: 1 } }));
  it("row 4 → Gun", () => assertWeaponRow("merchants", 4));
  it("row 5 → Blade", () => assertWeaponRow("merchants", 5));
  it("row 6 → Low Psg", () => assertRow("merchants", 6, { benefit: "Low Passage" }));
  it("row 7 → Free Trader (rank 5 only)", () => {
    const got = rowFor("merchants", 7);
    expect(got.benefits).toEqual(["Free Trader"]);
    expect(got.ship).toBe(true);
  });
});

describe("Other Material Benefits (TTB p. 24)", () => {
  it("row 1 → Low Psg", () => assertRow("other", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("other", 2, { attr: { intelligence: 1 } }));
  it("row 3 → +1 Educ", () => assertRow("other", 3, { attr: { education: 1 } }));
  it("row 4 → Gun", () => assertWeaponRow("other", 4));
  it("row 5 → High Psg", () => assertRow("other", 5, { benefit: "High Passage" }));
  it("row 6 → no benefit (—)", () => assertRow("other", 6, { noop: true }));
  it("row 7 → no benefit (—, unreachable, no rank in Other)", () => {
    assertRow("other", 7, { noop: true });
  });
});

// ============================================================================
// CotI Material Benefits — page 6
// Column order: Pirate / Belter / Sailor / Diplomat / Doctor / Flyer
// ============================================================================

describe("Pirates Material Benefits (CotI p. 6)", () => {
  it("row 1 → Low Psg", () => assertRow("pirates", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("pirates", 2, { attr: { intelligence: 1 } }));
  it("row 3 → Weapon", () => assertWeaponRow("pirates", 3));
  it("row 4 → no benefit (—)", () => assertRow("pirates", 4, { noop: true }));
  it("row 5 → -1 Social", () => assertRow("pirates", 5, { attr: { social: -1 } }));
  it("row 6 → Mid Psg", () => assertRow("pirates", 6, { benefit: "Mid Passage" }));
  it("row 7 → Corsair (rank 5/6 only)", () => {
    const got = rowFor("pirates", 7);
    expect(got.benefits).toEqual(["Corsair"]);
    expect(got.ship).toBe(true);
  });
});

describe("Belters Material Benefits (CotI p. 6)", () => {
  it("row 1 → Low Psg", () => assertRow("belters", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("belters", 2, { attr: { intelligence: 1 } }));
  it("row 3 → Weapon", () => assertWeaponRow("belters", 3));
  it("row 4 → High Psg", () => assertRow("belters", 4, { benefit: "High Passage" }));
  it("row 5 → Travellers'", () => assertRow("belters", 5, {
    benefit: "Travellers' Aid Society", TAS: true,
  }));
  it("row 6 → Seeker", () => {
    const got = rowFor("belters", 6);
    expect(got.benefits).toEqual(["Seeker"]);
    expect(got.ship).toBe(true);
  });
  it("row 7 → no benefit (—, unreachable, Belters have no ranks)", () => {
    assertRow("belters", 7, { noop: true });
  });
});

describe("Sailors Material Benefits (CotI p. 6)", () => {
  it("row 1 → Low Psg", () => assertRow("sailors", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Educ", () => assertRow("sailors", 2, { attr: { education: 1 } }));
  it("row 3 → Weapon", () => assertWeaponRow("sailors", 3));
  it("row 4 → Weapon", () => assertWeaponRow("sailors", 4));
  it("row 5 → High Psg", () => assertRow("sailors", 5, { benefit: "High Passage" }));
  it("row 6 → High Psg", () => assertRow("sailors", 6, { benefit: "High Passage" }));
  it("row 7 → +1 Social (rank 5/6 only)", () => assertRow("sailors", 7, {
    attr: { social: 1 },
  }));
});

describe("Diplomats Material Benefits (CotI p. 6)", () => {
  it("row 1 → Low Psg", () => assertRow("diplomats", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Intel", () => assertRow("diplomats", 2, { attr: { intelligence: 1 } }));
  it("row 3 → +2 Educ", () => assertRow("diplomats", 3, { attr: { education: 2 } }));
  it("row 4 → Weapon", () => assertWeaponRow("diplomats", 4));
  it("row 5 → +1 Social", () => assertRow("diplomats", 5, { attr: { social: 1 } }));
  it("row 6 → High Psg", () => assertRow("diplomats", 6, { benefit: "High Passage" }));
  it("row 7 → Travellers' (rank 5/6 only)", () => assertRow("diplomats", 7, {
    benefit: "Travellers' Aid Society", TAS: true,
  }));
});

describe("Doctors Material Benefits (CotI p. 6)", () => {
  it("row 1 → Low Psg", () => assertRow("doctors", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Educ", () => assertRow("doctors", 2, { attr: { education: 1 } }));
  it("row 3 → +1 Educ", () => assertRow("doctors", 3, { attr: { education: 1 } }));
  it("row 4 → Weapon", () => assertWeaponRow("doctors", 4));
  it("row 5 → Instruments", () => assertRow("doctors", 5, { benefit: "Instruments" }));
  it("row 6 → Mid Psg", () => assertRow("doctors", 6, { benefit: "Mid Passage" }));
  it("row 7 → no benefit (—, unreachable, Doctors have no ranks)", () => {
    assertRow("doctors", 7, { noop: true });
  });
});

describe("Flyers Material Benefits (CotI p. 6)", () => {
  it("row 1 → Low Psg", () => assertRow("flyers", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Educ", () => assertRow("flyers", 2, { attr: { education: 1 } }));
  it("row 3 → Weapon", () => assertWeaponRow("flyers", 3));
  it("row 4 → Weapon", () => assertWeaponRow("flyers", 4));
  it("row 5 → High Psg", () => assertRow("flyers", 5, { benefit: "High Passage" }));
  it("row 6 → Mid Psg", () => assertRow("flyers", 6, { benefit: "Mid Passage" }));
  it("row 7 → +1 Social (rank 5/6 only)", () => assertRow("flyers", 7, {
    attr: { social: 1 },
  }));
});

// ============================================================================
// CotI Material Benefits — page 8
// Column order: Barbarian / Bureaucrat / Rogue / Noble / Scientist / Hunter
// ============================================================================

describe("Barbarians Material Benefits (CotI p. 8)", () => {
  it("row 1 → Low Psg", () => assertRow("barbarians", 1, { benefit: "Low Passage" }));
  it("row 2 → Blade", () => assertWeaponRow("barbarians", 2));
  it("row 3 → Blade", () => assertWeaponRow("barbarians", 3));
  it("row 4 → Blade", () => assertWeaponRow("barbarians", 4));
  it("row 5 → no benefit (—)", () => assertRow("barbarians", 5, { noop: true }));
  it("row 6 → High Psg", () => assertRow("barbarians", 6, { benefit: "High Passage" }));
  it("row 7 → High Psg (rank 5 only)", () => assertRow("barbarians", 7, {
    benefit: "High Passage",
  }));
});

describe("Bureaucrats Material Benefits (CotI p. 8)", () => {
  it("row 1 → Low Psg", () => assertRow("bureaucrats", 1, { benefit: "Low Passage" }));
  it("row 2 → Mid Psg", () => assertRow("bureaucrats", 2, { benefit: "Mid Passage" }));
  it("row 3 → no benefit (—)", () => assertRow("bureaucrats", 3, { noop: true }));
  it("row 4 → Watch", () => assertRow("bureaucrats", 4, { benefit: "Watch" }));
  it("row 5 → no benefit (—)", () => assertRow("bureaucrats", 5, { noop: true }));
  it("row 6 → High Psg", () => assertRow("bureaucrats", 6, { benefit: "High Passage" }));
  it("row 7 → +1 Social (rank 5/6 only)", () => assertRow("bureaucrats", 7, {
    attr: { social: 1 },
  }));
});

describe("Rogues Material Benefits (CotI p. 8)", () => {
  it("row 1 → Low Psg", () => assertRow("rogues", 1, { benefit: "Low Passage" }));
  it("row 2 → +1 Social", () => assertRow("rogues", 2, { attr: { social: 1 } }));
  it("row 3 → Gun", () => assertWeaponRow("rogues", 3));
  it("row 4 → Blade", () => assertWeaponRow("rogues", 4));
  it("row 5 → High Psg", () => assertRow("rogues", 5, { benefit: "High Passage" }));
  it("row 6 → Travellers'", () => assertRow("rogues", 6, {
    benefit: "Travellers' Aid Society", TAS: true,
  }));
  it("row 7 → no benefit (—, unreachable, Rogues have no ranks)", () => {
    assertRow("rogues", 7, { noop: true });
  });
});

describe("Nobles Material Benefits (CotI p. 8)", () => {
  it("row 1 → High Psg", () => assertRow("nobles", 1, { benefit: "High Passage" }));
  it("row 2 → High Psg", () => assertRow("nobles", 2, { benefit: "High Passage" }));
  it("row 3 → Gun", () => assertWeaponRow("nobles", 3));
  it("row 4 → Blade", () => assertWeaponRow("nobles", 4));
  it("row 5 → Travellers'", () => assertRow("nobles", 5, {
    benefit: "Travellers' Aid Society", TAS: true,
  }));
  it("row 6 → Yacht", () => {
    const got = rowFor("nobles", 6);
    expect(got.benefits).toEqual(["Yacht"]);
    expect(got.ship).toBe(true);
  });
  it("row 7 → no benefit (—)", () => assertRow("nobles", 7, { noop: true }));
});

describe("Scientists Material Benefits (CotI p. 8)", () => {
  it("row 1 → Low Psg", () => assertRow("scientists", 1, { benefit: "Low Passage" }));
  it("row 2 → Mid Psg", () => assertRow("scientists", 2, { benefit: "Mid Passage" }));
  it("row 3 → High Psg", () => assertRow("scientists", 3, { benefit: "High Passage" }));
  it("row 4 → +1 Social", () => assertRow("scientists", 4, { attr: { social: 1 } }));
  it("row 5 → Gun", () => assertWeaponRow("scientists", 5));
  it("row 6 → Lab Ship", () => {
    const got = rowFor("scientists", 6);
    expect(got.benefits).toEqual(["Lab Ship"]);
    expect(got.ship).toBe(true);
  });
  it("row 7 → no benefit (—, unreachable, Scientists have no ranks)", () => {
    assertRow("scientists", 7, { noop: true });
  });
});

describe("Hunters Material Benefits (CotI p. 8)", () => {
  it("row 1 → Low Psg", () => assertRow("hunters", 1, { benefit: "Low Passage" }));
  it("row 2 → High Psg", () => assertRow("hunters", 2, { benefit: "High Passage" }));
  it("row 3 → Weapon", () => assertWeaponRow("hunters", 3));
  it("row 4 → Weapon", () => assertWeaponRow("hunters", 4));
  it("row 5 → Weapon", () => assertWeaponRow("hunters", 5));
  it("row 6 → Safari Ship", () => {
    const got = rowFor("hunters", 6);
    expect(got.benefits).toEqual(["Safari Ship"]);
    expect(got.ship).toBe(true);
  });
  it("row 7 → no benefit (—, unreachable, Hunters have no ranks)", () => {
    assertRow("hunters", 7, { noop: true });
  });
});
