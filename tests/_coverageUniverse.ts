// Coverage universe — the registry-derived enumeration of every character-
// creation PATH ELEMENT across all active editions, as a set of stable string
// TAGs. A later ledger diffs this universe against the tags a finished
// character touched (tests/_coverageRecorder.ts) to report unexercised paths.
//
// Discipline (mirrors tests/_coverageMatrix.ts): every enumerable VALUE
// (services, cascade members, pathways, careers, assignments, event/mishap
// rows, muster rows) is sourced at call time from the option-domain accessor +
// the edition/service registries, NEVER from a hardcoded list. Add a service /
// cascade skill / pathway / career to the edition JSON and its tags appear here
// automatically; the tests/coverageUniverse.test.ts self-check proves the
// universe stays non-empty and keeps the expected element KINDS per edition.
//
// The only string literals below are (a) optionDomain decisionId KEYS (the
// accessor's API — "acg.pathway", "acg.navy.fleet", …), (b) JSON structural
// KEYS the schema declares (skillTableMeta.order table keys, service
// musterOut.{benefits,cash} shape), and (c) the engine's terminal
// chargenStatus discriminant (TERMINAL_OUTCOMES — from types.ts ChargenStatus /
// history.ts endGeneration `reason`, an engine contract, not a game-content
// list). None is a service / cascade / pathway / career / assignment VALUE.
//
// FAIL-LOUD: a silently-empty universe is the worst outcome (the diff would
// then report "everything unexercised" or "nothing to cover"). The registry
// accessors already throw on missing JSON (getEnlistableServices /
// cascadePoolByKey / optionDomain via requireRule); coverageUniverse() adds a
// final assertion that the built universe is non-empty and that every
// service-model / ACG / mongoose edition contributed its mandatory element
// kinds.

import { listEditions, getEdition, getAcgPathway } from "@/lib/traveller/editions";
import { getEnlistableServices, getDraftServices } from "@/lib/traveller/services";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import { cascadePoolByKey } from "@/lib/traveller/engine/cascadeMap";
import type { ServiceKey } from "@/lib/traveller/types";

/** Metadata carried by each universe tag. `ns` is the tag's namespace (its
 *  element KIND); `playerChoice` distinguishes a decision the player makes
 *  (which service / table / cascade member / pathway) from a dice-gated outcome
 *  (which benefit row / event / mishap the die selected). */
export interface TagMeta {
  readonly ns: string;
  readonly edition: string | null;
  readonly playerChoice: boolean;
  readonly label: string;
}

/** The engine's terminal chargen states (types.ts `ChargenStatus` /
 *  history.ts `endGeneration.reason`). An engine discriminant, not a
 *  game-content enumerable — the coverage element is "did a <model> character
 *  reach this terminal state". */
const TERMINAL_OUTCOMES = ["mustered", "deceased", "retired"] as const;

/** Muster rows 1-7 are the declared 1D(+DM) index range of
 *  `services.*.musterOut.{benefits,cash}` (serviceLoader reads exactly these
 *  indices). JSON SHAPE, not a value list. */
const MUSTER_ROWS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Read a string field off an `unknown` JSON entry via literal-field narrowing
 *  (no shape assertion): returns the value only when the field is a string. */
function readStringField(entry: unknown, field: "displayName"): string | null {
  if (entry !== null && typeof entry === "object" && field in entry) {
    const value = entry[field];
    if (typeof value === "string") return value;
  }
  return null;
}

/** The pre-career school option KEYS for an edition (JSON
 *  advancedCharacterGeneration.common.preCareerOptions), minus `$`-prefixed
 *  metadata. Empty for editions without an ACG block. */
export function preCareerOptionKeys(editionId: string): string[] {
  const opts = getEdition(editionId).data.advancedCharacterGeneration?.common
    ?.preCareerOptions;
  if (!opts) return [];
  return Object.keys(opts).filter((k) => !k.startsWith("$"));
}

/** Display label for a pre-career option key (reads the JSON `displayName`). */
export function preCareerDisplayName(editionId: string, key: string): string {
  const opts = getEdition(editionId).data.advancedCharacterGeneration?.common
    ?.preCareerOptions;
  const label = opts ? readStringField(opts[key], "displayName") : null;
  return label ?? key;
}

/** displayName -> option-key reverse map (the preCareer history event records
 *  the display label, not the key; the recorder inverts it here). */
export function preCareerKeyByDisplayName(editionId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of preCareerOptionKeys(editionId)) {
    out.set(preCareerDisplayName(editionId, key), key);
  }
  return out;
}

/** table display-name -> table key reverse map (skill events record the table
 *  DISPLAY name in `source`; the recorder inverts it here). */
export function skillTableKeyByDisplayName(editionId: string): Map<string, string> {
  const meta = getEdition(editionId).data.skillTableMeta;
  const out = new Map<string, string>();
  if (!meta) return out;
  for (const key of meta.order) {
    out.set(meta.displayNames[key] ?? key, key);
  }
  return out;
}

/** edition + chargen-model entry tags. Choosing an edition and (for MT)
 *  classic-vs-ACG is a player choice. */
function addEditionTags(
  u: Map<string, TagMeta>, editionId: string, models: readonly string[],
): void {
  const name = getEdition(editionId).meta.displayName;
  u.set(`edition:${editionId}`, {
    ns: "edition", edition: editionId, playerChoice: true, label: `Edition ${name}`,
  });
  for (const model of models) {
    u.set(`model:${editionId}:${model}`, {
      ns: "model", edition: editionId, playerChoice: true,
      label: `${name} — ${model} chargen model`,
    });
  }
}

/** Emit the service-entry, skill-table, and muster-row tags for one service. */
function addOneServiceTags(
  u: Map<string, TagMeta>, editionId: string, service: ServiceKey, playerChoice: boolean,
): void {
  const data = getEdition(editionId).data;
  const svc = data.services[service];
  if (!svc) return;
  const meta = data.skillTableMeta;
  u.set(`svc:${editionId}:${service}`, {
    ns: "svc", edition: editionId, playerChoice,
    label: `${playerChoice ? "Enlist" : "Draft"}: ${svc.displayName}`,
  });
  for (const key of meta?.order ?? []) {
    u.set(`skilltable:${editionId}:${service}:${key}`, {
      ns: "skilltable", edition: editionId, playerChoice: true,
      label: `${svc.displayName} — skill from ${meta?.displayNames[key] ?? key}`,
    });
  }
  for (const row of MUSTER_ROWS) {
    const benefit = svc.musterOut.benefits[row];
    if (typeof benefit === "string") {
      u.set(`muster.benefit:${editionId}:${service}:${row}`, {
        ns: "muster.benefit", edition: editionId, playerChoice: false,
        label: `${svc.displayName} benefit row ${row}: ${benefit}`,
      });
    }
    // serviceLoader coerces a printed-dash (null) cash cell to Cr0 and ALWAYS
    // rolls it, so every row 1-7 is a reachable landing — enumerate all seven.
    const cash = svc.musterOut.cash[row];
    u.set(`muster.cash:${editionId}:${service}:${row}`, {
      ns: "muster.cash", edition: editionId, playerChoice: false,
      label: `${svc.displayName} cash row ${row}: Cr${typeof cash === "number" ? cash : 0}`,
    });
  }
}

/** Service-model tags (classic / MT basic): every service reachable through
 *  the enlistment/draft flow OR by an enlistment `automaticIf` auto-enrolment
 *  (CT/MT nobles, Soc 10+ CotI). Enlistable services are a player choice;
 *  drafted and auto-enrolled ones are not. Empty for careers-model editions
 *  (getEnlistableServices returns []). */
function addServiceTags(u: Map<string, TagMeta>, editionId: string): void {
  const enlistable = getEnlistableServices(editionId);
  const covered = new Set<ServiceKey>(enlistable);
  for (const service of enlistable) addOneServiceTags(u, editionId, service, true);
  for (const service of getDraftServices(editionId)) {
    if (covered.has(service)) continue;
    addOneServiceTags(u, editionId, service, false);
    covered.add(service);
  }
  for (const service of autoEnrolledServices(editionId)) {
    if (covered.has(service)) continue;
    addOneServiceTags(u, editionId, service, false);
    covered.add(service);
  }
}

/** Services auto-enrolled by an enlistment `automaticIf` gate (CT/MT nobles,
 *  Soc 10+ via random enlistment): reachable and served like any service, but
 *  never voluntarily enlisted, so getEnlistableServices drops them. Sourced
 *  from the service JSON (checks.enlistment.automaticIf) — like the
 *  optionDomains auto-enrolled filter — never a literal list. */
function autoEnrolledServices(editionId: string): ServiceKey[] {
  const services = getEdition(editionId).data.services;
  const out: ServiceKey[] = [];
  for (const key of Object.keys(services) as ServiceKey[]) {
    if (services[key]?.checks.enlistment.automaticIf) out.push(key);
  }
  return out;
}

/** Cascade-pool tags: every member of every declared cascade pool (a cascade
 *  is a player pick of one member). Empty for editions without cascadeSkills. */
function addCascadeTags(u: Map<string, TagMeta>, editionId: string): void {
  const pools = getEdition(editionId).data.cascadeSkills;
  if (!pools) return;
  for (const key of Object.keys(pools)) {
    if (key.startsWith("$")) continue;
    for (const member of cascadePoolByKey(key, editionId)) {
      u.set(`cascade:${editionId}:${key}:${member}`, {
        ns: "cascade", edition: editionId, playerChoice: true,
        label: `${key} cascade: ${member}`,
      });
    }
  }
}

/** MT pre-career school tags (one per declared school option). */
function addPreCareerTags(u: Map<string, TagMeta>, editionId: string): void {
  for (const key of preCareerOptionKeys(editionId)) {
    u.set(`precareer:${editionId}:${key}`, {
      ns: "precareer", edition: editionId, playerChoice: true,
      label: `Pre-career: ${preCareerDisplayName(editionId, key)}`,
    });
  }
}

/** Read an optionDomain's declared values, or [] when the domain isn't offered
 *  by this edition. optionDomain throws on a missing JSON key for a pathway
 *  that IS present — the fail-loud we want. */
function domainValues(
  editionId: string, decisionId: string, offered: boolean,
): readonly string[] {
  return offered ? optionDomain(editionId, decisionId).values : [];
}

/** MT ACG tags: pathway entry + per-pathway role decisions that are both
 *  optionDomain/getAcgPathway-enumerable AND stored on acgState in a matching
 *  value format (pathway, navy fleet, scout division, merchant line type,
 *  mercenary combat arm). Format-divergent role sub-fields (branch, office,
 *  department, mercenary service, subsector tech) and per-assignment /
 *  per-school / decoration enumerables are deferred (see the module header of
 *  tests/_coverageRecorder.ts). */
function addAcgTags(u: Map<string, TagMeta>, editionId: string): void {
  if (!getEdition(editionId).data.advancedCharacterGeneration) return;
  const pathways = optionDomain(editionId, "acg.pathway").values;
  for (const pathway of pathways) {
    u.set(`acg.pathway:${editionId}:${pathway}`, {
      ns: "acg.pathway", edition: editionId, playerChoice: true,
      label: `ACG pathway: ${pathway}`,
    });
  }
  for (const fleet of domainValues(editionId, "acg.navy.fleet", pathways.includes("navy"))) {
    u.set(`acg.fleet:${editionId}:${fleet}`, {
      ns: "acg.fleet", edition: editionId, playerChoice: true, label: `Navy fleet: ${fleet}`,
    });
  }
  for (const div of domainValues(editionId, "acg.scout.division", pathways.includes("scout"))) {
    u.set(`acg.division:${editionId}:${div}`, {
      ns: "acg.division", edition: editionId, playerChoice: true, label: `Scout division: ${div}`,
    });
  }
  for (const line of domainValues(editionId, "acg.merchant.lineType", pathways.includes("merchantPrince"))) {
    u.set(`acg.lineType:${editionId}:${line}`, {
      ns: "acg.lineType", edition: editionId, playerChoice: true, label: `Merchant line: ${line}`,
    });
  }
  const merc = pathways.includes("mercenary") ? getAcgPathway(editionId, "mercenary") : undefined;
  for (const arm of merc?.combatArms ?? []) {
    u.set(`acg.combatArm:${editionId}:${arm}`, {
      ns: "acg.combatArm", edition: editionId, playerChoice: true,
      label: `Mercenary combat arm: ${arm}`,
    });
  }
}

/** Mongoose 2e tags: careers (voluntary + forced-only), per-career assignments,
 *  and per-career event (2D) / mishap (1D) table rows. */
function addMongooseTags(u: Map<string, TagMeta>, editionId: string): void {
  const mongoose = getEdition(editionId).data.mongoose;
  if (!mongoose) return;
  for (const [careerId, career] of Object.entries(mongoose.careers)) {
    u.set(`mgt.career:${editionId}:${careerId}`, {
      ns: "mgt.career", edition: editionId, playerChoice: !career.forcedOnly,
      label: `${career.displayName}${career.forcedOnly ? " (forced)" : ""}`,
    });
    for (const asg of career.assignments) {
      u.set(`mgt.assignment:${editionId}:${careerId}:${asg.id}`, {
        ns: "mgt.assignment", edition: editionId, playerChoice: true,
        label: `${career.displayName} / ${asg.displayName}`,
      });
    }
    for (const row of career.events) {
      u.set(`mgt.event:${editionId}:${careerId}:${row.roll}`, {
        ns: "mgt.event", edition: editionId, playerChoice: false,
        label: `${career.displayName} event ${row.roll}`,
      });
    }
    for (const row of career.mishaps) {
      u.set(`mgt.mishap:${editionId}:${careerId}:${row.roll}`, {
        ns: "mgt.mishap", edition: editionId, playerChoice: false,
        label: `${career.displayName} mishap ${row.roll}`,
      });
    }
  }
}

/** Terminal-outcome tags, one per (chargen model, terminal state). */
function addOutcomeTags(u: Map<string, TagMeta>, models: ReadonlySet<string>): void {
  for (const model of models) {
    for (const reason of TERMINAL_OUTCOMES) {
      u.set(`outcome:${model}:${reason}`, {
        ns: "outcome", edition: null, playerChoice: false,
        label: `${model} character ${reason}`,
      });
    }
  }
}

/** Build the coverage universe: every path-element tag across all ACTIVE
 *  editions, keyed by its stable string tag. Registry-driven and fail-loud. */
export function coverageUniverse(): Map<string, TagMeta> {
  const u = new Map<string, TagMeta>();
  const models = new Set<string>();
  for (const meta of listEditions()) {
    if (meta.status !== "active") continue;
    for (const m of meta.chargenModels) models.add(m);
    addEditionTags(u, meta.id, meta.chargenModels);
    addServiceTags(u, meta.id);
    addCascadeTags(u, meta.id);
    addPreCareerTags(u, meta.id);
    addAcgTags(u, meta.id);
    addMongooseTags(u, meta.id);
  }
  addOutcomeTags(u, models);
  assertUniverseComplete(u);
  return u;
}

/** Fail loud on a silently-empty universe or a service-model / ACG / mongoose
 *  edition that contributed none of its mandatory element kinds — a missing
 *  registry read must surface here, not as a diff that reports nothing. */
function assertUniverseComplete(u: Map<string, TagMeta>): void {
  if (u.size === 0) {
    throw new Error("coverageUniverse: built an EMPTY universe — a registry read is missing.");
  }
  for (const meta of listEditions()) {
    if (meta.status !== "active") continue;
    const data = getEdition(meta.id).data;
    if (getEnlistableServices(meta.id).length > 0) {
      requireKind(u, "svc", meta.id);
      requireKind(u, "skilltable", meta.id);
    }
    if (data.cascadeSkills) requireKind(u, "cascade", meta.id);
    if (data.advancedCharacterGeneration) {
      requireKind(u, "precareer", meta.id);
      requireKind(u, "acg.pathway", meta.id);
    }
    if (data.mongoose) {
      requireKind(u, "mgt.career", meta.id);
      requireKind(u, "mgt.assignment", meta.id);
    }
  }
}

function requireKind(u: Map<string, TagMeta>, ns: string, editionId: string): void {
  for (const meta of u.values()) {
    if (meta.ns === ns && meta.edition === editionId) return;
  }
  throw new Error(
    `coverageUniverse: edition "${editionId}" declares data for element kind ` +
      `"${ns}" but produced no such tags — a registry read is missing or empty.`,
  );
}
