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
import { titleize } from "@/lib/traveller/formatting";
import { characteristicDm, rollCheck } from "@/lib/traveller/core";
import { getMongooseData, getCareer, currentCareer, findRollRow, rollParoleThreshold, mongooseSkillNames, skillBaseName, ATTR_ABBREV } from "@/lib/traveller/engine/mongoose/core";
import { grantSkillFloor, grantSkillIncrement, skillLevel } from "@/lib/traveller/engine/mongoose/skills";
import { promote, commission } from "@/lib/traveller/engine/mongoose/ranks";
import type { MongooseEffect, MongooseReduction } from "@/lib/traveller/engine/mongoose/types";

// Full characteristic names — the ATTR_ABBREV forms (core.ts) are the ONLY valid
// attribute tokens in a check's options; a full name here means a data typo.
const CHARACTERISTIC_FULL_NAMES: Record<string, true> = {
  strength: true, dexterity: true, endurance: true,
  intelligence: true, education: true, social: true,
};

/** Apply a list of effects in order. */
export function applyEffects(
  ch: Character, effects: readonly MongooseEffect[], source?: string,
): void {
  for (const e of effects) applyEffect(ch, e, source);
}

function grantOne(ch: Character, name: string, level: number | undefined): void {
  if (level !== undefined) grantSkillFloor(ch, name, level, "Event");
  else grantSkillIncrement(ch, name, "Event");
}

/** Resolve a "D3" / "2D" / numeric count string to a number. Kept separate from
 *  strict.parseDieCount (which parses only "<n>D") and from paroleDelta (signed):
 *  this grammar also accepts a plain int and "D<n>" (an inclusive 1..n range, not
 *  a die count), so merging the three would need a mode/flag zoo (MG-DRY-6). */
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
 *  The Prisoner "hire a lawyer" event uses "-1D"; simple events use fixed ints.
 *  Distinct from rollCount/parseDieCount: it carries a sign (see MG-DRY-6). */
function paroleDelta(ch: Character, delta: number | string): number {
  if (typeof delta === "number") return delta;
  const die = delta.match(/^([+-]?)(\d+)D$/);
  if (die) return (die[1] === "-" ? -1 : 1) * ch.rng.roll(Number(die[2]));
  if (/^[+-]?\d+$/.test(delta)) return Number(delta);
  throw new Error(`Mongoose modifyParoleThreshold: unrecognized delta "${delta}" (expected number, "±N", or "±ND").`);
}

/** Candidate skills for "gain any skill": trained skills only (existingOnly,
 *  e.g. "increase a skill you already have") or the full Mongoose skill catalog
 *  otherwise (Core p.18). `exclude` removes named skills (Prisoner event 6:
 *  "except Jack-of-all-Trades"). The catalog is taken from mongooseSkillNames,
 *  which stores both level-suffixed cells ("Streetwise 1") and bare names; the
 *  bare-name filter keeps only pickable skill names. */
function anySkillPool(ch: Character, existingOnly: boolean, exclude: readonly string[]): string[] {
  const excluded = new Set(exclude);
  const names = existingOnly
    ? ch.skills.map(([n]) => n)
    : [...mongooseSkillNames(ch)].filter((n) => skillBaseName(n) === n);
  return [...new Set(names)].filter((n) => !excluded.has(n));
}

/** Best DM among a check's options: characteristic DM for an attribute abbrev,
 *  skill level (min 0) for a skill name. */
function checkOptionsDm(ch: Character, options: readonly string[]): number {
  const bands = getMongooseData(ch).characteristicDmBands;
  const dms = options.map((o) => {
    const attr = ATTR_ABBREV[o];
    if (attr) return characteristicDm(ch.attributes[attr], bands);
    // A full characteristic name ("education") or an abbreviation-shaped token
    // (three capitals) not in ATTR_ABBREV is a data typo, not a skill — fail
    // loud rather than silently scoring it as an untrained level-0 skill.
    if (CHARACTERISTIC_FULL_NAMES[o.toLowerCase()] || /^[A-Z]{3}$/.test(o)) {
      throw new Error(
        `mongoose check option "${o}" is not a valid characteristic abbreviation ` +
        `(${Object.keys(ATTR_ABBREV).join(", ")}) or skill name`,
      );
    }
    return Math.max(0, skillLevel(ch, o));
  });
  return dms.length > 0 ? Math.max(...dms) : 0;
}

/** Apply characteristic reductions (injury / ageing): for each reduction pick
 *  `count` distinct characteristics from its pool, reducing them in the order
 *  set by the mongoose.reductionPolicy $soloPolicy (Core p.49 leaves the pick
 *  to the player; "highestFirst" reduces the highest-scoring first to avoid a
 *  crisis). Distinct across the whole reduction set (injury row 1: "one
 *  physical by 1D, two OTHER by 2"). */
export function applyReductions(ch: Character, reductions: readonly MongooseReduction[]): void {
  const policy = requireRule(
    getMongooseData(ch).reductionPolicy, "mongoose.reductionPolicy", "MgT2 Core p.49 ($soloPolicy)",
  ).value;
  if (policy !== "highestFirst") {
    throw new Error(`mongoose.reductionPolicy: unsupported value "${policy}" (expected "highestFirst").`);
  }
  const used = new Set<string>();
  for (const red of reductions) {
    const pool = red.pool.filter((a) => !used.has(a));
    const ordered = [...pool].sort((a, b) => ch.attributes[b as AttributeKey] - ch.attributes[a as AttributeKey]);
    for (let i = 0; i < red.count && i < ordered.length; i++) {
      const attr = ordered[i]!;
      used.add(attr);
      const amount = typeof red.amount === "number" ? red.amount : rollCount(ch, red.amount);
      ch.improveAttribute(attr as AttributeKey, -amount);
    }
  }
  // Crisis restore (Core p.49 $soloPolicy): a reduction (injury OR ageing) that
  // drives a characteristic to <= 0 is a crisis the book leaves to a referee
  // (medical care / anagathics / death); this solo generator resolves it as
  // emergency medical care restoring each crisis characteristic to the declared
  // value. Applied here so injury and ageing are handled uniformly — a live
  // Traveller never keeps a 0 characteristic.
  const restore = requireRule(
    getMongooseData(ch).agingCrisisRestore,
    "mongoose.agingCrisisRestore", "MgT2 Core p.49 ($soloPolicy)",
  ).value;
  const crisis = [...used].filter((a) => ch.attributes[a as AttributeKey] <= 0) as AttributeKey[];
  if (crisis.length > 0) {
    for (const a of crisis) ch.improveAttribute(a, restore - ch.attributes[a]);
    ch.log(ev.raw(
      `Characteristic crisis: ${crisis.join(", ")} restored to ${restore} with emergency medical care.`,
    ));
  }
}

/** Apply a SPECIFIC Injury table row (Core p.49) by its roll value. */
export function applyInjuryRow(ch: Character, roll: number): void {
  const row = findRollRow(
    getMongooseData(ch).injury, roll, `mongoose.injury[${roll}]`, "MgT2 Core p.49",
  );
  ch.log(ev.raw(`Injury (${roll}): ${row.text}`));
  applyReductions(ch, row.reductions);
}

/** Roll on the Injury table (Core p.49). twiceTakeLower -> roll 1D twice and
 *  take the worse (lower) result. */
export function rollInjury(ch: Character, twiceTakeLower: boolean): void {
  const r1 = ch.rng.roll(1);
  const roll = twiceTakeLower ? Math.min(r1, ch.rng.roll(1)) : r1;
  applyInjuryRow(ch, roll);
}

/** Resolve a Mishap (Core p.18): roll 1D on the current career's Mishap table,
 *  log it, apply its effects, then eject + lose the term's benefit roll unless
 *  the roll said "not ejected" or an effect set stayInCareer. */
export function resolveMishap(ch: Character, ejected: boolean): void {
  const { state, career } = currentCareer(ch);
  const roll = ch.rng.roll(1);
  const row = findRollRow(
    career.mishaps, roll, `mongoose.careers.${career.id}.mishaps[${roll}]`, "MgT2 Core",
  );
  ch.log(ev.mongooseMishap(roll, row.text));
  applyEffects(ch, row.effects, row.text);
  if (ejected && !state.perTerm.noEject) {
    state.perTerm.mustLeave = true;
    // A "you may keep your Benefit roll" branch (leaveCareer{keepBenefit:true})
    // fired this mishap -> the forced ejection must not strip that benefit.
    if (!state.perTerm.benefitKept) state.perTerm.loseBenefitThisTerm = true;
  }
}

/** Resolve a Life Event (Core p.46): roll 2D on the Life Events table, apply
 *  its effects; a 12 rolls 1D on the Unusual Event sub-table. */
export function resolveLifeEvent(ch: Character): void {
  const data = getMongooseData(ch);
  const roll = ch.rng.roll(2);
  const row = findRollRow(
    data.lifeEvents, roll, `mongoose.lifeEvents[${roll}]`, "MgT2 Core p.46",
  );
  ch.log(ev.raw(`Life Event (${roll}): ${row.text}`));
  applyEffects(ch, row.effects, row.text);
  if (roll === data.lifeEventsUnusualTrigger) {
    const uRoll = ch.rng.roll(1);
    const uRow = findRollRow(
      data.lifeEventsUnusual, uRoll, `mongoose.lifeEventsUnusual[${uRoll}]`, "MgT2 Core p.46",
    );
    ch.log(ev.raw(`Unusual Event (${uRoll}): ${uRow.text}`));
    applyEffects(ch, uRow.effects, uRow.text);
  }
}

/** Reverse of ATTR_ABBREV: full characteristic key -> abbreviation
 *  ("dexterity" -> "DEX"). Effects carry the full key; choice labels show the
 *  short form ("DEX +1"). */
const CHAR_ABBREV: Record<string, string> = Object.fromEntries(
  Object.entries(ATTR_ABBREV).map(([abbrev, key]) => [key, abbrev]),
);

/** Signed integer for a display label: "+4", "-1". */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Characteristic abbreviation for a label; falls back to titleize on an
 *  unexpected token (a data typo) rather than crashing a cosmetic label. */
function charAbbrev(characteristic: string): string {
  return CHAR_ABBREV[characteristic] ?? titleize(characteristic);
}

/** "DM+4 to next Advancement" — shared by the four DM-nudge effect kinds. */
function dmPhrase(dm: number, scope: "next" | "any", subject: string): string {
  return `DM${signed(dm)} to ${scope} ${subject}`;
}

/** One-line human-readable summary of a single effect, keyed by kind.
 *  DISPLAY-ONLY: drives the chooseEffect option labels (parallels optionLabels)
 *  and is never consumed by resolution, onResolve, the decision-cursor/replay
 *  contract, or the RNG stream. The mapped type keeps this exhaustive over the
 *  MongooseEffect union. */
const EFFECT_DESCRIBERS: {
  [K in MongooseEffect["kind"]]: (e: Extract<MongooseEffect, { kind: K }>) => string;
} = {
  gainSkill: (e) => (e.level !== undefined ? `${e.skill} ${e.level}` : e.skill),
  gainSkillChoice: (e) => `${e.options.join("/")} 1`,
  gainAnySkill: () => "Any skill",
  modifyCharacteristic: (e) => `${charAbbrev(e.characteristic)} ${signed(e.delta)}`,
  modifyCharacteristicChoice: (e) =>
    `${e.characteristics.map(charAbbrev).join("/")} ${signed(e.delta)}`,
  benefitDm: (e) => dmPhrase(e.dm, e.scope, "Benefit"),
  advancementDm: (e) => dmPhrase(e.dm, e.scope, "Advancement"),
  survivalDm: (e) => dmPhrase(e.dm, e.scope, "Survival"),
  qualificationDm: (e) => dmPhrase(e.dm, e.scope, "Qualification"),
  gainRelation: (e) => `Gain ${/^[aeiou]/i.test(e.relation) ? "an" : "a"} ${titleize(e.relation)}`,
  benefitRoll: (e) => `${signed(e.delta)} Benefit roll`,
  leaveCareer: (e) =>
    e.keepBenefit ? "Leave this career (keep benefit)" : "Leave this career",
  stayInCareer: () => "Remain in this career",
  autoPromote: () => "Automatic promotion",
  autoCommission: () => "Automatic commission",
  forfeitBenefits: () => "Forfeit all benefits",
  forceCareer: (e) => `Transfer to ${titleize(e.career)}`,
  offerCareer: (e) => `Transfer to ${titleize(e.career)}`,
  rollForceCareer: (e) => `Transfer to ${titleize(e.career)}`,
  rollMishap: () => "Roll on the Mishap table",
  rollInjury: () => "Injury",
  applyInjury: () => "Injury",
  lifeEvent: () => "Life event",
  check: () => "Make a check",
  modifyParoleThreshold: () => "Adjust parole threshold",
  rerollParoleThreshold: () => "Re-roll parole threshold",
  rollDraft: () => "Roll on the Draft table",
  rollSubTable: () => "Roll on a sub-table",
  chooseEffect: () => "Choose an outcome",
};

/** Summarize one chooseEffect option bundle into readable text: each effect
 *  described and joined with " + "; an EMPTY bundle (a "may ..." decline
 *  branch) reads "Decline". DISPLAY-ONLY (see EFFECT_DESCRIBERS): the label a
 *  player reads, never the value resolution consumes. */
export function describeEffectBundle(effects: readonly MongooseEffect[]): string {
  if (effects.length === 0) return "Decline";
  return effects
    .map((e) => (EFFECT_DESCRIBERS[e.kind] as (x: MongooseEffect) => string)(e))
    .join(" + ");
}

function applyEffect(ch: Character, e: MongooseEffect, source?: string): void {
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
      const pool = anySkillPool(ch, e.existingOnly === true, e.exclude ?? []);
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
        kind: "mongooseSkillChoice", label: "Choose a characteristic",
        options: e.characteristics,
        optionLabels: e.characteristics.map(titleize),
        onResolve: (c, chosen) => c.improveAttribute(chosen as AttributeKey, e.delta),
      });
      return;
    case "benefitDm": state.pendingDms.benefit.push({ dm: e.dm, scope: e.scope }); return;
    case "advancementDm": state.pendingDms.advancement.push({ dm: e.dm, scope: e.scope }); return;
    case "survivalDm": state.pendingDms.survival.push({ dm: e.dm, scope: e.scope }); return;
    case "qualificationDm": state.pendingDms.qualification.push({ dm: e.dm, scope: e.scope }); return;
    case "gainRelation": {
      const n = rollCount(ch, e.count);
      for (let i = 0; i < n; i++) state.connections.push({ relation: e.relation, note: source ?? "" });
      ch.log(ev.mongooseConnection(e.relation, n > 1 ? `x${n}` : undefined));
      return;
    }
    case "rollMishap": resolveMishap(ch, e.ejected); return;
    case "rollInjury": rollInjury(ch, e.twiceTakeLower); return;
    case "applyInjury": applyInjuryRow(ch, e.roll); return;
    case "lifeEvent": resolveLifeEvent(ch); return;
    case "autoPromote": promote(ch); return;
    case "autoCommission": commission(ch); return;
    case "benefitRoll": state.benefitRolls = Math.max(0, state.benefitRolls + e.delta); return;
    case "forfeitBenefits":
      state.benefitRolls = 0;
      state.benefitsForfeited = true;
      ch.log(ev.raw("Forfeited all benefits from this career."));
      return;
    case "leaveCareer":
      state.perTerm.mustLeave = true;
      if (e.keepBenefit) state.perTerm.benefitKept = true;
      else state.perTerm.loseBenefitThisTerm = true;
      return;
    case "stayInCareer": state.perTerm.noEject = true; return;
    case "forceCareer":
      state.forcedNextCareer = e.career;
      state.perTerm.mustLeave = true;
      ch.log(ev.raw(`Forced into the ${e.career} career next term.`));
      return;
    case "offerCareer": state.offeredNextCareer = e.career; return;
    case "rollDraft":
      // A "forcibly drafted" event (Drifter event 11) leaves the current career
      // this term and drafts into the next; mustLeave routes the departure.
      state.mustDraft = true;
      state.perTerm.mustLeave = true;
      return;
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
        optionLabels: e.options.map(describeEffectBundle),
        onResolve: (c, chosen) => applyEffects(c, requireRule(
          e.options[labels.indexOf(chosen)], "mongoose chooseEffect option", "engine (mongoose)",
        ), source),
      });
      return;
    }
    case "check": {
      const dm = checkOptionsDm(ch, e.options);
      const r = rollCheck(ch.rng, [dm], e.target);
      ch.log(ev.roll(`Event check (${e.options.join("/")})`, r.roll, dm, e.target, r.success));
      applyEffects(ch, r.success ? e.onSuccess : e.onFailure, source);
      if (r.roll === getMongooseData(ch).survivalNaturalFail && e.onNatural2) applyEffects(ch, e.onNatural2, source);
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
      applyEffects(ch, requireRule(
        e.entries[idx - 1], `mongoose rollSubTable entry ${idx}`, "MgT2 Core",
      ), source);
      return;
    }
    default: {
      const _: never = e;
      void _;
      throw new Error(`Unhandled mongoose effect: ${JSON.stringify(e)}`);
    }
  }
}
