// Coverage recorder — POST-HOC derivation of the coverage-universe tags a
// FINISHED character exercised, from its state + typed history event log
// (ch.events). No engine instrumentation: every path selection is already
// recorded in a character field or a typed HistoryEvent, so touchedTags() reads
// them back and maps each to the same stable tag scheme as
// tests/_coverageUniverse.ts. A later ledger diffs universe − touched to report
// unexercised paths.
//
// SUBSET INVARIANT: every tag this returns MUST be in coverageUniverse(). A
// touched tag outside the universe is a builder bug (a value the universe
// failed to enumerate, or a recorder/universe format drift) — surfaced loudly
// by touchedTags() rather than silently swallowed, so drift never hides as a
// falsely-"covered" path.
//
// EVENT -> TAG MAPPING (by element kind):
//   ch.editionId / ch.chargenModelId  -> edition:* , model:*
//   ch.chargenStatus.kind (terminal)  -> outcome:<model>:<mustered|deceased|retired>
//   classic model only:
//     ch.service                       -> svc:*
//     skillLearned/skillImproved/attributeChange.source (table display) -> skilltable:*
//     musterBenefit (outcome undefined): row = tableRoll+dm  -> muster.benefit:*
//     musterCash: row = clamp(tableRoll+dm, 1, 7)            -> muster.cash:*
//   cascadePick.cascade (label -> key) + .chosen (member)   -> cascade:*
//   preCareer.option (display label -> key)                 -> precareer:*
//   acgState.pathway / .fleet / .division / .lineType / .combatArm -> acg.*
//   mongooseState.history[] + .career/.assignment          -> mgt.career:* , mgt.assignment:*
//   mongooseEvent / mongooseMishap (roll+text -> career)   -> mgt.event:* , mgt.mishap:*
//
// DEFERRED elements (universe omits them too, so the subset invariant holds):
//   - skill CELLS at die granularity: the 1D roll that selects a cell is not
//     recorded (skill/attribute events carry the table DISPLAY name, not the
//     die). skilltable tags therefore mean "a skill OR attribute cell was
//     gained from this (service, table)" — both a plain-skill row (skillLearned)
//     and an attribute-boost row (attributeChange.source, since commit 0d5be16)
//     are derivable; only the die granularity within a table is deferred.
//   - ACG role sub-fields stored in pathway-specific value formats that don't
//     match their optionDomain enumerable (mercenary service "Army"/"marines",
//     navy branch, scout office, merchant department, subsector tech) and
//     ACG per-assignment / per-school / decoration enumerables (heterogeneous
//     JSON shapes: combatAssignments vs assignmentColumnMap vs
//     assignmentResolution office keys) — deferred to the enumeration-driver.
//   - mongoose skill tables (skill event `source` is a shared display label,
//     not career-scoped) and mongoose muster columns/rows (logged as free-text
//     `raw` events / folded into skill/attr/benefit grants, not a typed
//     column-carrying event) — not post-hoc derivable without text-scraping.
//   NOTE: nobles auto-enrollment (automaticIf-gated, Soc 10+, CotI/PM) IS a
//   real chargen path — a Soc-10+ character auto-enrols and serves in it — so
//   _coverageUniverse enumerates it as an auto-enrolled (non-player-choice)
//   service and recordClassic emits its svc/skilltable/muster tags like any
//   other service.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { cascadeKeyForLabel } from "@/lib/traveller/engine/cascadeMap";
import type { MongooseCareer } from "@/lib/traveller/engine/mongoose/types";
import {
  coverageUniverse,
  preCareerKeyByDisplayName,
  skillTableKeyByDisplayName,
} from "@/tests/_coverageUniverse";

/** The engine's terminal chargen states (types.ts ChargenStatus) — the ones
 *  that yield an outcome tag. Mirrors TERMINAL_OUTCOMES in _coverageUniverse. */
const TERMINAL_KINDS: Record<string, true> = { mustered: true, deceased: true, retired: true };

/** edition / model / terminal-outcome tags (every finished character). The
 *  terminal reason is read from the endGeneration event (the universal signal —
 *  the mongoose model logs it but leaves chargenStatus "active", ACG always
 *  ends "retired", classic reflects both) AND, defensively, from a terminal
 *  chargenStatus.kind. */
function recordCommon(ch: Character, tags: Set<string>): void {
  tags.add(`edition:${ch.editionId}`);
  tags.add(`model:${ch.editionId}:${ch.chargenModelId}`);
  const kind = ch.chargenStatus.kind;
  if (TERMINAL_KINDS[kind]) tags.add(`outcome:${ch.chargenModelId}:${kind}`);
  for (const e of ch.events) {
    if (e.kind === "endGeneration") tags.add(`outcome:${ch.chargenModelId}:${e.reason}`);
  }
}

/** Classic / MT-basic service tags: service entry, skill-table rolls that
 *  granted a skill, and muster benefit / cash rows. */
function recordClassic(ch: Character, tags: Set<string>): void {
  if (ch.chargenModelId !== "classic") return;
  const ed = ch.editionId;
  tags.add(`svc:${ed}:${ch.service}`);
  const tableKey = skillTableKeyByDisplayName(ed);
  for (const e of ch.events) {
    // A skill-table roll logs skillLearned/skillImproved for a plain-skill row
    // and (since 0d5be16) attributeChange carrying the table display name in
    // `source` for an attribute-boost row — both attribute back to the table.
    // Muster cells carry source "Muster" and aging/injury none, so tableKey.get
    // skips them; only genuine table-display sources map to a table key.
    if (e.kind === "skillLearned" || e.kind === "skillImproved" || e.kind === "attributeChange") {
      const key = e.source ? tableKey.get(e.source) : undefined;
      if (key) tags.add(`skilltable:${ed}:${ch.service}:${key}`);
    } else if (e.kind === "musterBenefit" && e.outcome === undefined) {
      tags.add(`muster.benefit:${ed}:${ch.service}:${e.tableRoll + e.dm}`);
    } else if (e.kind === "musterCash") {
      const row = Math.min(7, Math.max(1, e.tableRoll + e.dm));
      tags.add(`muster.cash:${ed}:${ch.service}:${row}`);
    }
  }
}

/** Cascade-pick tags (classic + ACG weapon / cell cascades). */
function recordCascade(ch: Character, tags: Set<string>): void {
  const ed = ch.editionId;
  for (const e of ch.events) {
    if (e.kind !== "cascadePick") continue;
    const key = cascadeKeyForLabel(e.cascade, ed);
    if (key) tags.add(`cascade:${ed}:${key}:${e.chosen}`);
  }
}

/** MT pre-career school tags (the event records the display label). */
function recordPreCareer(ch: Character, tags: Set<string>): void {
  const ed = ch.editionId;
  const keyByLabel = preCareerKeyByDisplayName(ed);
  for (const e of ch.events) {
    if (e.kind !== "preCareer") continue;
    const key = keyByLabel.get(e.option);
    if (key) tags.add(`precareer:${ed}:${key}`);
  }
}

/** MT ACG pathway + role-decision tags (read off acgState, matching the
 *  universe's optionDomain-enumerable sub-fields). */
function recordAcg(ch: Character, tags: Set<string>): void {
  const acg = ch.acgState;
  if (!acg) return;
  const ed = ch.editionId;
  tags.add(`acg.pathway:${ed}:${acg.pathway}`);
  if (acg.pathway === "navy") tags.add(`acg.fleet:${ed}:${acg.fleet}`);
  else if (acg.pathway === "scout") tags.add(`acg.division:${ed}:${acg.division}`);
  else if (acg.pathway === "merchantPrince" && acg.lineType !== null) {
    tags.add(`acg.lineType:${ed}:${acg.lineType}`);
  } else if (acg.pathway === "mercenary" && acg.combatArm !== null) {
    tags.add(`acg.combatArm:${ed}:${acg.combatArm}`);
  }
}

/** Emit mgt.event / mgt.mishap tags for one logged roll, attributing it to
 *  every touched career whose table has a row with the same (roll, text). The
 *  event text is verbatim JSON, so the match is exact; a row shared verbatim
 *  across careers (e.g. the roll-7 Life Event) may attribute to more than the
 *  emitting career when the character served several — bounded to careers
 *  actually served, and unambiguous for a single-career character. */
function recordRollTable(
  ed: string, ns: "mgt.event" | "mgt.mishap", roll: number, text: string,
  careers: ReadonlyMap<string, MongooseCareer>, tags: Set<string>,
): void {
  for (const [careerId, career] of careers) {
    const rows = ns === "mgt.event" ? career.events : career.mishaps;
    if (rows.some((r) => r.roll === roll && r.text === text)) {
      tags.add(`${ns}:${ed}:${careerId}:${roll}`);
    }
  }
}

/** Mongoose career / assignment / event / mishap tags. */
function recordMongoose(ch: Character, tags: Set<string>): void {
  const state = ch.mongooseState;
  if (!state) return;
  const ed = ch.editionId;
  const allCareers = getEdition(ed).data.mongoose?.careers;
  if (!allCareers) return;
  const served = new Map<string, MongooseCareer>();
  const noteCareer = (careerId: string, assignment: string | null): void => {
    const career = allCareers[careerId];
    if (!career) return;
    served.set(careerId, career);
    tags.add(`mgt.career:${ed}:${careerId}`);
    if (assignment !== null) tags.add(`mgt.assignment:${ed}:${careerId}:${assignment}`);
  };
  for (const rec of state.history) noteCareer(rec.career, rec.assignment);
  if (state.career !== null) noteCareer(state.career, state.assignment);
  for (const e of ch.events) {
    if (e.kind === "mongooseEvent") recordRollTable(ed, "mgt.event", e.roll, e.text, served, tags);
    else if (e.kind === "mongooseMishap") recordRollTable(ed, "mgt.mishap", e.roll, e.text, served, tags);
  }
}

let universeKeysMemo: ReadonlySet<string> | null = null;

/** Assert every derived tag is in the universe (subset invariant), throwing
 *  with the offenders when not — a recorder/universe drift is a builder bug. */
function assertSubset(tags: ReadonlySet<string>): void {
  if (universeKeysMemo === null) universeKeysMemo = new Set(coverageUniverse().keys());
  const universe = universeKeysMemo;
  const orphans: string[] = [];
  for (const tag of tags) if (!universe.has(tag)) orphans.push(tag);
  if (orphans.length > 0) {
    throw new Error(
      `touchedTags: ${orphans.length} tag(s) not in coverageUniverse() — a builder ` +
        `bug (unenumerated value or format drift): ${orphans.slice(0, 10).join(", ")}` +
        `${orphans.length > 10 ? " …" : ""}`,
    );
  }
}

/** Derive the set of coverage-universe tags a finished character exercised.
 *  Post-hoc over ch state + ch.events; every returned tag is guaranteed to be
 *  in coverageUniverse() (asserted). */
export function touchedTags(ch: Character): Set<string> {
  const tags = new Set<string>();
  recordCommon(ch, tags);
  recordClassic(ch, tags);
  recordCascade(ch, tags);
  recordPreCareer(ch, tags);
  recordAcg(ch, tags);
  recordMongoose(ch, tags);
  assertSubset(tags);
  return tags;
}
