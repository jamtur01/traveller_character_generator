// Explicit cell-by-cell assertions for the service tables. These exist
// alongside the comprehensive `services.snapshot.test.ts` file so a human
// reviewer can read this file side-by-side with the rulebook and verify
// values without having to inspect snapshot JSON.
//
// Page references: TTB (The Traveller Book, 1982) and CotI (Supplement 4:
// Citizens of the Imperium).

import { describe, expect, it } from "vitest";
import {
  DRAFT_SERVICES, s, SERVICES, type Attributes,
} from "../../lib/traveller";

// ============================================================================
// TTB Prior Service Table — page 24
// ============================================================================

describe("TTB throws & DMs (page 24)", () => {
  it("Navy: enlist 8+, surv 5+, comm 10+, prom 8+, reenlist 6+", () => {
    expect(s.navy.enlistmentThrow).toBe(8);
    expect(s.navy.survivalThrow).toBe(5);
    expect(s.navy.commissionThrow).toBe(10);
    expect(s.navy.promotionThrow).toBe(8);
    expect(s.navy.reenlistThrow).toBe(6);
  });
  it("Navy enlistment DM: Int 8+ → +1, Edu 9+ → +2", () => {
    expect(s.navy.enlistmentDM(attrs({ intelligence: 7 }))).toBe(0);
    expect(s.navy.enlistmentDM(attrs({ intelligence: 8 }))).toBe(1);
    expect(s.navy.enlistmentDM(attrs({ education: 8 }))).toBe(0);
    expect(s.navy.enlistmentDM(attrs({ education: 9 }))).toBe(2);
    expect(s.navy.enlistmentDM(attrs({ intelligence: 8, education: 9 }))).toBe(3);
  });

  it("Marines: enlist 9+, surv 6+, comm 9+, prom 9+, reenlist 6+", () => {
    expect(s.marines.enlistmentThrow).toBe(9);
    expect(s.marines.survivalThrow).toBe(6);
    expect(s.marines.commissionThrow).toBe(9);
    expect(s.marines.promotionThrow).toBe(9);
    expect(s.marines.reenlistThrow).toBe(6);
  });
  it("Marines enlistment DM: Int 8+ → +1, Stren 8+ → +2", () => {
    expect(s.marines.enlistmentDM(attrs({ intelligence: 8 }))).toBe(1);
    expect(s.marines.enlistmentDM(attrs({ strength: 8 }))).toBe(2);
  });

  it("Army: enlist 5+, surv 5+, comm 5+, prom 6+, reenlist 7+", () => {
    expect(s.army.enlistmentThrow).toBe(5);
    expect(s.army.survivalThrow).toBe(5);
    expect(s.army.commissionThrow).toBe(5);
    expect(s.army.promotionThrow).toBe(6);
    expect(s.army.reenlistThrow).toBe(7);
  });
  it("Army enlistment DM: Dex 6+ → +1, Endur 5+ → +2", () => {
    expect(s.army.enlistmentDM(attrs({ dexterity: 6 }))).toBe(1);
    expect(s.army.enlistmentDM(attrs({ endurance: 5 }))).toBe(2);
  });

  it("Scouts: enlist 7+, surv 7+, no comm/prom, reenlist 3+", () => {
    expect(s.scouts.enlistmentThrow).toBe(7);
    expect(s.scouts.survivalThrow).toBe(7);
    expect(s.scouts.commissionThrow).toBeUndefined();
    expect(s.scouts.promotionThrow).toBeUndefined();
    expect(s.scouts.reenlistThrow).toBe(3);
  });
  it("Scouts enlistment DM: Int 6+ → +1, Stren 8+ → +2", () => {
    expect(s.scouts.enlistmentDM(attrs({ intelligence: 6 }))).toBe(1);
    expect(s.scouts.enlistmentDM(attrs({ strength: 8 }))).toBe(2);
  });

  it("Merchants: enlist 7+, surv 5+, comm 4+, prom 10+, reenlist 4+", () => {
    expect(s.merchants.enlistmentThrow).toBe(7);
    expect(s.merchants.survivalThrow).toBe(5);
    expect(s.merchants.commissionThrow).toBe(4);
    expect(s.merchants.promotionThrow).toBe(10);
    expect(s.merchants.reenlistThrow).toBe(4);
  });
  it("Merchants enlistment DM: Stren 7+ → +1, Int 6+ → +2", () => {
    expect(s.merchants.enlistmentDM(attrs({ strength: 7 }))).toBe(1);
    expect(s.merchants.enlistmentDM(attrs({ intelligence: 6 }))).toBe(2);
  });

  it("Other: enlist 3+, surv 5+, no comm/prom, reenlist 5+, no enlist DMs", () => {
    expect(s.other.enlistmentThrow).toBe(3);
    expect(s.other.survivalThrow).toBe(5);
    expect(s.other.commissionThrow).toBeUndefined();
    expect(s.other.promotionThrow).toBeUndefined();
    expect(s.other.reenlistThrow).toBe(5);
    expect(s.other.enlistmentDM(attrs({}))).toBe(0);
    expect(s.other.enlistmentDM(attrs({ intelligence: 15 }))).toBe(0);
  });
});

// ============================================================================
// TTB Cash Table — page 24
// ============================================================================

describe("TTB cash tables (page 24)", () => {
  it("Navy:      1000 / 5000 / 5000 / 10000 / 20000 / 50000 / 50000", () => {
    expect(s.navy.musterCash).toEqual(
      { 1: 1000, 2: 5000, 3: 5000, 4: 10000, 5: 20000, 6: 50000, 7: 50000 });
  });
  it("Marines:   2000 / 5000 / 5000 / 10000 / 20000 / 30000 / 40000", () => {
    expect(s.marines.musterCash).toEqual(
      { 1: 2000, 2: 5000, 3: 5000, 4: 10000, 5: 20000, 6: 30000, 7: 40000 });
  });
  it("Army:      2000 / 5000 / 10000 / 10000 / 10000 / 20000 / 30000", () => {
    expect(s.army.musterCash).toEqual(
      { 1: 2000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 20000, 7: 30000 });
  });
  it("Scouts:    20000 / 20000 / 30000 / 30000 / 50000 / 50000 / 50000", () => {
    expect(s.scouts.musterCash).toEqual(
      { 1: 20000, 2: 20000, 3: 30000, 4: 30000, 5: 50000, 6: 50000, 7: 50000 });
  });
  it("Merchants: 1000 / 5000 / 10000 / 20000 / 20000 / 40000 / 40000", () => {
    expect(s.merchants.musterCash).toEqual(
      { 1: 1000, 2: 5000, 3: 10000, 4: 20000, 5: 20000, 6: 40000, 7: 40000 });
  });
  it("Other:     1000 / 5000 / 10000 / 10000 / 10000 / 50000 / 100000", () => {
    expect(s.other.musterCash).toEqual(
      { 1: 1000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 50000, 7: 100000 });
  });
});

// ============================================================================
// TTB Table of Ranks — page 24
// ============================================================================

describe("TTB rank tables (page 24)", () => {
  it("Navy: Ensign, Lieutenant, Lt Cmdr, Commander, Captain, Admiral", () => {
    expect(s.navy.ranks[1]).toBe("Ensign");
    expect(s.navy.ranks[2]).toBe("Lieutenant");
    expect(s.navy.ranks[3]).toBe("Lt Cmdr");
    expect(s.navy.ranks[4]).toBe("Commander");
    expect(s.navy.ranks[5]).toBe("Captain");
    expect(s.navy.ranks[6]).toBe("Admiral");
  });
  it("Marines: Lt, Captain, Force Cmdr, Lt Colonel, Colonel, Brigadier", () => {
    expect(s.marines.ranks[1]).toBe("Lieutenant");
    expect(s.marines.ranks[2]).toBe("Captain");
    expect(s.marines.ranks[3]).toBe("Force Cmdr");
    expect(s.marines.ranks[4]).toBe("Lt Colonel");
    expect(s.marines.ranks[5]).toBe("Colonel");
    expect(s.marines.ranks[6]).toBe("Brigadier");
  });
  it("Army: Lt, Captain, Major, Lt Colonel, Colonel, General", () => {
    expect(s.army.ranks[1]).toBe("Lieutenant");
    expect(s.army.ranks[2]).toBe("Captain");
    expect(s.army.ranks[3]).toBe("Major");
    expect(s.army.ranks[4]).toBe("Lt Colonel");
    expect(s.army.ranks[5]).toBe("Colonel");
    expect(s.army.ranks[6]).toBe("General");
  });
  it("Merchants: 4th/3rd/2nd/1st Officer, Captain", () => {
    expect(s.merchants.ranks[1]).toBe("4th Officer");
    expect(s.merchants.ranks[2]).toBe("3rd Officer");
    expect(s.merchants.ranks[3]).toBe("2nd Officer");
    expect(s.merchants.ranks[4]).toBe("1st Officer");
    expect(s.merchants.ranks[5]).toBe("Captain");
  });
  it("Scouts and Other: no ranks", () => {
    for (const r of [1, 2, 3, 4, 5, 6]) {
      expect(s.scouts.ranks[r]).toBe("");
      expect(s.other.ranks[r]).toBe("");
    }
  });
  it("TTB services have no rank 0 label (uncommissioned = no title)", () => {
    for (const k of [
      "navy", "marines", "army", "scouts", "merchants", "other",
    ] as const) {
      expect(s[k].ranks[0]).toBe("");
    }
  });
  it("Merchants rank 6 has no canonical name in TTB", () => {
    expect(s.merchants.ranks[6]).toBe("");
  });
});

// ============================================================================
// TTB Rank & Service Skills — page 25
// ============================================================================

describe("TTB automatic / rank skills (page 25)", () => {
  it("Marines start with Cutlass-1", () => {
    expect(s.marines.getServiceSkills(stub)).toEqual(["Cutlass"]);
  });
  it("Army starts with Rifle-1", () => {
    expect(s.army.getServiceSkills(stub)).toEqual(["Rifle"]);
  });
  it("Scouts start with Pilot-1", () => {
    expect(s.scouts.getServiceSkills(stub)).toEqual(["Pilot"]);
  });
  it("Navy, Merchants, Other have no automatic service skill", () => {
    expect(s.navy.getServiceSkills(stub)).toEqual([]);
    expect(s.merchants.getServiceSkills(stub)).toEqual([]);
    expect(s.other.getServiceSkills(stub)).toEqual([]);
  });
});

// ============================================================================
// CotI Prior Service Table — pages 6-7 / 13
// ============================================================================

describe("CotI throws & DMs (pages 6-7, 13)", () => {
  it("Pirates: enlist 7+, surv 6+, comm 9+, prom 8+, reenlist 7+", () => {
    expect(s.pirates.enlistmentThrow).toBe(7);
    expect(s.pirates.survivalThrow).toBe(6);
    expect(s.pirates.commissionThrow).toBe(9);
    expect(s.pirates.promotionThrow).toBe(8);
    expect(s.pirates.reenlistThrow).toBe(7);
  });
  it("Belters: enlist 8+, surv 9+, no comm/prom, reenlist 7+", () => {
    expect(s.belters.enlistmentThrow).toBe(8);
    expect(s.belters.survivalThrow).toBe(9);
    expect(s.belters.commissionThrow).toBeUndefined();
    expect(s.belters.promotionThrow).toBeUndefined();
    expect(s.belters.reenlistThrow).toBe(7);
  });
  it("Belters enlistment DM: Dex 9+ → +1, Int 6+ → +2", () => {
    expect(s.belters.enlistmentDM(attrs({ dexterity: 9 }))).toBe(1);
    expect(s.belters.enlistmentDM(attrs({ intelligence: 6 }))).toBe(2);
  });

  it("Sailors: enlist 6+, surv 5+, comm 5+, prom 6+, reenlist 6+", () => {
    expect(s.sailors.enlistmentThrow).toBe(6);
    expect(s.sailors.survivalThrow).toBe(5);
    expect(s.sailors.commissionThrow).toBe(5);
    expect(s.sailors.promotionThrow).toBe(6);
    expect(s.sailors.reenlistThrow).toBe(6);
  });

  it("Diplomats: enlist 8+, surv 3+, comm 5+, prom 10+, reenlist 5+", () => {
    expect(s.diplomats.enlistmentThrow).toBe(8);
    expect(s.diplomats.survivalThrow).toBe(3);
    expect(s.diplomats.commissionThrow).toBe(5);
    expect(s.diplomats.promotionThrow).toBe(10);
    expect(s.diplomats.reenlistThrow).toBe(5);
  });

  it("Doctors: enlist 9+, surv 3+, no comm/prom, reenlist 4+", () => {
    expect(s.doctors.enlistmentThrow).toBe(9);
    expect(s.doctors.survivalThrow).toBe(3);
    expect(s.doctors.commissionThrow).toBeUndefined();
    expect(s.doctors.promotionThrow).toBeUndefined();
    expect(s.doctors.reenlistThrow).toBe(4);
  });

  it("Flyers: enlist 6+, surv 5+, comm 5+, prom 8+, reenlist 6+", () => {
    expect(s.flyers.enlistmentThrow).toBe(6);
    expect(s.flyers.survivalThrow).toBe(5);
    expect(s.flyers.commissionThrow).toBe(5);
    expect(s.flyers.promotionThrow).toBe(8);
    expect(s.flyers.reenlistThrow).toBe(6);
  });

  it("Barbarians: enlist 5+, surv 6+, comm 6+, prom 9+, reenlist 6+", () => {
    expect(s.barbarians.enlistmentThrow).toBe(5);
    expect(s.barbarians.survivalThrow).toBe(6);
    expect(s.barbarians.commissionThrow).toBe(6);
    expect(s.barbarians.promotionThrow).toBe(9);
    expect(s.barbarians.reenlistThrow).toBe(6);
  });

  it("Bureaucrats: enlist 5+, surv 4+, comm 6+, prom 7+, reenlist 3+ INVERSE", () => {
    expect(s.bureaucrats.enlistmentThrow).toBe(5);
    expect(s.bureaucrats.survivalThrow).toBe(4);
    expect(s.bureaucrats.commissionThrow).toBe(6);
    expect(s.bureaucrats.promotionThrow).toBe(7);
    expect(s.bureaucrats.reenlistThrow).toBe(3);
    expect(s.bureaucrats.inverseReenlist).toBe(true);
  });

  it("Rogues: enlist 6+, surv 6+, no comm/prom, reenlist 5+", () => {
    expect(s.rogues.enlistmentThrow).toBe(6);
    expect(s.rogues.survivalThrow).toBe(6);
    expect(s.rogues.commissionThrow).toBeUndefined();
    expect(s.rogues.promotionThrow).toBeUndefined();
    expect(s.rogues.reenlistThrow).toBe(5);
  });

  it("Scientists: enlist 6+, surv 5+, no comm/prom, reenlist 5+", () => {
    expect(s.scientists.enlistmentThrow).toBe(6);
    expect(s.scientists.survivalThrow).toBe(5);
    expect(s.scientists.commissionThrow).toBeUndefined();
    expect(s.scientists.promotionThrow).toBeUndefined();
    expect(s.scientists.reenlistThrow).toBe(5);
  });

  it("Hunters: enlist 9+, surv 6+, no comm/prom, reenlist 5+", () => {
    expect(s.hunters.enlistmentThrow).toBe(9);
    expect(s.hunters.survivalThrow).toBe(6);
    expect(s.hunters.commissionThrow).toBeUndefined();
    expect(s.hunters.promotionThrow).toBeUndefined();
    expect(s.hunters.reenlistThrow).toBe(5);
  });

  it("Nobles: surv 3+, comm 5+, prom 12+, reenlist 4+", () => {
    expect(s.nobles.survivalThrow).toBe(3);
    expect(s.nobles.commissionThrow).toBe(5);
    expect(s.nobles.promotionThrow).toBe(12);
    expect(s.nobles.reenlistThrow).toBe(4);
  });
});

// ============================================================================
// CotI Cash Tables — pages 7, 13
// ============================================================================

describe("CotI cash tables (pages 7, 13)", () => {
  it("Pirates:     0 / 0 / 1k / 10k / 50k / 50k / 50k", () => {
    expect(s.pirates.musterCash).toEqual(
      { 1: 0, 2: 0, 3: 1000, 4: 10000, 5: 50000, 6: 50000, 7: 50000 });
  });
  it("Belters:     0 / 0 / 1k / 10k / 100k / 100k / 100k", () => {
    expect(s.belters.musterCash).toEqual(
      { 1: 0, 2: 0, 3: 1000, 4: 10000, 5: 100000, 6: 100000, 7: 100000 });
  });
  it("Sailors:     2k / 5k / 10k / 10k / 10k / 20k / 30k", () => {
    expect(s.sailors.musterCash).toEqual(
      { 1: 2000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 20000, 7: 30000 });
  });
  it("Diplomats:   10k / 10k / 10k / 20k / 50k / 60k / 70k", () => {
    expect(s.diplomats.musterCash).toEqual(
      { 1: 10000, 2: 10000, 3: 10000, 4: 20000, 5: 50000, 6: 60000, 7: 70000 });
  });
  it("Doctors:     20k / 20k / 20k / 30k / 40k / 60k / 100k", () => {
    expect(s.doctors.musterCash).toEqual(
      { 1: 20000, 2: 20000, 3: 20000, 4: 30000, 5: 40000, 6: 60000, 7: 100000 });
  });
  it("Flyers:      2k / 5k / 10k / 10k / 10k / 20k / 30k", () => {
    expect(s.flyers.musterCash).toEqual(
      { 1: 2000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 20000, 7: 30000 });
  });
  it("Barbarians:  0 / 0 / 1k / 2k / 3k / 4k / 5k", () => {
    expect(s.barbarians.musterCash).toEqual(
      { 1: 0, 2: 0, 3: 1000, 4: 2000, 5: 3000, 6: 4000, 7: 5000 });
  });
  it("Bureaucrats: 0 / 0 / 10k / 10k / 40k / 40k / 80k", () => {
    expect(s.bureaucrats.musterCash).toEqual(
      { 1: 0, 2: 0, 3: 10000, 4: 10000, 5: 40000, 6: 40000, 7: 80000 });
  });
  it("Rogues:      0 / 0 / 10k / 10k / 50k / 100k / 100k", () => {
    expect(s.rogues.musterCash).toEqual(
      { 1: 0, 2: 0, 3: 10000, 4: 10000, 5: 50000, 6: 100000, 7: 100000 });
  });
  it("Scientists:  1k / 2k / 5k / 10k / 20k / 30k / 40k", () => {
    expect(s.scientists.musterCash).toEqual(
      { 1: 1000, 2: 2000, 3: 5000, 4: 10000, 5: 20000, 6: 30000, 7: 40000 });
  });
  it("Hunters:     1k / 1k / 5k / 5k / 10k / 100k / 100k", () => {
    expect(s.hunters.musterCash).toEqual(
      { 1: 1000, 2: 1000, 3: 5000, 4: 5000, 5: 10000, 6: 100000, 7: 100000 });
  });
  it("Nobles:      10k / 50k / 50k / 100k / 100k / 100k / 200k", () => {
    expect(s.nobles.musterCash).toEqual(
      { 1: 10000, 2: 50000, 3: 50000, 4: 100000, 5: 100000, 6: 100000, 7: 200000 });
  });
});

// ============================================================================
// CotI rank labels (pages 7, 13)
// ============================================================================

describe("CotI rank labels (pages 7, 13)", () => {
  it("Pirates: Henchman → Leader (rank 6 unused)", () => {
    expect(s.pirates.ranks[1]).toBe("Henchman");
    expect(s.pirates.ranks[2]).toBe("Corporal");
    expect(s.pirates.ranks[3]).toBe("Sergeant");
    expect(s.pirates.ranks[4]).toBe("Lieutenant");
    expect(s.pirates.ranks[5]).toBe("Leader");
    expect(s.pirates.ranks[6]).toBe("");
  });
  it("Sailors: Ensign → Admiral", () => {
    expect(s.sailors.ranks[1]).toBe("Ensign");
    expect(s.sailors.ranks[2]).toBe("Lieutenant");
    expect(s.sailors.ranks[3]).toBe("Lt Cmdr");
    expect(s.sailors.ranks[4]).toBe("Commander");
    expect(s.sailors.ranks[5]).toBe("Captain");
    expect(s.sailors.ranks[6]).toBe("Admiral");
  });
  it("Diplomats: 3d Secretary → Ambassador", () => {
    expect(s.diplomats.ranks[1]).toBe("3d Secretary");
    expect(s.diplomats.ranks[2]).toBe("2d Secretary");
    expect(s.diplomats.ranks[3]).toBe("1st Secretary");
    expect(s.diplomats.ranks[4]).toBe("Counselor");
    expect(s.diplomats.ranks[5]).toBe("Minister");
    expect(s.diplomats.ranks[6]).toBe("Ambassador");
  });
  it("Flyers: Pilot → Air Marshal", () => {
    expect(s.flyers.ranks[1]).toBe("Pilot");
    expect(s.flyers.ranks[2]).toBe("Flight Leader");
    expect(s.flyers.ranks[3]).toBe("Sqdrn Leader");
    expect(s.flyers.ranks[4]).toBe("Staff Major");
    expect(s.flyers.ranks[5]).toBe("Group Leader");
    expect(s.flyers.ranks[6]).toBe("Air Marshal");
  });
  it("Barbarians: only rank 2 (Warrior) and rank 5 (Chief) carry a title", () => {
    expect(s.barbarians.ranks[0]).toBe("");
    expect(s.barbarians.ranks[1]).toBe("");
    expect(s.barbarians.ranks[2]).toBe("Warrior");
    expect(s.barbarians.ranks[3]).toBe("");
    expect(s.barbarians.ranks[4]).toBe("");
    expect(s.barbarians.ranks[5]).toBe("Chief");
    expect(s.barbarians.ranks[6]).toBe("");
  });
  it("Bureaucrats: Clerk → Director", () => {
    expect(s.bureaucrats.ranks[1]).toBe("Clerk");
    expect(s.bureaucrats.ranks[2]).toBe("Supervisor");
    expect(s.bureaucrats.ranks[3]).toBe("Asst Manager");
    expect(s.bureaucrats.ranks[4]).toBe("Manager");
    expect(s.bureaucrats.ranks[5]).toBe("Executive");
    expect(s.bureaucrats.ranks[6]).toBe("Director");
  });
  it("Nobles: B Knight → F Duke (rank 0 & 6 blank)", () => {
    expect(s.nobles.ranks[0]).toBe("");
    expect(s.nobles.ranks[1]).toBe("B Knight");
    expect(s.nobles.ranks[2]).toBe("C Baron");
    expect(s.nobles.ranks[3]).toBe("D Marquis");
    expect(s.nobles.ranks[4]).toBe("E Count");
    expect(s.nobles.ranks[5]).toBe("F Duke");
    expect(s.nobles.ranks[6]).toBe("");
  });
  it("Belters, Doctors, Rogues, Scientists, Hunters: no ranks", () => {
    for (const svc of ["belters", "doctors", "rogues", "scientists", "hunters"] as const) {
      for (const r of [1, 2, 3, 4, 5, 6]) {
        expect(s[svc].ranks[r]).toBe("");
      }
    }
  });
});

// ============================================================================
// Service catalog integrity
// ============================================================================

describe("service catalog", () => {
  it("every key in SERVICES has a definition", () => {
    for (const k of SERVICES) expect(s[k]).toBeDefined();
  });
  it("DRAFT_SERVICES is the six TTB-canonical draft careers", () => {
    expect(DRAFT_SERVICES).toEqual([
      "navy", "marines", "army", "scouts", "merchants", "other",
    ]);
  });
  it("SERVICES does not include 'nobles' (handled by auto-enroll path)", () => {
    expect(SERVICES).not.toContain("nobles");
  });
});

// ============================================================================
// helpers
// ============================================================================

function attrs(overrides: Partial<Attributes>): Attributes {
  return {
    strength: 0, dexterity: 0, endurance: 0,
    intelligence: 0, education: 0, social: 0,
    ...overrides,
  };
}

const stub = { skills: [] } as unknown as Parameters<typeof s.navy.getServiceSkills>[0];
