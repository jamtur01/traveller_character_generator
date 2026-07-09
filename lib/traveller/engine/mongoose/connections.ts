// Mongoose 2e Connections (Core p.19) — single-character interpretation. The
// printed rule links two Travellers through a shared event for a free skill; in
// this solo generator each connection the Traveller formed (an event-generated
// Ally / Rival / Contact) instead grants +1 to a chosen skill, up to the cap,
// never above the connection max level, and never Jack-of-all-Trades.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { requireRule } from "@/lib/traveller/editions/strict";
import { getMongooseData } from "@/lib/traveller/engine/mongoose/core";
import { skillLevel } from "@/lib/traveller/engine/mongoose/skills";

/** Apply connection skill bonuses (finishing step, once all careers are done). */
export function applyConnections(ch: Character): void {
  const state = requireRule(ch.mongooseState, "mongooseState", "engine (mongoose)");
  const data = getMongooseData(ch);
  const grants = Math.min(data.connectionSkillCap, state.connections.length);
  for (let i = 0; i < grants; i++) {
    const options = ch.skills
      .filter(([n, l]) => !data.connectionSkillExcluded.includes(n) && l < data.connectionSkillMaxLevel)
      .map(([n]) => n);
    if (options.length === 0) return;
    ch.pickOrDefer({
      kind: "mongooseSkillChoice",
      label: "Connection: raise a skill by one level",
      options,
      onResolve: (c, chosen) => {
        const cur = skillLevel(c, chosen);
        if (cur >= 0 && cur < data.connectionSkillMaxLevel) c.addSkill(chosen, 1, "Connection");
      },
    });
  }
}

/** Relation the engine can form (event-driven or a muster Ally/Contact). */
export type ConnectionRelation = "contact" | "ally" | "rival" | "enemy";

/** Record a formed connection in history (Core p.19) and, when the edition
 *  supplies a cited `connections` glossary entry, a verbose line explaining
 *  what the relation means (Core pp.20-21). Fail-soft: the glossary line is
 *  emitted only when present. `note` rides on the mechanical event (e.g. the
 *  source or an "xN" multiplier), matching the prior emission. */
export function logConnection(
  ch: Character, relation: ConnectionRelation, note?: string,
): void {
  ch.log(ev.mongooseConnection(relation, note));
  const def = getMongooseData(ch).connections?.[relation];
  if (def) {
    const label = relation.charAt(0).toUpperCase() + relation.slice(1);
    ch.log(ev.raw(`${label}: ${def}.`, "verbose"));
  }
}
