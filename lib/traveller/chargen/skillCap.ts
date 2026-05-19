// PM p. 39 Int+Edu skill cap. Extracted from character.ts. The
// Character method is a thin shim; this module owns the logic.

import type { Character } from "../character";
import { event as ev } from "../history";
import { getEdition } from "../editions";

/** Enforce the Int+Edu skill cap. Called after each term's skill rolls.
 *  In auto mode, reduces the most-recently-acquired skill level
 *  repeatedly until the total fits the cap. In interactive mode, queues
 *  a `reduceSkill` choice for the player to pick which skill level to
 *  drop; recurses until under cap. No-op for editions without a
 *  `rules.skillCap` block (CT). */
export function enforceSkillCap(ch: Character): void {
  const ed = getEdition(ch.editionId);
  if (!ed.rules.skillCap) return;
  const cap = ch.skillCap();
  const total = ch.totalSkillLevels();
  if (total <= cap) return;
  const excess = total - cap;
  if (ch.choiceMode === "auto") {
    autoReduce(ch, excess);
    return;
  }
  const options = ch.skills.map(([n, l]) => `${n}-${l}`);
  ch.pickOrDefer({
    kind: "reduceSkill",
    label:
      `Skill total ${total} exceeds Int+Edu cap ${cap}. Pick a skill to ` +
      `reduce by 1 (${excess} reduction${excess === 1 ? "" : "s"} needed).`,
    options,
    context: { source: "skillCap", excess, cap, total },
    onResolve: (c, chosen) => {
      const name = chosen.replace(/-\d+$/, "");
      const i = c.checkSkill(name);
      if (i < 0) return;
      const entry = c.skills[i]!;
      if (entry[1] > 1) {
        entry[1] -= 1;
        c.log(ev.skillReduced(name, entry[1], "Int+Edu cap"));
      } else {
        c.skills.splice(i, 1);
        c.log(ev.skillForfeited(name, "Int+Edu cap"));
      }
      enforceSkillCap(c);
    },
  });
}

function autoReduce(ch: Character, excess: number): void {
  let remaining = excess;
  while (remaining > 0 && ch.skills.length > 0) {
    const last = ch.skills[ch.skills.length - 1]!;
    if (last[1] > 1) {
      last[1] -= 1;
      ch.log(ev.skillReduced(last[0], last[1], "Int+Edu cap"));
    } else {
      ch.skills.pop();
      ch.log(ev.skillForfeited(last[0], "Int+Edu cap"));
    }
    remaining -= 1;
  }
}
