// The "acg" chargen model: MegaTraveller Advanced Character Generation. Owns
// the pre-career / ACG-enlist / per-year-term routing; the per-year mechanics
// live in engine/acg/* (invoked via Character.doServiceTermStep -> runAcgTerm
// and Character.beginAcg). Shares end-of-term / muster routing with the classic
// model via chargen/flow. The generic pause protocol lives in the session's
// runAction, which dispatches here.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";
import { freshAcgState } from "@/lib/traveller/engine/acg/state";
import { event as ev } from "@/lib/traveller/history";
import { maxCashRolls } from "@/lib/traveller/core";
import type { ChargenModel, FlowStage } from "@/lib/traveller/chargen/model";
import type {
  ChargenPhase,
  ChargenResult,
  ChargenSnapshot,
  EnlistOptions,
  FrontierAction,
  PreCareerOption,
  UiHints,
} from "@/lib/traveller/chargen/session";
import { registerModel } from "@/lib/traveller/chargen/modelRegistry";
import {
  pickSkillPhase,
  enterMuster,
  doAttemptMusterOut,
  doMusterChoice,
} from "@/lib/traveller/chargen/flow";

function doApplyPreCareer(ch: Character, opt: PreCareerOption): ChargenResult {
  if (opt === "skip") {
    return { snapshot: { character: ch, phase: "acg_enlist" } };
  }
  const r = ch.doPreCareer(opt);
  const hints: UiHints = {};
  if (r.autoEnlistPathway) {
    ch.acgPathway = r.autoEnlistPathway;
    hints.acgPathway = r.autoEnlistPathway;
    const branch = ch.acgState?.preCareerBranch;
    if (branch === "army" || branch === "marines") hints.acgService = branch;
    if (r.autoEnlistPathway === "navy" && opt === "navalAcademy") {
      hints.acgFleet = "imperialNavy";
    }
  }
  return { snapshot: { character: ch, phase: "pre_career" }, hints };
}

function doEnlist(ch: Character, opts: EnlistOptions): ChargenSnapshot {
  ch.showHistory = opts.verbose ? "verbose" : "simple";
  // PM p. 44: Merchant Academy may only be attempted after enlisting in a
  // Megacorp or Sector-wide line — the eligible line types are read from
  // acg.common.preCareerOptions.merchantAcademy.requiresLineType.
  const merchantAcademy = getEdition(ch.editionId).data
    .advancedCharacterGeneration?.common?.preCareerOptions?.merchantAcademy as
    { requiresLineType?: string[] } | undefined;
  if (
    ch.acgPathway === "merchantPrince" &&
    (merchantAcademy?.requiresLineType ?? []).includes(opts.acgLineType) &&
    opts.acgMerchantAcademy
  ) {
    if (!ch.acgState) ch.acgState = freshAcgState("merchantPrince");
    ch.acgState.attemptMerchantAcademy = true;
  }
  try {
    ch.beginAcg(
      ch.acgPathway as "mercenary" | "navy" | "scout" | "merchantPrince",
      {
        service: opts.acgService,
        combatArm: opts.acgCombatArm,
        fleet: opts.acgFleet,
        division: opts.acgDivision,
        lineType: opts.acgLineType,
        ...(opts.acgSubsectorTech ? { subsectorTechCode: opts.acgSubsectorTech } : {}),
      },
    );
  } catch (err) {
    // A pause is not a failure — let it unwind to the session boundary.
    if (err instanceof ChoicePendingError) throw err;
    ch.log(
      ev.endGeneration("retired", `ACG enlistment failed: ${(err as Error).message}`),
    );
    return { character: ch, phase: "end" };
  }
  return { character: ch, phase: "term" };
}

function doRunTerm(ch: Character): ChargenSnapshot {
  // doServiceTermStep runs the full ACG per-year cycle (survival, decoration,
  // promotion, skills, aging, reenlistment) via runAcgTerm; the classic-flow
  // skill-cap / aging done here for basic chargen is handled inside that cycle.
  ch.doServiceTermStep();
  if (ch.deceased) return { character: ch, phase: "end" };
  if (!ch.activeDuty) return enterMuster(ch);
  return { character: ch, phase: "term" };
}

export const acgModel: ChargenModel = {
  id: "acg",
  label: "Advanced Character Generation",
  entryPhase: () => "pre_career",
  execute(ch: Character, action: FrontierAction): ChargenResult {
    switch (action.kind) {
      case "preCareer":
        return doApplyPreCareer(ch, action.opt);
      case "enlist":
        return { snapshot: doEnlist(ch, action.opts) };
      case "runTerm":
        return { snapshot: doRunTerm(ch) };
      case "attemptMusterOut":
        return { snapshot: doAttemptMusterOut(ch) };
      case "musterChoice":
        return { snapshot: doMusterChoice(ch, action.choice) };
      case "pickSkill":
        throw new Error("ACG chargen resolves skills inline; no pickSkill phase");
    }
  },
  pausedPhase(action: FrontierAction, ch: Character, base: Character): ChargenPhase {
    switch (action.kind) {
      case "preCareer":
        return "pre_career";
      case "enlist":
      case "runTerm":
      case "attemptMusterOut":
        return "term";
      case "pickSkill":
        return pickSkillPhase(ch);
      case "musterChoice":
        return base.muster.musterCashUsed >= maxCashRolls(base)
          ? "muster_no_cash"
          : "muster";
    }
  },
  flowStages(): readonly FlowStage[] {
    return [
      { id: "roll", label: "Roll", hint: "Attributes & edition", phases: ["start"] },
      { id: "pre", label: "Pre-Career", hint: "College & academies", phases: ["pre_career"] },
      { id: "enlist", label: "Enlist", hint: "Pathway & branch", phases: ["acg_enlist", "career"] },
      { id: "serve", label: "Serve", hint: "Annual cycle", phases: ["term", "skill_basic", "skill_adv"] },
      { id: "muster", label: "Muster", hint: "Cash & benefits", phases: ["muster", "muster_no_cash"] },
      { id: "done", label: "Done", hint: "Character sheet", phases: ["end"] },
    ];
  },
};

registerModel(acgModel);
