// Whole-character correctness oracle. Given a FINISHED `Character`, this
// asserts every invariant that can be DERIVED FROM the edition JSON (rank
// ladders, rankCaps, attribute bounds, skill caps, term/age arithmetic,
// muster tables, decoration awards) and throws a descriptive error naming the
// violated invariant, the offending value, and the JSON path it came from.
//
// This is the oracle the exhaustive generation driver runs on every generated
// character across all editions/models. It reads game data ONLY through the
// engine's public accessors (getEdition / getAcgPathway / edition data
// getters) — never hardcoded game values — so the expectations track the JSON.
//
// `$soloPolicy` convention (see docs/superpowers/plans/2026-07-06-pathway-as-
// json-soloPolicy.md): a JSON value carrying a sibling `$soloPolicy` key is a
// DELIBERATE non-book engine choice. Any expectation governed by such a value
// is SKIPPED and recorded in the caller-supplied `divergences` list rather
// than thrown on. No values are tagged yet; the mechanism is exercised via
// `soloPolicyReason` so it is live for the migration phases.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import type { ServiceData } from "@/lib/traveller/editions/types";
import type { MongooseData, MongooseRanks } from "@/lib/traveller/engine/mongoose/types";
import type { AcgState } from "@/lib/traveller/engine/acg/state";
import { getEdition, getAcgPathway } from "@/lib/traveller/editions";
import { parseRankLetter, rankNum } from "@/lib/traveller/engine/predicate";

const ATTR_KEYS: readonly AttributeKey[] = [
  "strength", "dexterity", "endurance", "intelligence", "education", "social",
];

/** One expectation the oracle deliberately did NOT enforce because a
 *  `$soloPolicy`-tagged JSON value governs it. */
export interface SoloDivergence {
  /** The invariant that would have run. */
  invariant: string;
  /** JSON path of the `$soloPolicy`-tagged value. */
  jsonPath: string;
  /** The `$soloPolicy` prose reason (cites the unspecified book page). */
  reason: string;
}

/** Return the `$soloPolicy` reason string if `value` is annotated with a
 *  sibling `$soloPolicy` key, else null. This is the single parser of the
 *  annotation convention: `{ "$soloPolicy": "<reason>", "value": <v> }`. A
 *  value WITHOUT the key is a by-the-book value and must be validated. */
export function soloPolicyReason(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("$soloPolicy" in value)) return null;
  const reason = (value as Record<string, unknown>).$soloPolicy;
  return typeof reason === "string" ? reason : String(reason);
}

function fail(invariant: string, message: string): never {
  throw new Error(`assertCharacterConsistent[${invariant}]: ${message}`);
}

/**
 * Assert every JSON-derivable whole-character invariant on a finished
 * character. Throws on the first violation. Any expectation governed by a
 * `$soloPolicy`-tagged JSON value is skipped and pushed onto `divergences`
 * (the "known solo divergences" list) instead of throwing.
 */
export function assertCharacterConsistent(
  ch: Character,
  divergences: SoloDivergence[] = [],
): void {
  checkAttributes(ch);
  checkSkills(ch);
  checkAge(ch);
  checkRank(ch);
  checkMuster(ch);
  checkDecorations(ch);
  checkMongooseCharacteristics(ch, divergences);
}

// --- attribute bounds (cross-edition) --------------------------------------

/** Every attribute lies within the edition's declared hard limits
 *  (`rules.attributeCaps.min` .. `rules.attributeCaps.max`). */
function checkAttributes(ch: Character): void {
  const caps = getEdition(ch.editionId).rules.attributeCaps;
  const { min, max } = caps ?? {};
  if (min === undefined || max === undefined) {
    fail("attributeBounds", `edition "${ch.editionId}" declares no rules.attributeCaps.min/max`);
  }
  for (const k of ATTR_KEYS) {
    const v = ch.attributes[k];
    if (v < min || v > max) {
      fail(
        "attributeBounds",
        `${k}=${v} is outside [${min},${max}] (rules.attributeCaps.min/max)`,
      );
    }
  }
}

// --- skills (cross-edition floor; mongoose per-skill + total caps) ---------

/** Every skill level is >= 0. For editions with a per-skill level cap
 *  (mongoose `skillLevelMax`), no level exceeds it, and the summed skill
 *  levels do not exceed the edition's total cap (`skillTotalCap`). */
function checkSkills(ch: Character): void {
  for (const [name, level] of ch.skills) {
    if (level < 0) fail("skillLevelFloor", `skill "${name}" level ${level} < 0`);
  }
  if (ch.chargenModelId !== "mongoose") return;
  const m = getEdition(ch.editionId).data.mongoose;
  if (!m) return;
  for (const [name, level] of ch.skills) {
    if (level > m.skillLevelMax) {
      fail(
        "skillLevelCap",
        `skill "${name}" level ${level} > mongoose.skillLevelMax ${m.skillLevelMax}`,
      );
    }
  }
  const { multiplier, attributes } = m.skillTotalCap;
  const cap = multiplier * attributes.reduce((s, a) => s + ch.attributes[a as AttributeKey], 0);
  const total = ch.skills.reduce((s, [, l]) => s + l, 0);
  if (total > cap) {
    fail(
      "skillTotalCap",
      `total skill levels ${total} > ${cap} ` +
      `(mongoose.skillTotalCap ${multiplier}×(${attributes.join("+")}))`,
    );
  }
}

// --- age vs terms served ---------------------------------------------------

/** Age equals start age plus the years implied by the terms served, using the
 *  model's term-length arithmetic. */
function checkAge(ch: Character): void {
  if (ch.chargenModelId === "mongoose") return checkAgeMongoose(ch);
  if (ch.chargenModelId === "acg") return checkAgeAcg(ch);
  return checkAgeClassic(ch);
}

/** CT/MT basic: startAge + full-terms×fullTermYears + short-terms×shortTermYears. */
function checkAgeClassic(ch: Character): void {
  const ed = getEdition(ch.editionId);
  const svc = serviceData(ch);
  if (!svc || svc.startAge === undefined) return;
  const fullTermYears = ed.rules.survival?.fullTermYears;
  if (fullTermYears === undefined) {
    fail("age", `edition "${ch.editionId}" missing rules.survival.fullTermYears`);
  }
  const fullTerms = ch.terms - ch.shortTermsCount;
  let served = fullTerms * fullTermYears;
  let shortYears = 0;
  if (ch.shortTermsCount > 0) {
    const short = ed.rules.survival?.shortTermYears;
    if (short === undefined) {
      fail("age", `${ch.shortTermsCount} short terms but no rules.survival.shortTermYears`);
    }
    shortYears = short;
    served += ch.shortTermsCount * short;
  }
  const expected = svc.startAge + served;
  if (ch.age !== expected) {
    fail(
      "age",
      `age ${ch.age} != startAge ${svc.startAge} + served ${served} ` +
      `(${fullTerms} full×${fullTermYears} + ${ch.shortTermsCount} short×${shortYears}); ` +
      `services.${ch.service}.startAge + rules.survival.*TermYears`,
    );
  }
}

/** Mongoose: startAge + terms×termLengthYears (engine sets age this way). */
function checkAgeMongoose(ch: Character): void {
  const m = getEdition(ch.editionId).data.mongoose;
  if (!m) return;
  const expected = m.startAge + ch.terms * m.termLengthYears;
  if (ch.age !== expected) {
    fail(
      "age",
      `age ${ch.age} != mongoose.startAge ${m.startAge} + terms ${ch.terms} ` +
      `× mongoose.termLengthYears ${m.termLengthYears} = ${expected}`,
    );
  }
}

/** ACG chronological age is EXACTLY reconstructable from the stored summands:
 *  startAge + yearsServed (one per year served) + preCareerAgeYears (academy/
 *  college/school time, PM p. 47) + imprisonmentAgeYears (jail sentences, PM
 *  p. 47). The engine stores each summand on AcgState, so the identity is
 *  exact — not a bound. Any drift means an unaudited age source or an engine
 *  bug. `startAge` = advancedCharacterGeneration.common.startAge. */
function checkAgeAcg(ch: Character): void {
  const ed = getEdition(ch.editionId);
  const startAge = ed.data.advancedCharacterGeneration?.common?.startAge;
  const acg = ch.acgState;
  if (startAge === undefined || !acg) return;
  const yearsServed = acg.yearsServed ?? 0;
  const preCareerAgeYears = acg.preCareerAgeYears ?? 0;
  const imprisonmentAgeYears = acg.imprisonmentAgeYears ?? 0;
  const expected = startAge + yearsServed + preCareerAgeYears + imprisonmentAgeYears;
  if (ch.age !== expected) {
    fail(
      "age",
      `age ${ch.age} != advancedCharacterGeneration.common.startAge ${startAge} ` +
      `+ acgState.yearsServed ${yearsServed} + acgState.preCareerAgeYears ` +
      `${preCareerAgeYears} + acgState.imprisonmentAgeYears ${imprisonmentAgeYears} ` +
      `= ${expected}`,
    );
  }
}

// --- rank on ladder / within cap -------------------------------------------

function checkRank(ch: Character): void {
  if (ch.chargenModelId === "mongoose") return checkRankMongoose(ch);
  if (ch.chargenModelId === "acg") return checkRankAcg(ch);
  return checkRankClassic(ch);
}

/** CT/MT basic: rank is an index into services.<svc>.ranks; it may not exceed
 *  the highest index that carries a title (scouts: all null → rank must be 0). */
function checkRankClassic(ch: Character): void {
  const svc = serviceData(ch);
  if (!svc) return;
  const ranks = svc.ranks;
  let maxIndex = 0;
  for (let i = 0; i < ranks.length; i++) if (ranks[i]) maxIndex = i;
  if (ch.rank < 0 || ch.rank > maxIndex) {
    fail(
      "rank",
      `rank ${ch.rank} outside [0,${maxIndex}] for service "${ch.service}" ` +
      `(highest titled index in services.${ch.service}.ranks is ${maxIndex})`,
    );
  }
  if (ch.rank > 0 && !ranks[ch.rank]) {
    fail("rank", `rank ${ch.rank} has no title in services.${ch.service}.ranks`);
  }
}

/** ACG: rankCode must parse; navy additionally caps the officer rank number at
 *  advancedCharacterGeneration.navy.rankCaps[fleet] and the code must be on
 *  the navy officer/enlisted ladder. */
function checkRankAcg(ch: Character): void {
  const acg = ch.acgState;
  if (!acg) return;
  if (!parseRankLetter(acg.rankCode)) {
    fail("rank", `acg rankCode "${acg.rankCode}" is not a parseable rank code`);
  }
  if (acg.pathway === "navy") checkRankAcgNavy(ch, acg);
}

function checkRankAcgNavy(ch: Character, acg: Extract<AcgState, { pathway: "navy" }>): void {
  const data = getAcgPathway(ch.editionId, "navy");
  if (!data) return;
  const ladder = (acg.isOfficer ? data.ranks.officer : data.ranks.enlisted) as
    ReadonlyArray<readonly unknown[]>;
  const codes = ladder.map((row) => String(row[0]));
  if (!codes.includes(acg.rankCode)) {
    fail(
      "rank",
      `navy rankCode "${acg.rankCode}" not in the ${acg.isOfficer ? "officer" : "enlisted"} ` +
      `ladder (advancedCharacterGeneration.navy.ranks)`,
    );
  }
  if (!acg.isOfficer) return;
  const cap = data.rankCaps?.[acg.fleet];
  if (cap === undefined) {
    fail("rankCap", `advancedCharacterGeneration.navy.rankCaps.${acg.fleet} is undefined`);
  }
  if (rankNum(acg.rankCode) > cap) {
    fail(
      "rankCap",
      `navy officer rank ${acg.rankCode} (${rankNum(acg.rankCode)}) exceeds cap ${cap} ` +
      `for fleet ${acg.fleet} (advancedCharacterGeneration.navy.rankCaps.${acg.fleet})`,
    );
  }
}

/** Mongoose: the current rank and every completed-career rank lie within the
 *  0..maxRank window of that career's rank ladders (mongoose.careers.<id>.ranks). */
function checkRankMongoose(ch: Character): void {
  const m = getEdition(ch.editionId).data.mongoose;
  const st = ch.mongooseState;
  if (!m || !st) return;
  for (const rec of st.history) {
    validateMongooseRank(m, rec.career, rec.finalRank, `history career "${rec.career}"`);
  }
  if (st.career) validateMongooseRank(m, st.career, st.rank, `current career "${st.career}"`);
}

function validateMongooseRank(
  m: MongooseData, careerId: string, rank: number, ctx: string,
): void {
  const career = m.careers[careerId];
  if (!career) return;
  const max = maxMongooseRank(career.ranks);
  if (rank < 0 || rank > max) {
    fail(
      "rank",
      `mongoose ${ctx} rank ${rank} outside [0,${max}] (mongoose.careers.${careerId}.ranks)`,
    );
  }
}

function maxMongooseRank(ranks: MongooseRanks): number {
  let max = 0;
  for (const ladder of Object.values(ranks.enlisted)) {
    for (const rung of ladder) if (rung.rank > max) max = rung.rank;
  }
  if (ranks.officer) for (const rung of ranks.officer) if (rung.rank > max) max = rung.rank;
  return max;
}

// --- muster-out rolls + table membership -----------------------------------

function checkMuster(ch: Character): void {
  if (ch.chargenModelId === "mongoose") return checkMusterMongoose(ch);
  return checkMusterClassic(ch);
}

/** CT/MT basic + ACG (shared muster system): every muster-out benefit/cash
 *  result came from THIS character's service muster table, cash rolls stay
 *  within rules.musterOutRolls.maxCashTableRolls, and the total roll count
 *  stays within perTerm×terms plus the largest rank-band bonus. */
function checkMusterClassic(ch: Character): void {
  const ed = getEdition(ch.editionId);
  const svc = serviceData(ch);
  if (!svc) return;
  const benefitSet = new Set(svc.musterOut.benefits.filter((b): b is string => b != null));
  const cashSet = new Set(svc.musterOut.cash.filter((c): c is number => c != null));
  let benefitRolls = 0;
  let cashRolls = 0;
  for (const e of ch.events) {
    if (e.kind === "musterBenefit") {
      benefitRolls++;
      if (e.benefit !== undefined && !benefitSet.has(e.benefit)) {
        fail(
          "musterBenefit",
          `benefit "${e.benefit}" is not in services.${ch.service}.musterOut.benefits`,
        );
      }
    } else if (e.kind === "musterCash" && e.source === undefined) {
      cashRolls++;
      if (e.amount !== 0 && !cashSet.has(e.amount)) {
        fail(
          "musterCash",
          `cash ${e.amount} is not in services.${ch.service}.musterOut.cash`,
        );
      }
    }
  }
  const mor = ed.rules.musterOutRolls;
  const maxCash = mor?.maxCashTableRolls;
  if (maxCash !== undefined && cashRolls > maxCash) {
    fail(
      "musterCashCap",
      `${cashRolls} cash rolls > rules.musterOutRolls.maxCashTableRolls ${maxCash}`,
    );
  }
  const perTerm = mor?.perTerm ?? 0;
  const upper = perTerm * ch.terms + maxRankBandBonus(ch);
  if (benefitRolls + cashRolls > upper) {
    fail(
      "musterRolls",
      `${benefitRolls + cashRolls} muster rolls > upper bound ${upper} ` +
      `(rules.musterOutRolls.perTerm ${perTerm}×terms ${ch.terms} + max rank-band bonus)`,
    );
  }
}

/** Largest additionalRolls declared across every rank-extra-rolls band
 *  (base + per-source), i.e. the most any rank can add. */
function maxRankBandBonus(ch: Character): number {
  const mor = getEdition(ch.editionId).rules.musterOutRolls;
  let max = 0;
  for (const b of mor?.rankExtraRolls ?? []) if (b.additionalRolls > max) max = b.additionalRolls;
  for (const bands of Object.values(mor?.rankExtraRollsBySource ?? {})) {
    for (const b of bands) if (b.additionalRolls > max) max = b.additionalRolls;
  }
  return max;
}

/** Mongoose: cash-column rolls stay within mongoose.cashRollCap (Core p.46). */
function checkMusterMongoose(ch: Character): void {
  const m = getEdition(ch.editionId).data.mongoose;
  const st = ch.mongooseState;
  if (!m || !st) return;
  if (st.cashRollsUsed < 0 || st.cashRollsUsed > m.cashRollCap) {
    fail(
      "musterCashCap",
      `mongoose cashRollsUsed ${st.cashRollsUsed} outside [0,${m.cashRollCap}] ` +
      `(mongoose.cashRollCap)`,
    );
  }
}

// --- decorations (ACG) -----------------------------------------------------

/** Every ACG decoration is a declared award (the award of a decoration tier,
 *  or the Purple Heart, in the pathway or common decorationTiers block). */
function checkDecorations(ch: Character): void {
  if (ch.chargenModelId !== "acg") return;
  const acg = ch.acgState;
  if (!acg || acg.decorations.length === 0) return;
  const awards = declaredAcgAwards(ch.editionId, acg.pathway);
  for (const d of acg.decorations) {
    if (!awards.has(d)) {
      fail(
        "decoration",
        `award "${d}" is not a declared decoration ` +
        `(advancedCharacterGeneration.${acg.pathway}.decorationTiers / common.decorationTiers)`,
      );
    }
  }
}

interface DecorationTiersBlock {
  tiers?: Array<{ award?: unknown }>;
  purpleHeart?: { award?: unknown };
}

function declaredAcgAwards(editionId: string, pathway: string): Set<string> {
  const common = getEdition(editionId).data.advancedCharacterGeneration?.common?.decorationTiers;
  const sources: Array<DecorationTiersBlock | undefined> = [
    getAcgPathway(editionId, pathway)?.decorationTiers as DecorationTiersBlock | undefined,
    common as DecorationTiersBlock | undefined,
  ];
  const out = new Set<string>();
  for (const dt of sources) {
    if (!dt) continue;
    for (const t of dt.tiers ?? []) if (typeof t.award === "string") out.add(t.award);
    if (typeof dt.purpleHeart?.award === "string") out.add(dt.purpleHeart.award);
  }
  return out;
}

// --- mongoose characteristic floor (>=1 unless a $soloPolicy aging path) ---

/** MgT2 Core p.49: a Traveller reduced to a 0 characteristic dies / needs
 *  referee adjudication, so a finished (surviving) mongoose Traveller has no
 *  0 characteristic. If the engine's aging-crisis floor is migrated into JSON
 *  as a `$soloPolicy`-tagged value, record the divergence and skip. */
function checkMongooseCharacteristics(ch: Character, divergences: SoloDivergence[]): void {
  if (ch.chargenModelId !== "mongoose") return;
  const m = getEdition(ch.editionId).data.mongoose;
  if (!m) return;
  const restore = (m as unknown as Record<string, unknown>).agingCrisisRestore;
  const reason = soloPolicyReason(restore);
  if (reason !== null) {
    divergences.push({
      invariant: "mongooseCharacteristicFloor",
      jsonPath: "mongoose.agingCrisisRestore",
      reason,
    });
    return;
  }
  for (const k of ATTR_KEYS) {
    if (ch.attributes[k] < 1) {
      fail(
        "mongooseCharacteristicFloor",
        `${k}=${ch.attributes[k]} < 1 (MgT2 Core p.49: a live Traveller has no 0 characteristic)`,
      );
    }
  }
}

// --- shared helpers --------------------------------------------------------

/** This character's service definition JSON, or undefined when the edition
 *  declares no services for the key (mongoose has an empty service map). */
function serviceData(ch: Character): ServiceData | undefined {
  return getEdition(ch.editionId).data.services[ch.service];
}
