// Coverage / catalog audit for the classic-engine skill, muster-benefit, and
// characteristic glossaries (8d705f9 CT skills, ab0ae1a MT skills, 83da80e CT
// muster+position, 2480589 MT muster, fb22216/933a185 characteristics).
//
// The drift-guard both DRY re-reviews flagged: a reachable grant with no gloss
// silently narrates nothing. This audit enumerates EVERY skill name that
// `Character.addSkill` can receive from the engine's enumerable sources — the
// same resolution cellResolver.applyCell / serviceLoader use — and asserts each
// is EITHER in that edition's `skillDefinitions` OR in a documented allowlist.
//
// Enumerable sources (per edition):
//   * services.*.skillTables.{personalDevelopment,serviceSkills,advancedEducation}
//   * cascadeSkills pools (resolved via cascadeAliases)
//   * includesSkills umbrellas -> constituents
//   * services.*.automaticSkills[].skill / .effect
//   * homeworld.defaultSkills[].skill (MT)
// Levels ("-N") and specialities are stripped; skillLabelRenames is applied to
// the literal cell exactly as cellResolver does; characteristic-boost cells
// ("+1 Stren", "Physical") are dropped (they never reach addSkill).
//
// Two failure modes, both with teeth:
//   * a reachable skill neither glossed nor allowlisted -> a real coverage gap.
//   * a STALE allowlist entry -> allowlisted yet now glossed OR no longer
//     reachable (so the exemption is dead and must be removed).
//
// Muster-benefit and characteristic coverage are the analogous assertions:
// every benefit token that reaches logMusterBenefitMeaning is glossed, and each
// of the six engine characteristics is glossed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function loadEdition(id: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(__dirname, `../../data/editions/${id}.json`), "utf8"),
  );
  if (!isRecord(raw)) throw new Error(`edition ${id} JSON is not an object`);
  return raw;
}

// An attribute-boost cell ("+1 Stren", "-1 Social", "+1 Strength") — resolved by
// cellResolver.applyCell's leading regex to improveAttribute, never addSkill.
const ATTR_CELL = /^[+-]\d+\s+\w+$/;

function isAttrBoost(label: string): boolean {
  return ATTR_CELL.test(label.trim());
}

/** Speciality/level-stripped includes-expansion of `name`, mirroring
 *  cellResolver.includesExpansion: "Laser Weapons-0" -> "Laser Weapons". */
function includesConstituents(
  data: Record<string, unknown>, name: string,
): string[] | null {
  const inc = data.includesSkills;
  if (!isRecord(inc)) return null;
  const entry = inc[name];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const out: string[] = [];
  for (const item of entry) {
    if (typeof item !== "string") continue;
    const m = /^(.+)-(\d+)$/.exec(item);
    out.push(m ? m[1]!.trim() : item);
  }
  return out;
}

function cascadePool(
  data: Record<string, unknown>, label: string,
): readonly string[] | undefined {
  const aliases = isRecord(data.cascadeAliases) ? data.cascadeAliases : {};
  const key = aliases[label.toLowerCase().trim()];
  if (typeof key !== "string") return undefined;
  const pools = data.cascadeSkills;
  const pool = isRecord(pools) ? pools[key] : undefined;
  return Array.isArray(pool) ? (pool as string[]) : undefined;
}

/** A cascade-pool member picked by the engine reaches addSkill EITHER as the
 *  member literal (resolveAutoSkill / non-umbrella cascade pick) OR — when it is
 *  an includes umbrella — as its constituents (applyCell cascade-pick path).
 *  Both paths exist, so add both. Attribute-boost members are dropped. */
function addCascadeMember(out: Set<string>, data: Record<string, unknown>, name: string): void {
  if (isAttrBoost(name)) return;
  out.add(name);
  const constituents = includesConstituents(data, name);
  if (constituents) for (const c of constituents) if (!isAttrBoost(c)) out.add(c);
}

/** A literal skill-table cell: apply skillLabelRename, then includes-expand or
 *  add the renamed literal — exactly cellResolver's skill-mode tail. */
function addLiteralCell(out: Set<string>, data: Record<string, unknown>, label: string): void {
  const renames = isRecord(data.skillLabelRenames) ? data.skillLabelRenames : {};
  const rn = renames[label];
  const name = typeof rn === "string" ? rn : label;
  const constituents = includesConstituents(data, name);
  if (constituents) { for (const c of constituents) if (!isAttrBoost(c)) out.add(c); return; }
  if (!isAttrBoost(name)) out.add(name);
}

function addCell(out: Set<string>, data: Record<string, unknown>, label: string): void {
  if (isAttrBoost(label)) return;
  const pool = cascadePool(data, label);
  if (pool) { for (const m of pool) addCascadeMember(out, data, m); return; }
  addLiteralCell(out, data, label);
}

function enumerateService(out: Set<string>, data: Record<string, unknown>, svc: unknown): void {
  if (!isRecord(svc)) return;
  const tables = svc.skillTables;
  if (isRecord(tables)) {
    for (const tbl of ["personalDevelopment", "serviceSkills", "advancedEducation"]) {
      const row = tables[tbl];
      if (!Array.isArray(row)) continue;
      for (const cell of row) if (typeof cell === "string") addCell(out, data, cell);
    }
  }
  const autos = svc.automaticSkills;
  if (!Array.isArray(autos)) return;
  for (const auto of autos) {
    if (!isRecord(auto)) continue;
    if (typeof auto.effect === "string") { addCell(out, data, auto.effect); continue; }
    if (typeof auto.skill !== "string") continue;
    // serviceLoader.resolveAutoSkill: a cascade auto picks a pool member (added
    // literally, no includes expansion); otherwise the literal skill.
    const pool = cascadePool(data, auto.skill);
    if (pool) { for (const m of pool) if (!isAttrBoost(m)) out.add(m); continue; }
    if (!isAttrBoost(auto.skill)) out.add(auto.skill);
  }
}

/** Every skill name Character.addSkill can receive across the enumerable
 *  sources, resolved exactly as the engine resolves each cell. */
function enumerateReachableSkills(data: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const services = isRecord(data.services) ? data.services : {};
  for (const svc of Object.values(services)) enumerateService(out, data, svc);
  const cascades = data.cascadeSkills;
  if (isRecord(cascades)) {
    for (const pool of Object.values(cascades)) {
      if (Array.isArray(pool)) for (const m of pool) addCascadeMember(out, data, m as string);
    }
  }
  const inc = data.includesSkills;
  if (isRecord(inc)) {
    for (const u of Object.keys(inc)) {
      if (u.startsWith("$")) continue;
      const constituents = includesConstituents(data, u);
      if (constituents) for (const c of constituents) if (!isAttrBoost(c)) out.add(c);
    }
  }
  const hw = data.homeworld;
  const ds = isRecord(hw) && Array.isArray(hw.defaultSkills) ? hw.defaultSkills : [];
  for (const e of ds) {
    if (isRecord(e) && typeof e.skill === "string" && !isAttrBoost(e.skill)) out.add(e.skill);
  }
  return out;
}

function glossedSkillKeys(data: Record<string, unknown>): Set<string> {
  const defs = data.skillDefinitions;
  const keys = isRecord(defs) ? Object.keys(defs).filter((k) => !k.startsWith("$")) : [];
  return new Set(keys);
}

// ---------------------------------------------------------------------------
// Documented allowlists. Each entry names a reachable skill with NO gloss in
// the enabled sources, with a page-cited reason VERIFIED from the rulebooks.
// ---------------------------------------------------------------------------

// CT: fourteen skills whose only Traveller definition lives in Book 4
// (Mercenary) or Book 5 (High Guard); neither TTB nor CotI defines them.
// Verified against the CotI page renders (reference/pages/coti/p016-p017.png =
// printed pp.12-13, "General Description / Specific Game Effects").
const CT_SKILL_ALLOWLIST: Record<string, string> = {
  "Battle Dress": "CotI p.12: 'Battle Dress: Discussed in Book 4.' No TTB/CotI definition.",
  Carousing: "CotI p.12: 'Carousing: Discussed in Book 5.' No TTB/CotI definition.",
  Commo: "CotI p.12: 'Communications: Discussed in Book 5.' CT tables print the label 'Commo'.",
  Demolition: "CotI p.12: 'Demolition: Discussed in Book 4.' No TTB/CotI definition.",
  Gravitics: "CotI p.12: 'Gravitics: Discussed in Book 5.' No TTB/CotI definition.",
  Instruction: "CotI p.12: 'Instruction: Discussed in Book 4 and Book 5.' No TTB/CotI definition.",
  Interrogation: "CotI p.12: 'Interrogation: Discussed in Book 4 and Book 5.' No TTB/CotI definition.",
  Liaison: "CotI p.12: 'Liaison: Discussed in Book 5.' No TTB/CotI definition.",
  Recon: "CotI p.13: 'Recon: Discussed in Book 4.' No TTB/CotI definition.",
  Recruiting: "CotI p.13: 'Recruiting: Discussed in Book 4.' No TTB/CotI definition.",
  "Ship Tactic": "CotI p.13: 'Ship Tactics: Discussed in Book 5.' CT pirate table prints 'Ship Tactic'.",
  "Ship Tactics": "CotI p.13: 'Ship Tactics: Discussed in Book 5.' CT rogue table prints 'Ship Tactics'.",
  Survival: "CotI p.13: 'Survival: Discussed in Book 4.' No TTB/CotI definition.",
  "Zero-G Cbt": "CotI p.13: 'Zero-G Combat: Discussed in Book 4.' CT tables print 'Zero-G Cbt'.",
};

// MT: Shotgun has no standalone entry in the PM Skill Definitions (pp.30-40); a
// Traveller only receives it as a Rifleman Includes-constituent.
const MT_SKILL_ALLOWLIST: Record<string, string> = {
  Shotgun: "MT PM pp.30-40 Skill Definitions: no standalone Shotgun entry; reachable only as a "
    + "Rifleman Includes-constituent (Rifleman = Autorifle/Carbine/Rifle/Shotgun).",
};

function runSkillCoverage(
  id: string, allowlist: Record<string, string>, expectedUncovered: number,
): void {
  const data = loadEdition(id);
  const reachable = enumerateReachableSkills(data);
  const glossed = glossedSkillKeys(data);
  const allow = new Set(Object.keys(allowlist));

  it(`${id}: enumeration is non-vacuous and grounded`, () => {
    expect(reachable.size, "no reachable skills enumerated").toBeGreaterThan(40);
    expect(glossed.size, "no skillDefinitions").toBeGreaterThan(40);
  });

  it(`${id}: every reachable skill is glossed OR allowlisted (no coverage gap)`, () => {
    const gaps = [...reachable].filter((s) => !glossed.has(s) && !allow.has(s)).sort();
    expect(gaps, `reachable skills neither glossed nor allowlisted: ${gaps.join(", ")}`)
      .toEqual([]);
  });

  it(`${id}: the reachable-but-unglossed set is exactly the allowlist`, () => {
    const uncovered = [...reachable].filter((s) => !glossed.has(s)).sort();
    expect(uncovered.length, "unexpected reachable-unglossed count").toBe(expectedUncovered);
    expect(uncovered).toEqual(Object.keys(allowlist).sort());
  });

  it(`${id}: no allowlist entry is stale (still reachable AND still unglossed)`, () => {
    const nowGlossed = [...allow].filter((s) => glossed.has(s)).sort();
    expect(nowGlossed, `allowlisted but now glossed (drop from allowlist): ${nowGlossed.join(", ")}`)
      .toEqual([]);
    const unreachable = [...allow].filter((s) => !reachable.has(s)).sort();
    expect(unreachable, `allowlisted but no longer reachable (drop): ${unreachable.join(", ")}`)
      .toEqual([]);
  });

  it(`${id}: every allowlist reason cites a page (verified from the rulebooks)`, () => {
    for (const [skill, reason] of Object.entries(allowlist)) {
      expect(/\d/.test(reason), `${skill} allowlist reason must cite a page`).toBe(true);
      expect(reason.toLowerCase(), "reason must not use the word 'honest'").not.toContain("honest");
    }
  });
}

describe("CT skill coverage — reachable skills are glossed or allowlisted (8d705f9)", () => {
  runSkillCoverage("ct-classic", CT_SKILL_ALLOWLIST, 14);
});

describe("MT skill coverage — reachable skills are glossed or allowlisted (ab0ae1a)", () => {
  runSkillCoverage("mt-megatraveller", MT_SKILL_ALLOWLIST, 1);
});

// ---------------------------------------------------------------------------
// Muster-benefit coverage: every benefit token that reaches
// cellResolver.logMusterBenefitMeaning is glossed, and no gloss key is stale.
// ---------------------------------------------------------------------------

/** Map a muster-table cell to the key logMusterBenefitMeaning receives, or null
 *  when the cell logs no meaning (attribute change / non-blade/gun cascade).
 *  Mirrors cellResolver.applyCell mode="muster". */
function musterKeyForCell(data: Record<string, unknown>, label: string): string | null {
  if (isAttrBoost(label)) return null;
  const aliases = isRecord(data.cascadeAliases) ? data.cascadeAliases : {};
  const cascadeKey = aliases[label.toLowerCase().trim()];
  if (typeof cascadeKey === "string") {
    return cascadeKey === "bladeCombat" || cascadeKey === "gunCombat" ? label : null;
  }
  if (label === "Weapon") return "Weapon";
  if (label === "Travellers'") return "TAS";
  const bd = data.benefitDetails;
  const passages = isRecord(bd) && isRecord(bd.passages) ? bd.passages : {};
  const passage = passages[label];
  if (isRecord(passage) && typeof passage.displayName === "string") return passage.displayName;
  return label; // ship label or literal benefit — logged under its own name
}

function musterCells(data: Record<string, unknown>): Set<string> {
  const cells = new Set<string>();
  const services = isRecord(data.services) ? data.services : {};
  for (const svc of Object.values(services)) {
    const mo = isRecord(svc) && isRecord(svc.musterOut) ? svc.musterOut.benefits : undefined;
    const table = Array.isArray(mo) ? mo : isRecord(mo) ? Object.values(mo) : [];
    for (const cell of table) if (typeof cell === "string") cells.add(cell);
  }
  return cells;
}

function runMusterCoverage(id: string): void {
  const data = loadEdition(id);
  const defs = isRecord(data.musterBenefitDefinitions) ? data.musterBenefitDefinitions : {};
  const glossed = new Set(Object.keys(defs).filter((k) => !k.startsWith("$")));
  const reachableKeys = new Set<string>();
  for (const cell of musterCells(data)) {
    const key = musterKeyForCell(data, cell);
    if (key) reachableKeys.add(key);
  }

  it(`${id}: muster enumeration is non-vacuous`, () => {
    expect(reachableKeys.size, "no reachable muster keys").toBeGreaterThan(10);
    expect(glossed.size, "no musterBenefitDefinitions").toBeGreaterThan(10);
  });

  it(`${id}: every reachable muster benefit is glossed`, () => {
    const gaps = [...reachableKeys].filter((k) => !glossed.has(k)).sort();
    expect(gaps, `muster benefits reaching logMusterBenefitMeaning with no gloss: ${gaps.join(", ")}`)
      .toEqual([]);
  });

  it(`${id}: no muster gloss key is stale (unreachable)`, () => {
    const stale = [...glossed].filter((k) => !reachableKeys.has(k)).sort();
    expect(stale, `musterBenefitDefinitions keys never reached at muster: ${stale.join(", ")}`)
      .toEqual([]);
  });
}

describe("CT muster-benefit coverage (83da80e)", () => {
  runMusterCoverage("ct-classic");
});

describe("MT muster-benefit coverage (2480589)", () => {
  runMusterCoverage("mt-megatraveller");
});

// ---------------------------------------------------------------------------
// Characteristic coverage: each of the six engine characteristics is glossed.
// ---------------------------------------------------------------------------

const ENGINE_CHAR_CODES = ["STR", "DEX", "END", "INT", "EDU", "SOC"] as const;

function glossedCharCodes(block: unknown): Set<string> {
  const codes = new Set<string>();
  if (!Array.isArray(block)) return codes;
  for (const row of block) if (isRecord(row) && typeof row.code === "string") codes.add(row.code);
  return codes;
}

describe("characteristic coverage — the six engine characteristics are glossed", () => {
  it("CT (933a185) glosses all six", () => {
    const codes = glossedCharCodes(loadEdition("ct-classic").characteristicDefinitions);
    for (const c of ENGINE_CHAR_CODES) expect(codes.has(c), `CT missing ${c}`).toBe(true);
  });

  it("MT (fb22216) glosses all six", () => {
    const codes = glossedCharCodes(loadEdition("mt-megatraveller").characteristicDefinitions);
    for (const c of ENGINE_CHAR_CODES) expect(codes.has(c), `MT missing ${c}`).toBe(true);
  });

  it("Mongoose (fa7c7d4) glosses all six", () => {
    const M = loadEdition("mongoose-2e").mongoose as Record<string, unknown>;
    const codes = glossedCharCodes(M.characteristics);
    for (const c of ENGINE_CHAR_CODES) expect(codes.has(c), `Mongoose missing ${c}`).toBe(true);
  });
});
