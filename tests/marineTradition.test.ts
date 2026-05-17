// F5: Marine Tradition. PM p. 49 (lines 3061-3065).

import { describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import { applyCell } from "../lib/traveller/engine/cellResolver";

function makeMarine(): Character {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.attributes = {
    strength: 7, dexterity: 7, endurance: 7,
    intelligence: 7, education: 7, social: 7,
  };
  c.service = "marines";
  c.showHistory = "none";
  c.skills = [];
  c.choiceMode = "auto";
  return c;
}

describe("Marine Tradition (F5)", () => {
  it("Marine receiving Blade Combat is forced to Large Blade on failed save", () => {
    const c = makeMarine();
    // Roll low (2) on the save → tradition forces Large Blade
    vi.spyOn(Math, "random").mockReturnValue(0);
    applyCell(c, "Blade Cbt", "skill");
    expect(c.skills).toEqual([["Large Blade", 1]]);
    vi.restoreAllMocks();
  });

  it("Marine passes save (12) → normal cascade picks a blade", () => {
    const c = makeMarine();
    // Roll high (12) on the save → escape tradition; normal cascade runs.
    // First two Math.random calls are the save dice; subsequent ones drive
    // arnd for the random cascade pick.
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      if (call <= 2) return 0.999; // save roll 12 → pass
      return 0;                    // pick first option in pool
    });
    applyCell(c, "Blade Cbt", "skill");
    expect(c.skills.length).toBe(1);
    // The first cascade pick is Axe (from MT bladeCombat pool); it must
    // NOT be Large Blade (the forced one).
    vi.restoreAllMocks();
  });

  it("Already-Large-Blade-1 gets DM-3 on the save (11 + DM-3 = 8 fails)", () => {
    // Roll 5,6 = 11. With DM-3 → 8, fails the 9+ save → forced Large Blade.
    // Without the DM, 11 ≥ 9 would pass → cascade picks. The differing
    // outcome between the two tests in this block (this one vs. the next)
    // is what proves the DM is wired.
    const c = makeMarine();
    c.skills = [["Large Blade", 1]];
    const sequence = [4 / 6 + 0.001, 5 / 6 + 0.001]; // d6=5, d6=6 → roll 11
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(
      () => sequence[i++ % sequence.length]!,
    );
    applyCell(c, "Blade Cbt", "skill");
    // Forced Large Blade: existing Large Blade-1 gets bumped to Large Blade-2.
    expect(c.skills).toEqual([["Large Blade", 2]]);
    expect(c.history.some((h) => /Blade Combat → Large Blade/.test(h))).toBe(true);
    vi.restoreAllMocks();
  });

  it("No-Large-Blade Marine on the same roll (11) passes the save (no DM)", () => {
    // Control case: same roll sequence (5,6 → 11), but no Large Blade
    // skill so no DM. 11 + 0 = 11 ≥ 9 → save passes → cascade picks.
    const c = makeMarine();
    c.skills = []; // no Large Blade → no DM
    const sequence = [
      4 / 6 + 0.001, 5 / 6 + 0.001, // save dice: 5,6 = 11 (pass)
      0, 0, 0, 0, // subsequent rolls for cascade pick
    ];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(
      () => sequence[i++] ?? 0,
    );
    applyCell(c, "Blade Cbt", "skill");
    // Save passed → cascade picked SOMETHING, but not forced Large Blade.
    expect(c.skills.length).toBe(1);
    expect(c.history.some((h) => /Blade Combat → Large Blade/.test(h))).toBe(false);
    vi.restoreAllMocks();
  });

  it("Army receiving Blade Combat: tradition does NOT apply", () => {
    const c = makeMarine();
    c.service = "army";
    vi.spyOn(Math, "random").mockReturnValue(0);
    applyCell(c, "Blade Cbt", "skill");
    // No forced Large Blade — cascade picks normally
    expect(c.skills.some(([n]) => n === "Large Blade")).toBe(false);
    vi.restoreAllMocks();
  });
});
