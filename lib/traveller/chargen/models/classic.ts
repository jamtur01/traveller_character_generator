// The "classic" chargen model: CT and MT basic per-term character generation.
// Owns the basic enlist / run-term / skill-pick routing; shares end-of-term and
// muster mechanics with the acg model via chargen/flow. The generic pause
// protocol (clone base, decision cursor, ChoicePendingError boundary) lives in
// the session's runAction, which dispatches here.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { getEditionServices } from "@/lib/traveller/services";
import { maxCashRolls } from "@/lib/traveller/core";
import type { ChargenModel, FlowStage } from "@/lib/traveller/chargen/model";
import type {
  ChargenPhase,
  ChargenResult,
  ChargenSnapshot,
  EnlistOptions,
  FrontierAction,
} from "@/lib/traveller/chargen/session";
import { registerModel } from "@/lib/traveller/chargen/modelRegistry";
import {
  pickSkillPhase,
  finishTerm,
  enterMuster,
  doAttemptMusterOut,
  doMusterChoice,
} from "@/lib/traveller/chargen/flow";

function doEnlist(ch: Character, opts: EnlistOptions): ChargenSnapshot {
  ch.showHistory = opts.verbose ? "verbose" : "simple";
  ch.service = ch.doEnlistment(
    opts.preferredService === "random" ? "" : opts.preferredService,
  );
  return { character: ch, phase: "term" };
}

function doRunTerm(ch: Character): ChargenSnapshot {
  // Some services (CoTI nobles) derive starting rank from social standing each
  // term rather than by a promotion roll (service JSON rankBySocial block).
  const rankRule = getEdition(ch.editionId).data.services[ch.service]?.rankBySocial;
  if (rankRule) {
    if (ch.attributes.social < rankRule.socialFloor) {
      ch.attributes.social = rankRule.socialFloor;
    }
    const startingRank = Math.min(ch.attributes.social + rankRule.rankOffset, rankRule.maxRank);
    if (ch.rank < startingRank && startingRank >= 1) {
      ch.rank = startingRank;
      ch.commissioned = true;
    }
  }
  ch.doServiceTermStep();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (ch.skillPoints > 0) return { character: ch, phase: pickSkillPhase(ch) };
  ch.enforceSkillCap();
  if (!ch.deceased) ch.doAging();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.activeDuty) return enterMuster(ch);
  return { character: ch, phase: "term" };
}

function doPickSkill(ch: Character, table: number): ChargenSnapshot {
  if (table === 0) {
    ch.muster.forceTable = false;
  } else {
    ch.muster.forceTable = true;
    ch.muster.forceTableIndex = table;
  }
  ch.skillPoints -= 1;
  getEditionServices(ch.editionId)[ch.service]!.acquireSkill(ch);
  if (ch.skillPoints > 0) return { character: ch, phase: pickSkillPhase(ch) };
  return finishTerm(ch);
}

export const classicModel: ChargenModel = {
  id: "classic",
  label: "Classic (per-term careers)",
  entryPhase: () => "career",
  execute(ch: Character, action: FrontierAction): ChargenResult {
    switch (action.kind) {
      case "enlist":
        return { snapshot: doEnlist(ch, action.opts) };
      case "runTerm":
        return { snapshot: doRunTerm(ch) };
      case "pickSkill":
        return { snapshot: doPickSkill(ch, action.table) };
      case "attemptMusterOut":
        return { snapshot: doAttemptMusterOut(ch) };
      case "musterChoice":
        return { snapshot: doMusterChoice(ch, action.choice) };
      case "preCareer":
        throw new Error("classic chargen has no pre-career phase");
    }
  },
  pausedPhase(action: FrontierAction, ch: Character, base: Character): ChargenPhase {
    switch (action.kind) {
      case "enlist":
      case "runTerm":
      case "attemptMusterOut":
        return "term";
      case "pickSkill":
        return pickSkillPhase(ch);
      case "musterChoice":
        // Pre-increment cash accounting from the base so the paused snapshot
        // stays in the phase the roll was issued from.
        return base.muster.musterCashUsed >= maxCashRolls(base)
          ? "muster_no_cash"
          : "muster";
      case "preCareer":
        return "career";
    }
  },
  flowStages(): readonly FlowStage[] {
    return [
      { id: "roll", label: "Roll", hint: "Attributes & edition", phases: ["start"] },
      { id: "enlist", label: "Enlist", hint: "Service & draft", phases: ["career"] },
      { id: "serve", label: "Serve", hint: "Terms of duty", phases: ["term", "skill_basic", "skill_adv"] },
      { id: "muster", label: "Muster", hint: "Cash & benefits", phases: ["muster", "muster_no_cash"] },
      { id: "done", label: "Done", hint: "Character sheet", phases: ["end"] },
    ];
  },
};

registerModel(classicModel);
