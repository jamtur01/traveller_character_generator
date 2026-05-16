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

interface CashTableDm {
  condition: string;
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
  cashRollLimit?: number;
}

function rules(ch: Character): MusterRules | undefined {
  return (getEdition(ch.editionId).data.rules as {
    musterOutRolls?: MusterRules;
  }).musterOutRolls;
}

/** Cash-table DM for this character under the active edition's rules. */
export function cashDmFor(ch: Character): number {
  const r = rules(ch);
  if (!r?.cashTableDm) return 0;
  let total = 0;
  for (const c of r.cashTableDm) {
    if (c.services && !c.services.includes(ch.service)) continue;
    if (conditionMatches(c.condition, ch)) total += c.dm;
  }
  return total;
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
 *  are permanently capped at 2 (MT PM p. 15). */
export function maxCashRolls(ch: Character): number {
  const base = rules(ch)?.cashRollLimit ?? 3;
  return ch.anagathicsEverTaken ? Math.min(2, base) : base;
}

/** Interpret a JSON condition string against the character. The conditions
 *  used in canonical data are: "Gambling-1 or better", "Prospecting-1 or
 *  better", "Retired". Adding new conditions = add a branch here. */
function conditionMatches(condition: string, ch: Character): boolean {
  const c = condition.trim();
  if (c === "Retired") return ch.retired;
  // "Skill-N or better"
  const m = c.match(/^([A-Za-z' -]+)-(\d+)(?:\s+or better)?$/);
  if (m) {
    const skill = m[1]!.trim();
    const level = parseInt(m[2]!, 10);
    return ch.checkSkillLevel(skill, level);
  }
  return false;
}
