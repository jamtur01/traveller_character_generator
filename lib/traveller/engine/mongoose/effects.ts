// The Mongoose 2e effect interpreter: applies a MongooseEffect[] (from a career
// event, mishap, rank benefit, or life event) to a character. Shared by the
// mishap resolver, the events step, and the life-events table. Also owns the
// dependent table rolls those effects trigger: the Injury table, a nested
// Mishap roll, and the Life Events table.
//
// Player-choice effects (gainSkillChoice, gainAnySkill, modifyCharacteristicChoice,
// chooseEffect) route through pickOrDefer, so they resolve inline in auto mode
// and pause for the UI in interactive mode. Characteristic reductions from
// injury/ageing are applied by an auto heuristic (reduce the highest scores to
// avoid an ageing crisis) rather than a per-point prompt.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { event as ev } from "@/lib/traveller/history";
import { requireRule, parseDieCount } from "@/lib/traveller/editions/strict";
import { characteristicDm, rollCheck } from "@/lib/traveller/core";
import { getMongooseData, getCareer, rollParoleThreshold } from "@/lib/traveller/engine/mongoose/core";
import { grantSkillFloor, grantSkillIncrement, skillLevel } from "@/lib/traveller/engine/mongoose/skills";
import { promote, commission } from "@/lib/traveller/engine/mongoose/ranks";
import type { MongooseEffect, MongooseReduction } from "@/lib/traveller/engine/mongoose/types";

const ATTR_ABBREV: Record<string, AttributeKey> = {
  STR: "strength", DEX: "dexterity", END: "endurance",
  INT: "intelligence", EDU: "education", SOC: "social",
};
const PHYSICAL: readonly AttributeKey[] = ["strength", "dexterity", "endurance"];

/** Apply a list of effects in order. */
export function applyEffects(ch: Character, effects: readonly MongooseEffect[]): void {
  for (const e of effects) applyEffect(ch, e);
}

function grantOne(ch: Character, name: string, level: number | undefined): void {
  if (level !== undefined) grantSkillFloor(ch, name, level, "Event");
  else grantSkillIncrement(ch, name, "Event");
}

/** Resolve a "D3" / "2D" / numeric count string to a number. */
function rollCount(ch: Character, count: string): number {
  if (/^\d+$/.test(count)) return Number(count);
  const dN = count.match(/^D(\d+)$/);
  if (dN) return ch.rng.int(1, Number(dN[1]));
  const nD = count.match(/^(\d+)D$/);
  if (nD) return ch.rng.roll(Number(nD[1]));
  throw new Error(`Mongoose effect: unrecognized die/count spec "${count}" (expected "<n>", "<n>D", or "D<n>").`);
}

/** Resolve a Parole Threshold delta (Core p.52): a signed integer, a plain
 *  integer string, or a signed die-string ("-1D", "+2D") rolled on `ch.rng`.
 *  The Prisoner "hire a lawyer" event uses "-1D"; simple events use fixed ints. */
function paroleDelta(ch: Character, delta: number | string): number {
  if (typeof delta === "number") return delta;
  const die = delta.match(/^([+-]?)(\d+)D$/);
  if (die) return (die[1] === "-" ? -1 : 1) * ch.rng.roll(Number(die[2]));
  if (/^[+-]?\d+$/.test(delta)) return Number(delta);
  throw new Error(`Mongoose modifyParoleThreshold: unrecognized delta "${delta}" (expected number, "±N", or "±ND").`);
}

/** Candidate skills for "gain any skill": trained skills (existingOnly) or
 *  trained + background skills otherwise. */
function anySkillPool(ch: Character, existingOnly: boolean): string[] {
  const trained = ch.skills.map(([n]) => n);
  if (existingOnly) return [...new Set(trained)];
  return [...new Set([...trained, ...getMongooseData(ch).backgroundSkills])];
}

/** Best DM among a check's options: characteristic DM for an attribute abbrev,
 *  skill level (min 0) for a skill name. */
function checkOptionsDm(ch: Character, options: readonly string[]): number {
  const bands = getMongooseData(ch).characteristicDmBands;
  const dms = options.map((o) => {
    const attr = ATTR_ABBREV[o];
    if (attr) return characteristicDm(ch.attributes[attr], bands);
    return Math.max(0, skillLevel(ch, o));
  });
  return dms.length > 0 ? Math.max(...dms) : 0;
}

/** Apply characteristic reductions (injury / ageing): for each reduction pick
 *  `count` distinct characteristics from its pool (default physical), reducing
 *  the highest-scoring ones first to avoid a crisis. Distinct across the whole
 *  reduction set (injury row 1: "one physical by 1D, two OTHER by 2"). */
export function applyReductions(ch: Character, reductions: readonly MongooseReduction[]): void {
  const used = new Set<string>();
  for (const red of reductions) {
    const pool = (red.pool ?? PHYSICAL).filter((a) => !used.has(a));
    const ordered = [...pool].sort((a, b) => ch.attributes[b as AttributeKey] - ch.attributes[a as AttributeKey]);
    for (let i = 0; i < red.count && i < ordered.length; i++) {
      const attr = ordered[i]!;
      used.add(attr);
      const amount = typeof red.amount === "number" ? red.amount : rollCount(ch, red.amount);
      ch.improveAttribute(attr as AttributeKey, -amount);
    }
  }
}

/** Roll on the Injury table (Core p.49). twiceTakeLower -> roll 1D twice and
 *  take the worse (lower) result. */
export function rollInjury(ch: Character, twiceTakeLower: boolean): void {
  const injury = getMongooseData(ch).injury;
  const r1 = ch.rng.roll(1);
  const roll = twiceTakeLower ? Math.min(r1, ch.rng.roll(1)) : r1;
  const row = requireRule(
    injury.find((x) => x.roll === roll), `mongoose.injury[${roll}]`, "MgT2 Core p.49",
  );
  ch.log(ev.raw(`Injury (${roll}): ${row.text}`));
  applyReductions(ch, row.reductions);
}

/** Resolve a Mishap (Core p.18): roll 1D on the current career's Mishap table,
 *  log it, apply its effects, then eject + lose the term's benefit roll unless
 *  the roll said "not ejected" or an effect set stayInCareer. */
export function resolveMishap(ch: Character, ejected: boolean): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const career = getCareer(ch, requireRule(state.career, "mongooseState.career", "engine"));
  const roll = ch.rng.roll(1);
  const row = requireRule(
    career.mishaps.find((m) => m.roll === roll),
    `mongoose.careers.${career.id}.mishaps[${roll}]`, "MgT2 Core",
  );
  ch.log(ev.mongooseMishap(roll, row.text));
  applyEffects(ch, row.effects);
  if (ejected && !state.perTerm.noEject) {
    state.perTerm.mustLeave = true;
    state.perTerm.loseBenefitThisTerm = true;
  }
}

/** Resolve a Life Event (Core p.46): roll 2D on the Life Events table, apply
 *  its effects; a 12 rolls 1D on the Unusual Event sub-table. */
export function resolveLifeEvent(ch: Character): void {
  const data = getMongooseData(ch);
  const roll = ch.rng.roll(2);
  const row = requireRule(
    data.lifeEvents.find((r) => r.roll === roll), `mongoose.lifeEvents[${roll}]`, "MgT2 Core p.46",
  );
  ch.log(ev.raw(`Life Event (${roll}): ${row.text}`));
  applyEffects(ch, row.effects);
  if (roll === data.lifeEventsUnusualTrigger) {
    const uRoll = ch.rng.roll(1);
    const uRow = requireRule(
      data.lifeEventsUnusual.find((r) => r.roll === uRoll),
      `mongoose.lifeEventsUnusual[${uRoll}]`, "MgT2 Core p.46",
    );
    ch.log(ev.raw(`Unusual Event (${uRoll}): ${uRow.text}`));
    applyEffects(ch, uRow.effects);
  }
}

function applyEffect(ch: Character, e: MongooseEffect): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  switch (e.kind) {
    case "gainSkill":
      grantOne(ch, e.skill, e.level);
      return;
    case "gainSkillChoice":
      ch.pickOrDefer({
        kind: "mongooseSkillChoice", label: "Choose a skill", options: e.options,
        onResolve: (c, chosen) => grantOne(c, chosen, e.level),
      });
      return;
    case "gainAnySkill": {
      const pool = anySkillPool(ch, e.existingOnly === true);
      if (pool.length === 0) return;
      ch.pickOrDefer({
        kind: "mongooseSkillChoice", label: "Choose any skill", options: pool,
        onResolve: (c, chosen) => grantOne(c, chosen, e.level),
      });
      return;
    }
    case "modifyCharacteristic":
      ch.improveAttribute(e.characteristic as AttributeKey, e.delta);
      return;
    case "modifyCharacteristicChoice":
      ch.pickOrDefer({
        kind: "mongooseSkillChoice", label: "Choose a characteristic", options: e.characteristics,
        onResolve: (c, chosen) => c.improveAttribute(chosen as AttributeKey, e.delta),
      });
      return;
    case "benefitDm": state.pendingDms.benefit.push({ dm: e.dm, scope: e.scope }); return;
    case "advancementDm": state.pendingDms.advancement.push({ dm: e.dm, scope: e.scope }); return;
    case "survivalDm": state.pendingDms.survival.push({ dm: e.dm, scope: e.scope }); return;
    case "qualificationDm": state.pendingDms.qualification.push({ dm: e.dm, scope: e.scope }); return;
    case "gainRelation": {
      const n = rollCount(ch, e.count);
      for (let i = 0; i < n; i++) state.connections.push({ relation: e.relation, note: "" });
      ch.log(ev.mongooseConnection(e.relation, n > 1 ? `x${n}` : undefined));
      return;
    }
    case "rollMishap": resolveMishap(ch, e.ejected); return;
    case "rollInjury": rollInjury(ch, e.twiceTakeLower); return;
    case "lifeEvent": resolveLifeEvent(ch); return;
    case "autoPromote": promote(ch); return;
    case "autoCommission": commission(ch); return;
    case "benefitRoll": state.benefitRolls = Math.max(0, state.benefitRolls + e.delta); return;
    case "forfeitBenefits":
      state.benefitRolls = 0;
      ch.log(ev.raw("Forfeited all benefits from this career."));
      return;
    case "leaveCareer":
      state.perTerm.mustLeave = true;
      if (!e.keepBenefit) state.perTerm.loseBenefitThisTerm = true;
      return;
    case "stayInCareer": state.perTerm.noEject = true; return;
    case "forceCareer":
      state.forcedNextCareer = e.career;
      state.perTerm.mustLeave = true;
      ch.log(ev.raw(`Forced into the ${e.career} career next term.`));
      return;
    case "offerCareer": state.offeredNextCareer = e.career; return;
    case "rollDraft": state.mustDraft = true; return;
    case "rollForceCareer": {
      const r = ch.rng.roll(parseDieCount(e.dice, "mongoose rollForceCareer.dice"));
      if (e.results.includes(r)) {
        state.forcedNextCareer = e.career;
        state.perTerm.mustLeave = true;
        ch.log(ev.raw(`Rolled ${r} - forced into the ${e.career} career next term.`));
      }
      return;
    }
    case "chooseEffect": {
      const labels = e.options.map((_, i) => `Option ${i + 1}`);
      ch.pickOrDefer({
        kind: "mongooseEventChoice", label: "Choose an outcome", options: labels,
        onResolve: (c, chosen) => applyEffects(c, e.options[labels.indexOf(chosen)] ?? []),
      });
      return;
    }
    case "check": {
      const dm = checkOptionsDm(ch, e.options);
      const r = rollCheck(ch.rng, [dm], e.target);
      ch.log(ev.roll(`Event check (${e.options.join("/")})`, r.roll, dm, e.target, r.success));
      applyEffects(ch, r.success ? e.onSuccess : e.onFailure);
      return;
    }
    case "modifyParoleThreshold": {
      if (state.paroleThreshold === null) return; // meaningful only inside a parole career
      const career = getCareer(ch, requireRule(state.career, "mongooseState.career", "engine (mongoose)"));
      const parole = requireRule(career.parole, `mongoose.careers.${career.id}.parole`, "MgT2 Core p.52");
      const delta = paroleDelta(ch, e.delta);
      state.paroleThreshold = Math.min(parole.max, state.paroleThreshold + delta);
      ch.log(ev.raw(`Parole Threshold ${delta >= 0 ? "+" : ""}${delta} -> ${state.paroleThreshold}.`));
      return;
    }
    case "rerollParoleThreshold": {
      if (state.paroleThreshold === null) return;
      const career = getCareer(ch, requireRule(state.career, "mongooseState.career", "engine (mongoose)"));
      const parole = requireRule(career.parole, `mongoose.careers.${career.id}.parole`, "MgT2 Core p.52");
      state.paroleThreshold = rollParoleThreshold(ch, parole);
      ch.log(ev.raw(`Parole Threshold re-rolled -> ${state.paroleThreshold}.`));
      return;
    }
    case "rollSubTable": {
      const idx = ch.rng.roll(1);
      applyEffects(ch, e.entries[idx - 1] ?? []);
      return;
    }
    default: {
      const _: never = e;
      void _;
      throw new Error(`Unhandled mongoose effect: ${JSON.stringify(e)}`);
    }
  }
}
