// Inspection script — dumps the full event log for a controlled walk
// so I can verify line-by-line against PM rules. Not a regression
// test; meant to surface output for human review.

import { afterEach, describe, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import { freshAcgState } from "../lib/traveller/engine/acg/types";
import { formatEvent } from "../lib/traveller/history";

afterEach(() => {
  vi.restoreAllMocks();
});

function dumpWalk(opts: {
  pathway: "mercenary" | "navy" | "scout" | "merchantPrince";
  service?: "army" | "marines";
  combatArm?: string;
  fleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
  division?: "field" | "bureaucracy";
  lineType?: string;
  randomValue?: number;
}): void {
  vi.spyOn(Math, "random").mockReturnValue(opts.randomValue ?? 0.5);
  const c = new Character({
    attributes: {
      strength: 10, dexterity: 10, endurance: 10,
      intelligence: 10, education: 10, social: 10,
    },
  });
  c.editionId = "mt-megatraveller";
  c.useAcg = true;
  c.choiceMode = "auto";
  c.acgPathway = opts.pathway;
  c.acgState = freshAcgState(opts.pathway);
  if (opts.combatArm) c.acgState.combatArm = opts.combatArm;
  if (opts.fleet) c.acgState.fleet = opts.fleet;
  if (opts.division) c.acgState.division = opts.division;
  if (opts.lineType) c.acgState.lineType = opts.lineType;
  c.service = opts.service ?? "army";

  let snap = session.enlist(
    { character: c, phase: "acg_enlist" },
    {
      verbose: true, preferredService: "random",
      acgService: opts.service ?? "army",
      acgCombatArm: opts.combatArm ?? "Infantry",
      acgFleet: opts.fleet ?? "imperialNavy",
      acgDivision: opts.division ?? "field",
      acgLineType: opts.lineType ?? "Free Trader",
      acgSubsectorTech: "", acgMerchantAcademy: false,
    },
  );
  for (let t = 0; t < 4; t++) {
    if (snap.phase === "end") break;
    snap = session.runTerm(snap);
    if (snap.phase !== "term") break;
  }
  while (snap.phase === "muster" || snap.phase === "muster_no_cash") {
    snap = session.musterChoice(snap, "benefit");
  }

  console.log(`\n=== ${opts.pathway} (${opts.service ?? opts.fleet ?? opts.division ?? opts.lineType}) — randomValue=${opts.randomValue ?? 0.5} ===`);
  for (const e of snap.character.events) console.log(formatEvent(e));
  console.log(`Final: rank=${snap.character.acgState?.rankCode}, terms=${snap.character.terms}, age=${snap.character.age}, deceased=${snap.character.deceased}`);
}

describe.skip("workflow inspection (run manually)", () => {
  it("mercenary army Infantry high rolls", () => {
    dumpWalk({ pathway: "mercenary", service: "army", combatArm: "Infantry", randomValue: 0.999 });
  });
  it("mercenary marines Infantry high rolls", () => {
    dumpWalk({ pathway: "mercenary", service: "marines", combatArm: "Infantry", randomValue: 0.999 });
  });
  it("navy imperialNavy high rolls", () => {
    dumpWalk({ pathway: "navy", fleet: "imperialNavy", randomValue: 0.999 });
  });
  it("scout field high rolls", () => {
    dumpWalk({ pathway: "scout", division: "field", randomValue: 0.999 });
  });
  it("merchant Free Trader high rolls", () => {
    dumpWalk({ pathway: "merchantPrince", lineType: "Free Trader", randomValue: 0.999 });
  });
});
