// The "mongoose" chargen model: Mongoose Traveller 2e (2022 Core Rulebook).
// Owns the career-plus-assignment flow and the per-term loop (Qualification ->
// Basic Training -> Survival(->Mishap) -> Events -> Advancement/Commission ->
// Skills -> Ageing), plus mustering out and the solo Connections finish. The
// individual mechanics live in engine/mongoose/*; this model orchestrates them
// and maps them onto the session's phases/actions. The generic pause protocol
// (clone base, decision cursor, ChoicePendingError) lives in the session.
//
// Phase mapping: "career" = between careers (enlist a career, or finish);
// "term" = in a career (run a term); "muster" = mustering-out / finishing.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { characteristicDm } from "@/lib/traveller/core";
import { requireRule } from "@/lib/traveller/editions/strict";
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
  freshMongooseState,
  resetMongoosePerTerm,
  type MongooseState,
} from "@/lib/traveller/engine/mongoose/state";
import { getMongooseData } from "@/lib/traveller/engine/mongoose/core";
import { qualifyForCareer, enterCareer } from "@/lib/traveller/engine/mongoose/enlist";
import { grantSkillFloor } from "@/lib/traveller/engine/mongoose/skills";
import { rollSurvival } from "@/lib/traveller/engine/mongoose/survival";
import { rollEvent } from "@/lib/traveller/engine/mongoose/events";
import { resolveAdvancementPhase } from "@/lib/traveller/engine/mongoose/advancement";
import { rollSkillTraining } from "@/lib/traveller/engine/mongoose/skillsTraining";
import { rollAging, agingBegun } from "@/lib/traveller/engine/mongoose/aging";
import { musterOut } from "@/lib/traveller/engine/mongoose/muster";
import { applyConnections } from "@/lib/traveller/engine/mongoose/connections";

function ensureState(ch: Character): MongooseState {
  if (!ch.mongooseState) ch.mongooseState = freshMongooseState();
  return ch.mongooseState;
}

/** Adolescent background skills (Core p.10): EDU DM + base, each at level 0,
 *  chosen distinctly from the background list. */
function applyBackgroundSkills(ch: Character): void {
  const data = getMongooseData(ch);
  const eduDm = characteristicDm(ch.attributes.education, data.characteristicDmBands);
  const count = Math.max(0, eduDm + data.backgroundSkillBase);
  const picked = new Set<string>();
  for (let i = 0; i < count; i++) {
    const available = data.backgroundSkills.filter((s) => !picked.has(s));
    if (available.length === 0) return;
    ch.pickOrDefer({
      kind: "mongooseSkillChoice",
      label: "Background skill (level 0)",
      options: available,
      onResolve: (c, chosen) => {
        picked.add(chosen);
        grantSkillFloor(c, chosen, 0, "Background");
      },
    });
  }
}

/** Enter `careerId`, prompting for the assignment when it is not predetermined
 *  — a drafted "any" row, a forced career, or an offered career (Core p.20).
 *  Auto mode picks an assignment as usual. */
function enterCareerWithAssignmentChoice(ch: Character, careerId: string): void {
  const career = getMongooseData(ch).careers[careerId]!;
  ch.pickOrDefer({
    kind: "mongooseAssignment",
    label: `Choose an assignment for ${career.displayName}`,
    options: career.assignments.map((a) => a.id),
    onResolve: (c, asgId) => enterCareer(c, careerId, asgId),
  });
}

/** Roll on the Draft table (Core p.20) and enter the resulting career. */
function rollDraftAndEnter(ch: Character): void {
  const data = getMongooseData(ch);
  const draftRoll = ch.rng.roll(1);
  const row = requireRule(
    data.draft.find((d) => d.roll === draftRoll),
    `mongoose.draft[${draftRoll}]`, "MgT2 Core p.20",
  );
  const career = requireRule(data.careers[row.career], `mongoose.careers.${row.career}`, "MgT2");
  ch.log(ev.drafted(career.displayName));
  if (row.assignment === "any") enterCareerWithAssignmentChoice(ch, row.career);
  else enterCareer(ch, row.career, row.assignment);
}

/** Enter a career after a failed qualification: submit to the Draft once per
 *  lifetime (Core p.20), else become a Drifter (always open). */
function enterViaDraftOrDrifter(ch: Character): void {
  const state = ensureState(ch);
  if (!state.draftedOnce) {
    state.draftedOnce = true;
    rollDraftAndEnter(ch);
    return;
  }
  const fallbackId = getMongooseData(ch).draftFallbackCareer;
  const fallback = requireRule(
    getMongooseData(ch).careers[fallbackId], `mongoose.careers.${fallbackId}`, "MgT2 Core p.20",
  );
  enterCareer(ch, fallbackId, fallback.assignments[0]!.id);
}

/** The normal path: pick a career + assignment, roll qualification, and enter
 *  (or draft/drift on failure). */
function pickCareerNormally(ch: Character): void {
  const data = getMongooseData(ch);
  ch.pickOrDefer({
    kind: "mongooseCareer",
    label: "Choose a career to attempt",
    options: Object.keys(data.careers).filter((id) => !data.careers[id]!.forcedOnly),
    onResolve: (c, careerId) => {
      const career = getMongooseData(c).careers[careerId]!;
      c.pickOrDefer({
        kind: "mongooseAssignment",
        label: "Choose an assignment",
        options: career.assignments.map((a) => a.id),
        onResolve: (cc, asgId) => {
          if (qualifyForCareer(cc, careerId)) enterCareer(cc, careerId, asgId);
          else enterViaDraftOrDrifter(cc);
        },
      });
    },
  });
}

/** Pick a career + assignment, roll qualification, and enter (or draft/drift on
 *  failure). Honors a forced next career (e.g. Prisoner via an event) when the
 *  edition models it; otherwise falls through to a normal choice. */
function pickCareerAndEnter(ch: Character): void {
  const state = ensureState(ch);
  const data = getMongooseData(ch);
  // Capture and clear all routing flags up front so an un-taken sibling flag
  // (e.g. forceCareer set alongside offerCareer) never survives to a later term.
  const forced = state.forcedNextCareer;
  const mustDraft = state.mustDraft;
  const offered = state.offeredNextCareer;
  state.forcedNextCareer = null;
  state.mustDraft = false;
  state.offeredNextCareer = null;
  if (forced && data.careers[forced]) {
    enterCareerWithAssignmentChoice(ch, forced);
    return;
  }
  if (mustDraft) {
    rollDraftAndEnter(ch);
    return;
  }
  if (offered && data.careers[offered]) {
    ch.pickOrDefer({
      kind: "mongooseOfferedCareer",
      label: `Take the ${data.careers[offered]!.displayName} career next term without qualifying?`,
      options: ["Accept", "Decline"],
      onResolve: (c, choice) => {
        if (choice === "Accept") {
          enterCareerWithAssignmentChoice(c, offered);
        } else {
          pickCareerNormally(c);
        }
      },
    });
    return;
  }
  pickCareerNormally(ch);
}

function doEnlist(ch: Character, opts: EnlistOptions): ChargenSnapshot {
  const state = ensureState(ch);
  ch.showHistory = opts.verbose ? "verbose" : "simple";
  if (state.careerCount === 0 && ch.skills.length === 0) applyBackgroundSkills(ch);
  pickCareerAndEnter(ch);
  return { character: ch, phase: "term" };
}

/** Run one four-year term of the current career (Core p.18). */
function doRunTerm(ch: Character): ChargenSnapshot {
  const state = ensureState(ch);
  const data = getMongooseData(ch);
  resetMongoosePerTerm(state);
  // Prisoner (Core p.52): a mishap never ejects a prisoner — parole (the
  // advancement roll vs the threshold) is the only route out.
  const currentCareer = state.career ? data.careers[state.career] : undefined;
  if (currentCareer?.parole) state.perTerm.noEject = true;
  // Prisoner (Core p.52): a Traveller may pick a new assignment every term.
  // Auto keeps the current assignment (preferred); interactive offers all three.
  if (currentCareer?.parole && state.assignment) {
    const current = state.assignment;
    ch.pickOrDefer({
      kind: "mongooseAssignment",
      label: "Prisoner: choose this term's assignment",
      options: currentCareer.assignments.map((a) => a.id),
      preferred: [current],
      onResolve: (c, asgId) => { c.mongooseState!.assignment = asgId; },
    });
  }
  state.termsInCareer += 1;
  ch.terms += 1;
  ch.age = data.startAge + ch.terms * data.termLengthYears;

  const survived = rollSurvival(ch);
  if (ch.deceased) return { character: ch, phase: "end" };
  if (survived) {
    rollEvent(ch);
    if (ch.deceased) return { character: ch, phase: "end" };
    // An IMMEDIATE leave this term — escape or a "leave this career" event that
    // sets mustLeave WITHOUT a forced next career (Core p.57 escape: "you leave
    // this career") — skips advancement and skills. A forced-NEXT-term transfer
    // (arrest -> Prisoner: mustLeave + forcedNextCareer) completes this term
    // first; and an advancement roll of <= terms ("leave after this term") still
    // completes skills, since its mustLeave is set inside resolveAdvancementPhase.
    if (!(state.perTerm.mustLeave && state.forcedNextCareer === null)) {
      resolveAdvancementPhase(ch);
      rollSkillTraining(ch);
      if (state.perTerm.advancedThisTerm) rollSkillTraining(ch);
    }
  }
  if (agingBegun(ch) && !ch.deceased) rollAging(ch);
  if (ch.deceased) return { character: ch, phase: "end" };

  // Prisoner (Core p.52): a prisoner who was not released this term (parole roll
  // did not exceed the threshold, or survival failed so no parole roll happened)
  // and did not escape must serve another term — never a voluntary departure.
  if (state.paroleThreshold !== null && !state.perTerm.mustLeave) {
    state.perTerm.mustContinue = true;
  }

  if (state.perTerm.mustLeave) {
    musterOut(ch);
    state.career = null;
    state.paroleThreshold = null;
    return { character: ch, phase: "career" };
  }
  return { character: ch, phase: "term" };
}

/** attemptMusterOut: leave the current career (voluntary muster) if in one;
 *  otherwise finish generation (apply connections + end). A natural-12
 *  "must continue" blocks a voluntary departure. */
function doMusterAction(ch: Character): ChargenSnapshot {
  const state = ensureState(ch);
  if (state.career) {
    // Prisoner (Core p.52): cannot leave voluntarily — only a parole release or
    // escape (both set mustLeave in the term itself) ends the career. mustContinue
    // (natural 12 / unreleased parole) also blocks a voluntary departure.
    if (state.perTerm.mustContinue || state.paroleThreshold !== null) {
      return { character: ch, phase: "term" };
    }
    musterOut(ch);
    state.career = null;
    state.paroleThreshold = null;
    return { character: ch, phase: "career" };
  }
  applyConnections(ch);
  ch.log(ev.endGeneration("mustered", "Mongoose character generation complete"));
  return { character: ch, phase: "end" };
}

const STAGES: readonly FlowStage[] = [
  { id: "roll", label: "Roll", hint: "Characteristics & background", phases: ["start"] },
  { id: "careers", label: "Careers", hint: "Qualify, serve, advance", phases: ["career", "term"] },
  { id: "muster", label: "Muster", hint: "Benefits & connections", phases: ["muster", "muster_no_cash"] },
  { id: "done", label: "Done", hint: "Character sheet", phases: ["end"] },
];

export const mongooseModel: ChargenModel = {
  id: "mongoose",
  label: "Mongoose Traveller 2e",
  entryPhase: () => "career",
  execute(ch: Character, action: FrontierAction): ChargenResult {
    switch (action.kind) {
      case "enlist":
        return { snapshot: doEnlist(ch, action.opts) };
      case "runTerm":
        return { snapshot: doRunTerm(ch) };
      case "attemptMusterOut":
        return { snapshot: doMusterAction(ch) };
      case "musterChoice":
      case "pickSkill":
      case "preCareer":
        throw new Error(`mongoose model does not handle the "${action.kind}" action`);
    }
  },
  pausedPhase(action: FrontierAction): ChargenPhase {
    switch (action.kind) {
      case "enlist":
        return "career";
      case "runTerm":
        return "term";
      case "attemptMusterOut":
        return "muster";
      case "musterChoice":
      case "pickSkill":
      case "preCareer":
        return "term";
    }
  },
  flowStages: () => STAGES,
};

registerModel(mongooseModel);
