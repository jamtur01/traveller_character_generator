// Build a runtime ServiceDef from one canonical ServiceData entry.
// The resulting object has the same surface as the old hand-written services
// (enlistmentThrow, checkSurvival, acquireSkill, musterBenefits, etc.) so
// existing callers in character.ts and the test suite continue to work.

import { type Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import type { Attributes, CheckResult, ServiceDef } from "@/lib/traveller/types";
import { cascadePoolForLabel } from "./cascadeMap";
import type {
  AutoSkillEntry,
  CanonData,
  Edition,
  ServiceData,
} from "@/lib/traveller/editions/types";
import { applyCell } from "./cellResolver";
import { evaluateDM } from "./dmEvaluator";
import { requireRule } from "@/lib/traveller/editions/strict";
import { anagathicsSurvivalDm } from "@/lib/traveller/chargen/anagathics";

/** Skill-table key for the given table index (1-based). Order declared
 *  by the edition under `skillTableMeta.order`. */
function skillTableKeyForIndex(editionData: CanonData, idx: number): string | null {
  return editionData.skillTableMeta?.order[idx - 1] ?? null;
}

function skillTableDisplayNameForKey(editionData: CanonData, key: string): string {
  return editionData.skillTableMeta?.displayNames[key] ?? key;
}

/** Roll 2D + `dm` against `target`, log via ev.roll under `label`, and return
 *  the pass flag with the margin (roll + dm - target). The shared core of the
 *  basic-chargen survival / commission / promotion checks; each caller sums
 *  its own DMs (survival adds the anagathics penalty) and supplies the label. */
function check2dVsTarget(
  ch: Character, opts: { dm: number; target: number; label: string },
): CheckResult {
  const sv = ch.rng.roll(2);
  const margin = sv + opts.dm - opts.target;
  const succeeded = margin >= 0;
  ch.log(ev.roll(opts.label, sv, opts.dm, opts.target, succeeded));
  return { passed: succeeded, margin };
}

export function buildServiceDef(
  serviceData: ServiceData,
  edition: Edition,
): ServiceDef {
  const data: CanonData = edition.data;
  const benefitDetails = data.benefitDetails;

  // --- numeric throws ----------------------------------------------------
  // Enlistment is either a numeric throw or a declared automatic gate
  // (nobles: target null + automaticIf social 10+, CotI/PM) — exactly one.
  // Declaring both is contradictory data and fails loudly. The 0 below is
  // not a game value — it is the ServiceDef "2D >= 0 always passes" encoding
  // of an enlistment the JSON declares automatic; the automaticIf gate
  // itself is enforced by the nobility enlistment path.
  const enlistBlk = serviceData.checks.enlistment;
  if (enlistBlk.automaticIf && typeof enlistBlk.target === "number") {
    throw new Error(
      `services.${serviceData.displayName}.checks.enlistment declares both a ` +
      "numeric target and automaticIf — contradictory; declare exactly one.",
    );
  }
  const enlistmentThrow = enlistBlk.automaticIf
    ? 0
    : requireRule(
        enlistBlk.target,
        `services.${serviceData.displayName}.checks.enlistment.target`,
        "TTB/PM service tables",
      );
  const survivalThrow = requireRule(
    serviceData.checks.survival.target,
    `services.${serviceData.displayName}.checks.survival.target`, "TTB/PM service tables",
  );
  const commissionThrow = serviceData.checks.position?.target ?? undefined;
  // Roll-log / UI label for the position check: "Commission" (TTB) vs
  // "Position" (CotI). Strict-read from JSON (every position check declares a
  // label); undefined only for services with no position check, which never
  // reach a commission roll. Display-only — the mechanic is identical.
  const positionLabel = serviceData.checks.position
    ? requireRule(
        serviceData.checks.position.label,
        `services.${serviceData.displayName}.checks.position.label`,
        "TTB/PM service tables (Commission vs Position)",
      )
    : undefined;
  const promotionThrow = serviceData.checks.promotion?.target ?? undefined;
  const reenlistThrow = requireRule(
    serviceData.checks.reenlistment.target,
    `services.${serviceData.displayName}.checks.reenlistment.target`, "TTB/PM service tables",
  );

  const enlistmentDM = (a: Attributes): number => evaluateDM(
    serviceData.checks.enlistment.dms,
    // evaluateDM accepts a narrow DmContext ({attributes, terms}); no
    // cast needed. Enlistment is pre-term so terms=0.
    { attributes: a, terms: 0 },
  );

  // --- ranks -------------------------------------------------------------
  const ranks: Record<number, string> = {};
  for (let r = 0; r <= 6; r++) {
    ranks[r] = serviceData.ranks[r] ?? "";
  }

  // --- service automatic skills (on enlistment) -------------------------
  const getServiceSkills = (ch: Character): string[] => {
    const out: string[] = [];
    for (const e of serviceData.automaticSkills) {
      if (e.trigger !== "service") continue;
      if (!e.skill) continue;
      out.push(resolveAutoSkill(e.skill, ch));
    }
    return out;
  };

  // --- checks ------------------------------------------------------------
  const inverseReenlist = serviceData.checks.reenlistment.inverseToLeave;

  const checkSurvival = (ch: Character): boolean => {
    const dm = evaluateDM(serviceData.checks.survival.dms, ch) + anagathicsSurvivalDm(ch);
    return check2dVsTarget(ch, { dm, target: survivalThrow, label: "Survival" }).passed;
  };

  const checkCommission = (ch: Character): CheckResult => {
    if (
      !serviceData.checks.position || commissionThrow === undefined
      || positionLabel === undefined
    ) {
      return { passed: false, margin: 0 };
    }
    const dm = evaluateDM(serviceData.checks.position.dms, ch);
    return check2dVsTarget(ch, { dm, target: commissionThrow, label: positionLabel });
  };

  const checkPromotion = (ch: Character): CheckResult => {
    if (!serviceData.checks.promotion || promotionThrow === undefined) {
      return { passed: false, margin: 0 };
    }
    const dm = evaluateDM(serviceData.checks.promotion.dms, ch);
    return check2dVsTarget(ch, { dm, target: promotionThrow, label: "Promotion" });
  };

  // --- doPromotion: walk automaticSkills + call edition hook ------------
  const doPromotionHookName = serviceData.hooks?.doPromotion;
  const doPromotionHook = doPromotionHookName
    ? edition.hooks.doPromotion?.[doPromotionHookName]
    : undefined;
  if (doPromotionHookName && !doPromotionHook) {
    // Declared in JSON but not registered in the edition's hooks module:
    // typo or missing implementation. Surface loudly rather than silently
    // skipping the promotion side-effect.
    throw new Error(
      `Service "${serviceData.displayName}" declares doPromotion hook ` +
      `"${doPromotionHookName}" but edition "${edition.meta.id}" hooks ` +
      `don't export it. Register it in editions/${edition.meta.id}/hooks.ts.`,
    );
  }

  const doPromotion = (ch: Character): void => {
    for (const e of serviceData.automaticSkills) {
      if (e.trigger !== "rank") continue;
      if (e.rank !== ch.rank) continue;
      applyAutoEntry(ch, e, `rank ${e.rank} auto-skill`);
    }
    if (doPromotionHook) doPromotionHook(ch);
  };

  // --- cash --------------------------------------------------------------
  const musterCash: Record<number, number> = {};
  for (let r = 1; r <= 7; r++) {
    const cell = serviceData.musterOut.cash[r];
    if (cell === undefined) {
      throw new Error(
        `services.${serviceData.displayName}.musterOut.cash[${r}] is missing — ` +
        "printed dashes are stored as explicit null (Cr0), absent rows are data errors.",
      );
    }
    musterCash[r] = cell ?? 0; // printed dash (null) = no cash on this row
  }

  // --- muster benefits ---------------------------------------------------
  const musterBenefits = (ch: Character, dm: number): void => {
    const rawRoll = ch.rng.roll(1);
    const r = rawRoll + dm;
    if (r < 1 || r > 7) {
      ch.log(ev.musterBenefit(undefined, rawRoll, dm, "outOfRange"));
      return;
    }
    const cell = serviceData.musterOut.benefits[r];
    if (cell == null) {
      ch.log(ev.musterBenefit(undefined, rawRoll, dm, "noBenefit"));
      return;
    }
    ch.log(ev.musterBenefit(cell, rawRoll, dm));
    applyCell(ch, cell, "muster", benefitDetails, "Muster");
  };

  // --- skill acquisition -------------------------------------------------
  // In auto mode `pickOrDefer` selects a table immediately and resolves;
  // in interactive mode the choice is queued for the UI. Either way the
  // resolver rolls the cell die and applies the cell.
  const acquireSkill = (ch: Character): void => {
    if (ch.muster.forceTable) {
      // Test path: ch.muster.forceTableIndex forces a specific table; bypass the
      // interactive picker entirely so existing row-level tests stay green.
      runTablePick(ch, ch.muster.forceTableIndex);
      return;
    }
    const meta = data.skillTableMeta;
    if (!meta) throw new Error(`Edition ${ch.editionId} missing skillTableMeta`);
    const available = meta.order.filter((key) =>
      key !== "advancedEducation8Plus"
      || ch.attributes.education >= meta.advancedEducationEduMin);
    const tables = available.map((key) => meta.displayNames[key] ?? key);
    ch.pickOrDefer({
      kind: "skillTable",
      label: "Choose a skill table to roll on",
      options: tables,
      context: { source: "skillRoll" },
      onResolve: (ch, tableName) => {
        const pickedKey = available[tables.indexOf(tableName)]!;
        runTablePick(ch, meta.order.indexOf(pickedKey) + 1);
      },
    });
  };

  function runTablePick(ch: Character, tableIdx: number): void {
    let tableKey = skillTableKeyForIndex(edition.data, tableIdx);
    if (!tableKey) return;
    // Edu gate (PM/TTB): advancedEducation8Plus requires Education >=
    // skillTableMeta.advancedEducationEduMin. The interactive/auto picker
    // filters it out for ineligible characters, but the forceTable path
    // (session pickSkill + row-audit tests) resolves a raw index and would
    // otherwise roll it. Fall back to the standard advancedEducation table
    // so an ineligible character still gains a skill from a table it can use.
    const meta = data.skillTableMeta;
    if (
      tableKey === "advancedEducation8Plus" && meta
      && ch.attributes.education < meta.advancedEducationEduMin
    ) {
      tableKey = "advancedEducation";
    }
    const table = (serviceData.skillTables as Record<string, (string | null)[]>)[tableKey];
    if (!table) return;
    const r = ch.rng.roll(1);
    const cell = table[r];
    if (cell == null) return;
    const source = skillTableDisplayNameForKey(edition.data, tableKey);
    applyCell(ch, cell, "skill", undefined, source);
  }

  const def: ServiceDef = {
    serviceName: serviceData.displayName,
    memberName: requireRule(
      serviceData.memberName,
      `services.${serviceData.displayName}.memberName`,
      "per-service singular member noun",
    ),
    enlistmentThrow,
    enlistmentDM,
    survivalThrow,
    reenlistThrow,
    ranks,
    getServiceSkills,
    checkSurvival,
    checkCommission,
    checkPromotion,
    doPromotion,
    musterCash,
    musterBenefits,
    acquireSkill,
  };
  if (positionLabel !== undefined) def.positionLabel = positionLabel;
  if (commissionThrow !== undefined) def.commissionThrow = commissionThrow;
  if (promotionThrow !== undefined) def.promotionThrow = promotionThrow;
  if (inverseReenlist) def.inverseReenlist = inverseReenlist;
  if (serviceData.description !== undefined) def.description = serviceData.description;
  if (serviceData.skillsPerTerm !== undefined) {
    def.skillsPerTerm = serviceData.skillsPerTerm;
  }
  return def;
}

/** Walk one automatic-skill entry — either a skill grant or an effect string. */
function applyAutoEntry(
  ch: Character, e: AutoSkillEntry, source?: string,
): void {
  if (e.effect) {
    applyCell(ch, e.effect, "skill", undefined, source);
    return;
  }
  if (e.skill) {
    const name = resolveAutoSkill(e.skill, ch);
    ch.addSkill(
      name,
      requireRule(
        e.level,
        `automaticSkills level for "${e.skill}"`, "TTB/PM service tables",
      ),
      source,
    );
    return;
  }
  throw new Error(
    `automaticSkills entry has neither "effect" nor "skill" declared` +
    `${source ? ` (${source})` : ""} — fix the edition JSON`,
  );
}

/** Resolve a service-skill label; cascade if it's a generic cascade label. */
function resolveAutoSkill(label: string, ch: Character): string {
  // Defer to cellResolver-style cascade detection by reusing applyCell's
  // table. Here we need just the name, so we inline.
  const cascadeReturn = applyAutoCascade(label, ch);
  return cascadeReturn ?? label;
}

function applyAutoCascade(label: string, ch: Character): string | undefined {
  // Use the edition-aware cascade pool lookup. The alias map +
  // cascade-pool table are both in JSON (cascadeAliases / cascadeSkills),
  // so this works equivalently for CT and MT without hardcoded pools.
  const pool = cascadePoolForLabel(label, ch.editionId);
  if (!pool) return undefined;
  const known: string[] = [];
  for (const [name] of ch.skills) {
    if (pool.includes(name)) known.push(name);
  }
  return ch.rng.pick(known.length > 0 ? known : pool);
}

