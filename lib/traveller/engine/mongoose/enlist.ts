// Mongoose 2e career entry: Qualification, career commitment, and Basic
// Training (Core pp.18-19). Assignment selection and the failure -> draft /
// Drifter routing are the model's responsibility (engine/mongoose model, T27);
// these are the atomic mechanics it composes.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { event as ev } from "@/lib/traveller/history";
import { rollCheck } from "@/lib/traveller/core";
import { requireRule } from "@/lib/traveller/editions/strict";
import { consumePendingDm, freshPendingDms } from "@/lib/traveller/engine/mongoose/state";
import { getCareer, getMongooseData, checkDm, rollParoleThreshold, splitTopLevelOr } from "@/lib/traveller/engine/mongoose/core";
import { grantSkillFloor } from "@/lib/traveller/engine/mongoose/skills";
import { applyRankBenefit, currentLadder } from "@/lib/traveller/engine/mongoose/ranks";
import type { MongooseCareer } from "@/lib/traveller/engine/mongoose/types";

/** Attempt to qualify for a career (Core p.18): roll 2D + best-characteristic
 *  DM - 1 per previous career + pending qualification DMs, vs the target.
 *  Drifter (empty characteristics) qualifies automatically with no roll, as
 *  does a Noble whose SOC meets `autoQualifyAtLeast` (Core p.38). Army/Marine/
 *  Navy apply the qualification `ageDm` when old enough (Core p.24/32/36).
 *  Returns whether qualification succeeded; the caller commits via enterCareer. */
export function qualifyForCareer(ch: Character, careerId: string): boolean {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const career = getCareer(ch, careerId);
  const check = career.qualification;
  if (check.characteristics.length === 0) {
    ch.log(ev.raw(`Qualified for ${career.displayName} (automatic).`));
    return true;
  }
  const auto = check.autoQualifyAtLeast;
  if (auto && ch.attributes[auto.attribute as AttributeKey] >= auto.value) {
    ch.log(ev.raw(`Qualified for ${career.displayName} (automatic: ${auto.attribute} ${auto.value}+).`));
    return true;
  }
  const ageDm = check.ageDm && ch.age >= check.ageDm.minAge ? check.ageDm.dm : 0;
  const dm = checkDm(ch, check)
    + state.careerCount * getMongooseData(ch).qualificationDmPerPriorCareer
    + ageDm
    + consumePendingDm(state.pendingDms.qualification);
  const r = rollCheck(ch.rng, [dm], check.target);
  ch.log(ev.roll(
    `Qualification (${career.displayName})`, r.roll, dm, check.target, r.success,
  ));
  return r.success;
}

/** Commit entry into a career + assignment: reset the career-scoped state to
 *  rank 0 and apply basic training (Core pp.18-19). */
export function enterCareer(
  ch: Character, careerId: string, assignmentId: string,
): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const career = getCareer(ch, careerId);
  const asg = requireRule(
    career.assignments.find((a) => a.id === assignmentId),
    `mongoose.careers.${careerId}.assignments.${assignmentId}`, "MgT2 Core",
  );
  state.career = careerId;
  state.assignment = assignmentId;
  state.rank = 0;
  state.commissioned = false;
  state.termsInCareer = 0;
  // Drop any career-scoped ("any") DMs left over from the previous career so
  // they cannot leak into this one (Core p.52 prisoner event 5, etc.).
  state.pendingDms = freshPendingDms();
  // Prisoner (Core p.52): entering a parole career rolls the initial Parole
  // Threshold (1D+2, max 12); every other career has no threshold.
  state.paroleThreshold = career.parole ? rollParoleThreshold(ch, career.parole) : null;
  ch.log(ev.section(`${career.displayName} - ${asg.displayName}`));
  // Rank 0 is attained on entry, so its ladder benefit is granted immediately
  // (Core p.19: "bonuses acquired immediately upon attaining the rank"). Army
  // Gun Combat 1, Marine Gun Combat/Melee choice, Prisoner Melee (unarmed) 1.
  applyRankBenefit(ch, currentLadder(ch), 0);
  applyBasicTraining(ch, career, assignmentId);
}

/** Basic training (Core p.19): the FIRST career grants every skill on the
 *  training table at level 0; a SUBSEQUENT career grants ONE chosen skill at
 *  level 0. Citizen and Drifter draw from the chosen Assignment skill table;
 *  every other career draws from Service Skills. A first-career cell carrying a
 *  top-level " or " ("Drive or Vacc Suit") is a player choice of one skill. */
export function applyBasicTraining(
  ch: Character, career: MongooseCareer, assignmentId: string,
): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const useAssignment = career.basicTrainingFromAssignment === true;
  const table = useAssignment
    ? requireRule(
        career.assignments.find((a) => a.id === assignmentId),
        `mongoose.careers.${career.id}.assignments.${assignmentId}`, "MgT2 Core",
      ).skills
    : career.skillTables.serviceSkills;
  const names = table.filter((c): c is string => typeof c === "string");
  if (state.careerCount === 0) {
    for (const name of names) {
      const parts = splitTopLevelOr(name);
      if (parts.length > 1) {
        ch.pickOrDefer({
          kind: "mongooseSkillChoice",
          label: `Basic training: choose one of ${name} (gained at level 0)`,
          options: parts,
          onResolve: (c, chosen) => grantSkillFloor(c, chosen, 0, "Basic Training"),
        });
      } else {
        grantSkillFloor(ch, name, 0, "Basic Training");
      }
    }
    return;
  }
  ch.pickOrDefer({
    kind: "mongooseBasicSkill",
    label: "Basic training: choose a service skill (gained at level 0)",
    options: names,
    onResolve: (c, chosen) => grantSkillFloor(c, chosen, 0, "Basic Training"),
  });
}
