// Build a runtime ServiceDef from one canonical ServiceData entry.
// The resulting object has the same surface as the old hand-written services
// (enlistmentThrow, checkSurvival, acquireSkill, musterBenefits, etc.) so
// existing callers in character.ts and the test suite continue to work.

import { arnd, roll } from "../random";
import type { Character } from "../character";
import type { Attributes, ServiceDef } from "../types";
import { cascadePoolForLabel } from "./cascadeMap";
import type {
  AutoSkillEntry,
  CanonData,
  Edition,
  ServiceData,
} from "../editions/types";
import { applyCell } from "./cellResolver";
import { evaluateDM } from "./dmEvaluator";

/** Skill-table key for the given table index (1-based). Order declared
 *  by the edition under `skillTableMeta.order`. */
function skillTableKeyForIndex(editionData: unknown, idx: number): string | null {
  const meta = (editionData as {
    skillTableMeta?: { order?: string[] };
  }).skillTableMeta;
  return meta?.order?.[idx - 1] ?? null;
}

export function buildServiceDef(
  serviceData: ServiceData,
  edition: Edition,
): ServiceDef {
  const data: CanonData = edition.data;
  const benefitDetails = data.benefitDetails;

  // --- numeric throws ----------------------------------------------------
  const enlistmentThrow = serviceData.checks.enlistment.target ?? 0;
  const survivalThrow = serviceData.checks.survival.target ?? 0;
  const commissionThrow = serviceData.checks.position?.target ?? undefined;
  const promotionThrow = serviceData.checks.promotion?.target ?? undefined;
  const reenlistThrow = serviceData.checks.reenlistment.target ?? 0;

  const enlistmentDM = (a: Attributes): number => evaluateDM(
    serviceData.checks.enlistment.dm,
    // evaluateDM takes a Character for termNumber support; build a minimal
    // stand-in carrying attributes and terms=0 (enlistment is pre-term).
    { attributes: a, terms: 0 } as unknown as Character,
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
    let dm = evaluateDM(serviceData.checks.survival.dm, ch);
    // PM p. 15: anagathics user takes -1 survival DM (-2 for Nobles, since
    // "society generally frowns on nobles who take anagathics"). The DM
    // applies for every term in which the character desires anagathics,
    // whether or not the supply was secured.
    if (ch.anagathicsActiveThisTerm || ch.wantsAnagathicsThisTerm) {
      const penalty = ch.service === "nobles" ? -2 : -1;
      dm += penalty;
      ch.verboseHistory(`Anagathics survival DM ${penalty}`);
    }
    const sv = roll(2);
    ch.verboseHistory(`Survival roll ${sv} + ${dm} vs ${survivalThrow}`);
    return sv + dm >= survivalThrow;
  };

  const checkCommission = (ch: Character): boolean => {
    if (!serviceData.checks.position || commissionThrow === undefined) return false;
    const dm = evaluateDM(serviceData.checks.position.dm, ch);
    const sv = roll(2);
    ch.verboseHistory(`Commission roll ${sv} + ${dm} vs ${commissionThrow}`);
    return sv + dm >= commissionThrow;
  };

  const checkPromotion = (ch: Character): boolean => {
    if (!serviceData.checks.promotion || promotionThrow === undefined) return false;
    const dm = evaluateDM(serviceData.checks.promotion.dm, ch);
    const sv = roll(2);
    ch.verboseHistory(`Promotion roll ${sv} + ${dm} vs ${promotionThrow}`);
    return sv + dm >= promotionThrow;
  };

  // --- doPromotion: walk automaticSkills + call edition hook ------------
  const doPromotionHookName = serviceData.hooks?.doPromotion;
  const doPromotionHook = doPromotionHookName
    ? edition.hooks.doPromotion?.[doPromotionHookName]
    : undefined;

  const doPromotion = (ch: Character): void => {
    for (const e of serviceData.automaticSkills) {
      if (e.trigger !== "rank") continue;
      if (e.rank !== ch.rank) continue;
      applyAutoEntry(ch, e);
    }
    if (doPromotionHook) doPromotionHook(ch);
  };

  // --- cash --------------------------------------------------------------
  const musterCash: Record<number, number> = {};
  for (let r = 1; r <= 7; r++) {
    musterCash[r] = serviceData.musterOut.cash[r] ?? 0;
  }

  // --- muster benefits ---------------------------------------------------
  const musterBenefits = (ch: Character, dm: number): void => {
    const r = roll(1) + dm;
    if (r < 1 || r > 7) return;
    const cell = serviceData.musterOut.benefits[r];
    if (cell == null) {
      ch.debugHistory("No benefit");
      return;
    }
    applyCell(ch, cell, "muster", benefitDetails);
  };

  // --- skill acquisition -------------------------------------------------
  // In auto mode `pickOrDefer` selects a table immediately and resolves;
  // in interactive mode the choice is queued for the UI. Either way the
  // resolver rolls the cell die and applies the cell.
  const acquireSkill = (ch: Character): void => {
    if (ch.forceTable) {
      // Test path: ch.forceTableIndex forces a specific table; bypass the
      // interactive picker entirely so existing row-level tests stay green.
      runTablePick(ch, ch.forceTableIndex);
      return;
    }
    const eduBonus = ch.attributes.education >= 8;
    const tables = ["Personal Development", "Service Skills", "Advanced Education"];
    if (eduBonus) tables.push("Advanced Education (Edu 8+)");
    ch.pickOrDefer({
      kind: "skillTable",
      label: "Choose a skill table to roll on",
      options: tables,
      context: { source: "skillRoll" },
      onResolve: (c, tableName) => {
        const idx = tables.indexOf(tableName) + 1;
        runTablePick(c, idx);
      },
    });
  };

  function runTablePick(ch: Character, tableIdx: number): void {
    const tableKey = skillTableKeyForIndex(edition.data, tableIdx);
    if (!tableKey) return;
    const table = (serviceData.skillTables as Record<string, (string | null)[]>)[tableKey];
    if (!table) return;
    const r = roll(1);
    const cell = table[r];
    if (cell == null) return;
    applyCell(ch, cell, "skill");
  }

  const def: ServiceDef = {
    serviceName: serviceData.displayName,
    memberName: derivedMemberName(serviceData.displayName),
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
  if (commissionThrow !== undefined) def.commissionThrow = commissionThrow;
  if (promotionThrow !== undefined) def.promotionThrow = promotionThrow;
  if (inverseReenlist) def.inverseReenlist = inverseReenlist;
  return def;
}

/** Walk one automatic-skill entry — either a skill grant or an effect string. */
function applyAutoEntry(ch: Character, e: AutoSkillEntry): void {
  if (e.effect) {
    applyCell(ch, e.effect, "skill");
    return;
  }
  if (e.skill) {
    const name = resolveAutoSkill(e.skill, ch);
    ch.addSkill(name, e.level ?? 1);
  }
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
  return arnd(known.length > 0 ? known : pool);
}

/** "Marines" → "Marine", "Doctors" → "Doctor", etc. */
function derivedMemberName(displayName: string): string {
  if (displayName === "Other") return "";
  if (displayName === "Barbarians") return "Barbarian";
  if (displayName === "Belters") return "Belter";
  if (displayName === "Bureaucrats") return "Bureaucrat";
  if (displayName === "Diplomats") return "Diplomat";
  if (displayName === "Doctors") return "Doctor";
  if (displayName === "Flyers") return "Flyer";
  if (displayName === "Hunters") return "Hunter";
  if (displayName === "Marines") return "Marine";
  if (displayName === "Merchants") return "Merchant";
  if (displayName === "Nobles") return "Noble";
  if (displayName === "Pirates") return "Pirate";
  if (displayName === "Rogues") return "Rogue";
  if (displayName === "Sailors") return "Sailor";
  if (displayName === "Scientists") return "Scientist";
  if (displayName === "Scouts") return "Scout";
  // Navy / Army keep their plural-as-name form (existing code uses these).
  return displayName;
}
