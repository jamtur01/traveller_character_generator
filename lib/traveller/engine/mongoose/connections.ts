// Mongoose 2e Connections (Core p.19) — single-character interpretation. The
// printed rule links two Travellers through a shared event for a free skill; in
// this solo generator each connection the Traveller formed (an event-generated
// Ally / Rival / Contact) instead grants +1 to a chosen skill, up to the cap,
// never above the connection max level, and never Jack-of-all-Trades.

import type { Character } from "@/lib/traveller/character";
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
      .filter(([n, l]) => n !== "Jack-of-all-Trades" && l < data.connectionSkillMaxLevel)
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
