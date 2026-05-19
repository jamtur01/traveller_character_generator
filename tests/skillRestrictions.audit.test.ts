// Homeworld skill restrictions audit (MT PM p. 15, TTB p. 17).
//
// Vehicle skills limited by tech code; weapon skills limited by tech +
// law code. Pirates / Rogues / Law Enforcers may pick weapons one law
// code lower than their homeworld's. Nobles are exempt entirely.
// Override: roll 2D for 7+; failure forfeits the skill roll.

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";

interface HomeworldSkillRules {
  overrideTarget?: number;
  exemptServices?: string[];
  weaponLawLowerServices?: string[];
  vehicleSkillTech?: Record<string, string>;
  weaponSkillTech?: Record<string, string>;
  weaponSkillMaxLaw?: Record<string, string>;
}

function rules(): HomeworldSkillRules {
  return getEdition("mt-megatraveller").rules.homeworldSkillRestrictions as
    HomeworldSkillRules ?? {};
}

describe("Homeworld skill restrictions (MT PM p. 15)", () => {
  it("Override roll: 2D for 7+", () => {
    expect(rules().overrideTarget).toBe(7);
  });

  it("Nobles exempt from all restrictions", () => {
    expect(rules().exemptServices).toEqual(["nobles"]);
  });

  it("Pirates / Rogues / Law Enforcers may pick weapons one law lower", () => {
    expect(rules().weaponLawLowerServices).toEqual(expect.arrayContaining([
      "lawenforcers", "pirates", "rogues",
    ]));
  });
});

describe("Vehicle skill tech-code gates (PM p. 15)", () => {
  const v = rules().vehicleSkillTech ?? {};

  it("Wheeled / Tracked Vehicle: Industrial+", () => {
    expect(v["Wheeled Vehicle"]).toBe("Industrial");
    expect(v["Tracked Vehicle"]).toBe("Industrial");
  });

  it("Helicopter / Hovercraft / Jet aircraft: Pre-Stellar+", () => {
    expect(v.Helicopter).toBe("Pre-Stellar");
    expect(v.Hovercraft).toBe("Pre-Stellar");
    expect(v["Jet-Propelled Aircraft"]).toBe("Pre-Stellar");
  });

  it("Grav Vehicle / Grav Belt: Avg Stellar+", () => {
    expect(v["Grav Vehicle"]).toBe("Avg Stellar");
    expect(v["Grav Belt"]).toBe("Avg Stellar");
  });

  it("Lighter-Than-Air Craft / Prop aircraft: Industrial+", () => {
    expect(v["Lighter-Than-Air Craft"]).toBe("Industrial");
    expect(v["Prop-Driven Aircraft"]).toBe("Industrial");
  });
});

describe("Weapon skill law-code gates (PM p. 15)", () => {
  const w = rules().weaponSkillMaxLaw ?? {};

  it("Energy Weapons / Machine Gun / Autorifle / Submachinegun: No Law only", () => {
    expect(w["Energy Weapons"]).toBe("No Law");
    expect(w["Machine Gun"]).toBe("No Law");
    expect(w.Autorifle).toBe("No Law");
    expect(w.Submachinegun).toBe("No Law");
  });

  it("Handgun / Laser Weapons / Rifleman / Carbine / Rifle: Low Law+", () => {
    expect(w.Handgun).toBe("Low Law");
    expect(w["Laser Weapons"]).toBe("Low Law");
    expect(w.Rifleman).toBe("Low Law");
    expect(w.Carbine).toBe("Low Law");
    expect(w.Rifle).toBe("Low Law");
  });

  it("Neural Weapons: Mod Law+", () => {
    expect(w["Neural Weapons"]).toBe("Mod Law");
    expect(w["Neural Pistol"]).toBe("Mod Law");
    expect(w["Neural Rifle"]).toBe("Mod Law");
  });

  it("Archaic weapons (Bayonet/Bow/Boomerang): Mod Law+", () => {
    expect(w.Bayonet).toBe("Mod Law");
    expect(w.Bow).toBe("Mod Law");
    expect(w.Boomerang).toBe("Mod Law");
  });
});

describe("Specific weapon tech gates (PM p. 15)", () => {
  it("Assault Rifle: Pre-Stellar+", () => {
    expect(rules().weaponSkillTech?.["Assault Rifle"]).toBe("Pre-Stellar");
  });
});
