// Cascade-skills audit against TTB (CT) and MT PM.
//
// CT cascades come from TTB p. 25 (Cascade Skills section). The
// existing tests/audit/ct.cascades.audit.test.ts checks 6 things;
// this file adds explicit cell-for-cell verification against TTB.
//
// MT cascades are scattered across the PM (gun/blade combat tables,
// vehicle tables, etc.). Includes-skills (MT only) expand a single
// printed cell into multiple constituent skills.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

describe("CT cascade skills (TTB p. 25)", () => {
  const cs = getEdition("ct-classic").data.cascadeSkills as
    Record<string, string[] | string>;

  it("Blade Combat: Dagger/Blade/Foil/Sword/Cutlass/Broadsword/Bayonet/Spear/Halberd/Pike/Cudgel (CotI p. 10)", () => {
    expect(cs.bladeCombat).toEqual([
      "Dagger", "Blade", "Foil", "Sword", "Cutlass", "Broadsword",
      "Bayonet", "Spear", "Halberd", "Pike", "Cudgel",
    ]);
  });

  it("Gun Combat: Body Pistol/Auto Pistol/Revolver/Carbine/Rifle/Auto Rifle/Shotgun/SMG/Laser Carbine/Laser Rifle", () => {
    expect(cs.gunCombat).toEqual([
      "Body Pistol", "Auto Pistol", "Revolver", "Carbine", "Rifle",
      "Auto Rifle", "Shotgun", "SMG", "Laser Carbine", "Laser Rifle",
    ]);
  });

  it("Vehicle: includes aircraft (3) + ground (3) + watercraft (4)", () => {
    const v = cs.vehicle as string[];
    expect(v).toEqual(expect.arrayContaining([
      "Prop-driven Fixed Wing", "Jet-driven Fixed Wing", "Helicopter",
      "Grav Vehicle", "Tracked Vehicle", "Wheeled Vehicle",
      "Large Watercraft", "Small Watercraft", "Hovercraft", "Submersible",
    ]));
    expect(v.length).toBe(10);
  });

  it("Aircraft: 4 CotI Air Craft categories (Prop / Jet / Helicopter / Grav Vehicle, CotI p. 12)", () => {
    expect(cs.aircraft).toEqual([
      "Prop-driven Fixed Wing", "Jet-driven Fixed Wing", "Helicopter", "Grav Vehicle",
    ]);
  });

  it("Watercraft: 4 entries (Large / Small / Hovercraft / Submersible)", () => {
    expect(cs.watercraft).toEqual([
      "Large Watercraft", "Small Watercraft", "Hovercraft", "Submersible",
    ]);
  });

  it("Bow Combat: Sling/Short/Long Bow + 3 Crossbow variants", () => {
    expect(cs.bowCombat).toEqual([
      "Sling", "Short Bow", "Long Bow",
      "Sporting Crossbow", "Military Crossbow", "Repeating Crossbow",
    ]);
  });
});

describe("MT cascade skills (PM tables)", () => {
  const cs = getEdition("mt-megatraveller").data.cascadeSkills as
    Record<string, string[] | string>;

  it("Blade Combat: Axe/Cudgel/Foil/Large Blade/Polearm/Small Blade", () => {
    expect(cs.bladeCombat).toEqual(expect.arrayContaining([
      "Axe", "Cudgel", "Foil", "Large Blade", "Polearm", "Small Blade",
    ]));
  });

  it("Gun Combat: 6 weapons (Energy/Handgun/Laser/Neural/Rifleman/SMG)", () => {
    expect(cs.gunCombat).toEqual(expect.arrayContaining([
      "Energy Weapons", "Handgun", "Laser Weapons", "Neural Weapons",
      "Rifleman", "Submachinegun",
    ]));
  });

  it("Vehicle: includes ground / air / water variants", () => {
    const v = cs.vehicle as string[];
    expect(v).toEqual(expect.arrayContaining([
      "Grav Vehicle", "Tracked Vehicle", "Wheeled Vehicle",
      "Helicopter", "Hovercraft", "Large Watercraft",
      "Lighter-Than-Air Craft", "Prop-Driven Aircraft",
      "Jet-Propelled Aircraft", "Small Watercraft", "Ship's Boat",
    ]));
  });

  it("Hand Combat: Blade Combat + Brawling + +1 attrs", () => {
    expect(cs.handCombat).toEqual(expect.arrayContaining([
      "Blade Combat", "Brawling", "+1 Endurance", "+1 Strength",
    ]));
  });

  it("Inborn: Artisan/Carousing/Instruction/Jack-o-T/Leader", () => {
    expect(cs.inborn).toEqual([
      "Artisan", "Carousing", "Instruction", "Jack-o-T", "Leader",
    ]);
  });
});

describe("MT Includes-skills (PM expansions)", () => {
  const inc = getEdition("mt-megatraveller").data.includesSkills as
    Record<string, string[] | string>;

  it("Combat Rifleman expands to multiple rifles", () => {
    expect(inc["Combat Rifleman"]).toEqual(expect.arrayContaining([
      "Advanced Combat Rifle", "Assault Rifle", "Carbine",
      "Gauss Rifle", "Rifle",
    ]));
  });

  it("Handgun expands to multiple sidearms", () => {
    expect(Array.isArray(inc.Handgun)).toBe(true);
  });

  it("ATV expands to Tracked Vehicle + Wheeled Vehicle", () => {
    expect(inc.ATV).toEqual(["Tracked Vehicle", "Wheeled Vehicle"]);
  });

  it("Battle Dress expands to Vacc Suit", () => {
    expect(inc["Battle Dress"]).toEqual(["Vacc Suit"]);
  });

  it("Axe expands to Battle Axe + Hand Axe", () => {
    expect(inc.Axe).toEqual(["Battle Axe", "Hand Axe"]);
  });
});
