// Merchant Prince Free Trader audit against PM p. 64. Free Trader has
// TWO resolution tables: Trade (Route/Charter/Exploratory/Speculative)
// and Other (Smuggling/Piracy/No Business). Before the fix the engine
// routed Other assignments through the Trade table via assignmentColumnMap,
// yielding wrong survival/skills/bonus targets.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import { formatEvent } from "../lib/traveller/history";

afterEach(() => { vi.restoreAllMocks(); });

function walkSmuggling() {
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  const c = new Character({
    attributes: {
      strength: 10, dexterity: 10, endurance: 10,
      intelligence: 10, education: 10, social: 10,
    },
  });
  c.editionId = "mt-megatraveller";
  c.useAcg = true;
  c.choiceMode = "auto";
  c.acgPathway = "merchantPrince";
  c.acgState = freshAcgState("merchantPrince");
  c.requireMerchantAcg().lineType = "Free Trader";
  c.service = "merchants";
  let snap = session.enlist(
    { character: c, phase: "acg_enlist" },
    {
      verbose: false, preferredService: "random",
      acgService: "army", acgCombatArm: "Infantry",
      acgFleet: "imperialNavy", acgDivision: "field",
      acgLineType: "Free Trader", acgSubsectorTech: "",
      acgMerchantAcademy: false,
    },
  );
  snap = session.runTerm(snap);
  return snap;
}

describe("Merchant Free Trader Smuggling — PM p. 64 audit", () => {
  it("uses freeTraderOther survival target (6+), not freeTraderTrade speculative (5+)", () => {
    const snap = walkSmuggling();
    // Find a Smuggling survival event from the first term.
    const survivalEvents = snap.character.events.filter(
      (e) => e.kind === "roll" && /Survival/.test(formatEvent(e))
        && /Smuggling/.test(formatEvent(e)),
    );
    expect(survivalEvents.length).toBeGreaterThan(0);
    // The target should be 6 (smuggling) — NOT 5 (speculative).
    for (const e of survivalEvents) {
      const formatted = formatEvent(e);
      expect(formatted).toContain("vs 6+");
      expect(formatted).not.toContain("vs 5+");
    }
  });

  it("uses freeTraderOther skills target (5+)", () => {
    const snap = walkSmuggling();
    const skillEvents = snap.character.events.filter(
      (e) => e.kind === "roll" && /Skills/.test(formatEvent(e))
        && /Smuggling/.test(formatEvent(e)),
    );
    expect(skillEvents.length).toBeGreaterThan(0);
    for (const e of skillEvents) {
      expect(formatEvent(e)).toContain("vs 5+");
    }
  });
});
