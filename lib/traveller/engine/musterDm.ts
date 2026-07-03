// Edition-aware muster-out DM computation. The cash/benefit DMs are
// declared in JSON under rules.musterOutRolls; this helper walks the
// declared conditions and applies the ones the character meets.
//
// CT conditions: Gambling-1 → cash +1; rank≥5 → benefit +1.
// MT conditions: as CT, plus Retired → cash +1 and Prospecting-1 → cash +1
//   (Prospecting only for specific services: merchants/belters/pirates/
//   rogues/hunters/barbarians).

import type { Character } from "../character";
import { getEdition } from "../editions";

interface CashTableDmWhen {
  retired?: boolean;
  skillAtLeast?: { skill: string; level: number };
}

interface CashTableDm {
  when: CashTableDmWhen;
  dm: number;
  services?: string[];
}

interface BenefitTableDm {
  rankAtLeast?: number;
  dm: number;
}

interface MusterRules {
  cashTableDm?: CashTableDm[];
  benefitTableDm?: BenefitTableDm;
  maxCashTableRolls?: number;
}

function rules(ch: Character): MusterRules | undefined {
  return getEdition(ch.editionId).rules.musterOutRolls as
    MusterRules | undefined;
}

/** Cash-table DM for this character under the active edition's rules. */
export function cashDmFor(ch: Character): number {
  const r = rules(ch);
  if (!r?.cashTableDm) return 0;
  let total = 0;
  for (const c of r.cashTableDm) {
    if (c.services && !c.services.includes(ch.service)) continue;
    if (whenMatches(c.when, ch)) {
      total += c.dm;
    }
  }
  return total;
}

function whenMatches(w: CashTableDmWhen, ch: Character): boolean {
  if (w.retired === true && !ch.retired) return false;
  if (w.skillAtLeast && !ch.checkSkillLevel(w.skillAtLeast.skill, w.skillAtLeast.level)) {
    return false;
  }
  return true;
}

/** Benefit-table DM for this character under the active edition's rules. */
export function benefitDmFor(ch: Character): number {
  const r = rules(ch);
  const b = r?.benefitTableDm;
  if (!b) return 0;
  if (b.rankAtLeast !== undefined && ch.rank >= b.rankAtLeast) return b.dm;
  return 0;
}

/** Max cash rolls allowed per character (CT and MT: 3). Anagathics users
 *  are permanently capped per the edition's rules.anagathics.cashRollCap
 *  (MT PM p. 15). */
export function maxCashRolls(ch: Character): number {
  const r = rules(ch);
  const base = r?.maxCashTableRolls ?? 3;
  if (!ch.anagathicsEverTaken) return base;
  const cap =
    getEdition(ch.editionId).rules.anagathics?.cashRollCap ?? 2;
  return Math.min(cap, base);
}
