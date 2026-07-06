// Muster-out weapon benefits — Blade / Gun / generic Weapon cascades.
// Extracted from character.ts; the Character methods are thin shims.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { cascadePoolByKey } from "@/lib/traveller/engine/cascadeMap";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";

/** Names from `pool` that the character already has skills in (for
 *  cascade preference: a subsequent blade cascade stacks onto an
 *  existing blade rather than introducing a fresh weapon). */
function knownFromPool(ch: Character, pool: readonly string[]): string[] {
  const out: string[] = [];
  for (const [n] of ch.skills) {
    if (pool.includes(n)) out.push(n);
  }
  return out;
}

/** Blade benefit: pick a blade cascade, add as possession, record
 *  skill-0. Repeat occurrences go through doRepeatWeaponBenefit. */
export function doBladeBenefit(ch: Character): void {
  if (ch.bladeBenefit !== "") {
    doRepeatWeaponBenefit(ch, "blade");
    return;
  }
  const pool = cascadePoolByKey("bladeCombat", ch.editionId);
  const known = knownFromPool(ch, pool);
  ch.pickOrDefer({
    kind: "cascade",
    label: "Choose a blade for your weapon benefit",
    options: pool,
    preferred: known,
    context: { source: "muster", benefit: "Blade" },
    onResolve: (ch, blade) => {
      ch.bladeBenefit = blade;
      ch.addBenefit(blade);
      ch.log(ev.cascadePick("Blade Combat", blade));
      ch.addSkill(blade, 0, "Blade benefit");
    },
  });
}

/** Gun benefit — same pattern as blade. */
export function doGunBenefit(ch: Character): void {
  if (ch.gunBenefit !== "") {
    doRepeatWeaponBenefit(ch, "gun");
    return;
  }
  const pool = cascadePoolByKey("gunCombat", ch.editionId);
  const known = knownFromPool(ch, pool);
  ch.pickOrDefer({
    kind: "cascade",
    label: "Choose a gun for your weapon benefit",
    options: pool,
    preferred: known,
    context: { source: "muster", benefit: "Gun" },
    onResolve: (ch, gun) => {
      ch.gunBenefit = gun;
      ch.addBenefit(gun);
      ch.log(ev.cascadePick("Gun Combat", gun));
      ch.addSkill(gun, 0, "Gun benefit");
    },
  });
}

/** PM p. 20 repeated weapon benefit. Player picks:
 *    (1) bump the existing weapon's skill,
 *    (2) pick a different weapon from the cascade pool, or
 *    (3) +1 in the weapon category (Blade Combat / Gun Combat).
 *  Auto mode keeps option (1) (player isn't watching). */
function doRepeatWeaponBenefit(ch: Character, kind: "blade" | "gun"): void {
  const cascadeKey = kind === "blade" ? "bladeCombat" : "gunCombat";
  const categorySkill = kind === "blade" ? "Blade Combat" : "Gun Combat";
  const current = kind === "blade" ? ch.bladeBenefit : ch.gunBenefit;
  if (ch.choiceMode === "auto") {
    ch.addSkill(current, 1, `Repeat ${kind} benefit (bump)`);
    return;
  }
  const pool = cascadePoolByKey(cascadeKey, ch.editionId);
  const optBump = `Bump ${current}`;
  const optDifferent = `Pick a different ${kind}`;
  const optCategory = `+1 in ${categorySkill}`;
  ch.pickOrDefer({
    kind: "repeatWeaponBenefit",
    label: `${current} (already received) — repeated weapon benefit choice (PM p. 20)`,
    options: [optBump, optDifferent, optCategory],
    context: { source: "muster", benefit: "RepeatWeapon", current, category: categorySkill },
    onResolve: (ch, chosen) => {
      if (chosen === optBump) {
        ch.addSkill(current, 1, `Repeat ${kind} benefit (bump)`);
        return;
      }
      if (chosen === optCategory) {
        ch.addSkill(categorySkill, 1, `Repeat ${kind} benefit (+1 category)`);
        return;
      }
      const known = knownFromPool(ch, pool);
      ch.pickOrDefer({
        kind: "cascade",
        label: `Choose a different ${kind}`,
        options: pool,
        preferred: known,
        context: { source: "muster", benefit: kind === "blade" ? "Blade" : "Gun" },
        onResolve: (cc, weapon) => {
          cc.addBenefit(weapon);
          cc.log(ev.cascadePick(categorySkill, weapon));
          cc.addSkill(weapon, 0, `Repeat ${kind} benefit (different)`);
        },
      });
    },
  });
}

/** CotI generic "Weapon" benefit: two-stage type → specific cascade. */
export function doWeaponBenefit(ch: Character): void {
  ch.pickOrDefer({
    kind: "weaponType",
    label: "Choose weapon type",
    options: optionDomain(ch.editionId, "ct.weaponType").values,
    context: { source: "muster", benefit: "Weapon" },
    onResolve: (ch, type) => {
      if (type === "Blade") doBladeBenefit(ch);
      else doGunBenefit(ch);
    },
  });
}
