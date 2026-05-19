// Combat ribbons + command clusters audit against MT PM pp. 51, 55.
//
// PM p. 51 (mercenary): "Each time that a character receives a combat
// assignment (police action, counterinsurgency, or raid), a combat
// service ribbon is awarded. Each time an officer holds a command
// assignment in combat, he receives a command cluster on the combat
// ribbon."
//
// PM p. 55 (navy): "Each time that a character receives a combat
// assignment (battle, siege, or strike), a combat service ribbon is
// awarded. Each time an officer holds a command assignment in combat,
// he receives a command cluster on the combat ribbon."

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

describe("Combat assignment lists (PM pp. 51, 55)", () => {
  it("Mercenary: Police Action / Counterinsurgency / Raid (PM p. 51)", () => {
    const merc = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.mercenary;
    const ca = (merc?.combatAssignments ?? []) as string[];
    expect(ca).toEqual(expect.arrayContaining([
      "Police Action", "Counterinsurgency", "Raid",
    ]));
    // PM p. 50 line "Ship's Troops" is also combat for Marines per the
    // Survival/Decoration table at p. 50 (Ship's Troops has decoration
    // 12+ and is reached via the Marine reroute from Counterinsurgency/
    // Internal Security). PM p. 51 mentions police action / counter-
    // insurgency / raid as the canonical combat trio.
    expect(ca.length).toBeGreaterThanOrEqual(3);
  });

  it("Navy: Battle / Siege / Strike (PM p. 55)", () => {
    const navy = getEdition("mt-megatraveller").data.advancedCharacterGeneration?.navy;
    const ca = (navy?.combatAssignments ?? []) as string[];
    expect(ca).toEqual(["Battle", "Siege", "Strike"]);
  });
});
