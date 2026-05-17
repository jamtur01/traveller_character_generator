// MT Includes-skills expansion. PM lines 1891–2483: receiving an
// Includes-skill grants every constituent skill at level 1 (or the
// "-N" level if specified). Data lives in
// data/editions/mt-megatraveller.json under `includesSkills`.

import { describe, expect, it } from "vitest";
import { Character } from "../lib/traveller/character";
import { applyCell } from "../lib/traveller/engine/cellResolver";

function makeMtChar(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 7, dexterity: 7, endurance: 7,
    intelligence: 7, education: 7, social: 7,
  };
  c.service = "army";
  c.showHistory = "none";
  c.skills = [];
  return c;
}

describe("MT Includes-skills expansion (F1)", () => {
  it("ATV expands to Tracked Vehicle + Wheeled Vehicle", () => {
    const c = makeMtChar();
    applyCell(c, "ATV", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Tracked Vehicle", "Wheeled Vehicle"]);
  });

  it("Battle Dress expands to Vacc Suit", () => {
    const c = makeMtChar();
    applyCell(c, "Battle Dress", "skill");
    expect(c.skills).toEqual([["Vacc Suit", 1]]);
  });

  it("Handgun expands to Body Pistol, Pistol, Revolver, Snub Pistol", () => {
    const c = makeMtChar();
    c.homeworld = {
      starport: "A", size: "Medium", atmosphere: "Standard",
      hydrosphere: "Wet World", population: "Low Pop", law: "No Law",
      tech: "High Stellar",
    };
    applyCell(c, "Handgun", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toContain("Pistol");
    expect(names).toContain("Revolver");
  });

  it("Axe expands to Battle Axe + Hand Axe", () => {
    const c = makeMtChar();
    applyCell(c, "Axe", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Battle Axe", "Hand Axe"]);
  });

  it("Large Blade expands to Broadsword, Cutlass, Sword", () => {
    const c = makeMtChar();
    applyCell(c, "Large Blade", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Broadsword", "Cutlass", "Sword"]);
  });

  it("Polearm expands to Bayonet, Halberd, Pike, Spear", () => {
    const c = makeMtChar();
    applyCell(c, "Polearm", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Bayonet", "Halberd", "Pike", "Spear"]);
  });

  it("Small Blade expands to Blade + Dagger", () => {
    const c = makeMtChar();
    applyCell(c, "Small Blade", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Blade", "Dagger"]);
  });

  it("Combat Rifleman expands to its 5 modern combat rifles", () => {
    const c = makeMtChar();
    applyCell(c, "Combat Rifleman", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual([
      "Advanced Combat Rifle", "Assault Rifle", "Carbine",
      "Gauss Rifle", "Rifle",
    ]);
  });

  it("Heavy Weapons expands to 5 heavy weapon types", () => {
    const c = makeMtChar();
    applyCell(c, "Heavy Weapons", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual([
      "Autocannon", "Grenade Launcher", "Light Assault Gun",
      "Machine Gun", "VRF Gauss Gun",
    ]);
  });

  it("Laser Weapons expands to Laser Pistol + Laser Rifle", () => {
    const c = makeMtChar();
    applyCell(c, "Laser Weapons", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Laser Pistol", "Laser Rifle"]);
  });

  it("Rifleman expands to Autorifle, Carbine, Rifle, Shotgun", () => {
    const c = makeMtChar();
    applyCell(c, "Rifleman", "skill");
    const names = c.skills.map(([n]) => n).sort();
    expect(names).toEqual(["Autorifle", "Carbine", "Rifle", "Shotgun"]);
  });

  it("High-G Environ grants Laser Weapons-0 + Energy Weapons-0 at level 0", () => {
    const c = makeMtChar();
    applyCell(c, "High-G Environ", "skill");
    expect(c.skills).toEqual(expect.arrayContaining([
      ["Laser Weapons", 0],
      ["Energy Weapons", 0],
    ]));
  });

  it("Small Watercraft is NOT expanded (Serves-as semantics, not Includes)", () => {
    const c = makeMtChar();
    applyCell(c, "Small Watercraft", "skill");
    expect(c.skills).toEqual([["Small Watercraft", 1]]);
  });

  it("Wheeled Vehicle is NOT expanded (Serves-as semantics)", () => {
    const c = makeMtChar();
    applyCell(c, "Wheeled Vehicle", "skill");
    expect(c.skills).toEqual([["Wheeled Vehicle", 1]]);
  });
});
