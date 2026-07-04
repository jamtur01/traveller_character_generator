// Audit harness — dumps an event log for manual PM comparison.
// Use from a .test.ts file:
//   const log = auditMercenaryArmy({ attributes: {...} });
//   console.log(log.join("\n"));

import { vi } from "vitest";
import { Character, type CharacterOptions } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";
import { freshAcgState } from "../lib/traveller/engine/acg/state";
import type { AcgPathwayId } from "../lib/traveller/engine/acg/state";
import { formatEvent } from "../lib/traveller/history";

export function auditAcg(opts: {
  pathway: AcgPathwayId;
  attributes?: CharacterOptions["attributes"];
  service?: "army" | "marines";
  combatArm?: string;
  fleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
  division?: "field" | "bureaucracy";
  lineType?: string;
  rolls?: number[];   // optional deterministic sequence (each 0-1)
  maxTerms?: number;
}): { events: string[]; character: Character; snap: session.ChargenSnapshot } {
  const seq = opts.rolls;
  if (seq) {
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0.5);
  } else {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  }
  const c = new Character({
    attributes: opts.attributes ?? {
      strength: 10, dexterity: 10, endurance: 10,
      intelligence: 10, education: 10, social: 10,
    },
  });
  c.editionId = "mt-megatraveller";
  c.useAcg = true;
  c.choiceMode = "auto";
  c.acgPathway = opts.pathway;
  c.acgState = freshAcgState(opts.pathway);
  if (opts.combatArm && c.acgState.pathway === "mercenary") c.acgState.combatArm = opts.combatArm;
  if (opts.fleet && c.acgState.pathway === "navy") c.acgState.fleet = opts.fleet;
  if (opts.division && c.acgState.pathway === "scout") c.acgState.division = opts.division;
  if (opts.lineType && c.acgState.pathway === "merchantPrince") {
    c.acgState.lineType = opts.lineType;
  }
  c.service = opts.service ?? "army";

  // beginAcg via the session enlist path so initialTraining and the
  // standard enlist hooks fire correctly.
  let snap = session.enlist(
    { character: c, phase: "acg_enlist" },
    {
      verbose: true,
      preferredService: "random",
      acgService: opts.service ?? "army",
      acgCombatArm: opts.combatArm ?? "Infantry",
      acgFleet: opts.fleet ?? "imperialNavy",
      acgDivision: opts.division ?? "field",
      acgLineType: opts.lineType ?? "Free Trader",
      acgSubsectorTech: "",
      acgMerchantAcademy: false,
    },
  );
  const maxTerms = opts.maxTerms ?? 4;
  for (let t = 0; t < maxTerms; t++) {
    if (snap.phase === "end") break;
    snap = session.runTerm(snap);
    if (snap.phase !== "term") break;
  }
  while (snap.phase === "muster" || snap.phase === "muster_no_cash") {
    snap = session.musterChoice(snap, "benefit");
  }
  return {
    character: snap.character,
    snap,
    events: snap.character.events.map(formatEvent),
  };
}
