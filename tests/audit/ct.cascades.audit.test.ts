// Cascade-skill pools per TTB p. 25 and CotI cross-references. Each pool
// must include every option the rulebook lists as a valid sub-selection.

import { describe, expect, it } from "vitest";
import { cascadePoolByKey } from "../../lib/traveller/engine/cascadeMap";

const BLADES = cascadePoolByKey("bladeCombat", "ct-classic");
const BOWS = cascadePoolByKey("bowCombat", "ct-classic");
const GUNS = cascadePoolByKey("gunCombat", "ct-classic");
const VEHICLES = cascadePoolByKey("vehicle", "ct-classic");
const AIRCRAFTS = cascadePoolByKey("aircraft", "ct-classic");
const WATERCRAFTS = cascadePoolByKey("watercraft", "ct-classic");

describe("cascade pools (TTB p. 25)", () => {
  it("BLADES contains the 10 TTB blades & polearms", () => {
    expect(BLADES).toEqual([
      "Dagger", "Foil", "Sword", "Cutlass", "Broadsword", "Bayonet",
      "Spear", "Halberd", "Pike", "Cudgel",
    ]);
  });

  it("GUNS contains the 10 TTB personal firearms", () => {
    expect(GUNS).toEqual([
      "Body Pistol", "Auto Pistol", "Revolver", "Carbine", "Rifle",
      "Auto Rifle", "Shotgun", "SMG", "Laser Carbine", "Laser Rifle",
    ]);
  });

  it("VEHICLES contains every TTB-canonical sub-type (flattened)", () => {
    // TTB's cascade is hierarchical: Vehicle → {Aircraft, Grav Vehicle,
    // Tracked Vehicle, Watercraft, Wheeled Vehicle}. Aircraft and Watercraft
    // then sub-select. The port flattens to specific types for randomization,
    // so every leaf must be present.
    for (const v of [
      "Grav Vehicle", "Tracked Vehicle", "Wheeled Vehicle",
      "Large Watercraft", "Small Watercraft", "Hovercraft", "Submersible",
      "Prop-driven Fixed Wing", "Jet-driven Fixed Wing", "Helicopter",
    ]) {
      expect(VEHICLES as readonly string[]).toContain(v);
    }
  });

  it("AIRCRAFTS is exactly the 3 TTB aircraft types", () => {
    expect(AIRCRAFTS).toEqual([
      "Prop-driven Fixed Wing", "Jet-driven Fixed Wing", "Helicopter",
    ]);
  });

  it("WATERCRAFTS contains all 4 TTB watercraft types", () => {
    expect(WATERCRAFTS).toEqual([
      "Large Watercraft", "Small Watercraft", "Hovercraft", "Submersible",
    ]);
  });

  it("BOWS contains the 6 CotI bow types (Barbarian career)", () => {
    expect(BOWS).toEqual([
      "Sling", "Short Bow", "Long Bow",
      "Sporting Crossbow", "Military Crossbow", "Repeating Crossbow",
    ]);
  });
});
