// Aging table application (PM p. 24 / TTB equivalent). Extracted from
// character.ts. Reads `edition.data.aging` and applies the highest-
// matching row's per-attribute saves, then runs the aging-crisis sweep
// on any characteristic reduced to the configured threshold.

import type { Character } from "../character";
import { roll } from "../random";
import { event as ev } from "../history";
import { getEdition } from "../editions";
import { attrShort } from "../formatting";
import type { AttributeKey } from "../types";

interface AgingRow {
  age: number | string;
  endOfTerm: number;
  effects: Partial<Record<AttributeKey, { delta: number; save: number }>>;
}

interface AgingCrisis {
  whenAttributeReducedTo?: number;
  save?: number;
}

/** Roll a single aging saving throw; on failure, apply the reduction. */
export function ageAttribute(
  ch: Character, attrib: AttributeKey, req: number, reduction: number,
): void {
  const r = roll(2);
  const passed = r >= req;
  ch.log(ev.roll(`Aging ${attrShort(attrib)}`, r, 0, req, passed));
  if (!passed) ch.improveAttribute(attrib, reduction);
}

/** Apply the end-of-term aging step. Picks the highest aging row whose
 *  endOfTerm threshold is met, then iterates that row's effects:
 *    - Maintained anagathics: auto-save the N highest-save attributes.
 *    - Withdrawal: each save requires TWO passes (PM p. 15).
 *    - Normal: standard ageAttribute call per attribute.
 *  After saves, runs the aging-crisis sweep on any attribute that hit
 *  the configured threshold. */
export function doAging(ch: Character): void {
  const aging = getEdition(ch.editionId).data.aging as {
    rows?: AgingRow[];
    agingCrisis?: AgingCrisis;
  } | undefined;
  if (!aging?.rows) return;

  // Persist the apparent-age snapshot so a later anagathics opt-in
  // freezes from this point rather than from chronological age. The
  // getter reports `age` when the backing field is 0, but a later
  // freeze needs the concrete value.
  ch.snapshotApparentAge();

  // Short terms count as 2 years (PM p. 16) — don't trip full-term
  // aging breakpoints. On anagathics, apparent age (frozen) drives the
  // row pick, anchored at the service's startAge.
  const serviceStartAge =
    getEdition(ch.editionId).data.services[ch.service]?.startAge ?? 18;
  const effectiveTermsForAging = ch.onAnagathics
    ? Math.max(0, Math.floor((ch.apparentAge - serviceStartAge) / 4))
    : Math.max(0, ch.terms - ch.shortTermsCount);

  const applicable = aging.rows
    .filter((r) => effectiveTermsForAging >= r.endOfTerm)
    .sort((a, b) => b.endOfTerm - a.endOfTerm)[0];
  if (!applicable) return;

  const withdrawal = ch.anagathicsWithdrawalThisTerm;
  // Anagathics benefit: auto-save N (default 2) highest-save attrs —
  // most likely to fail, so the benefit lands where it helps most.
  const effects = Object.entries(applicable.effects) as
    [AttributeKey, { delta: number; save: number }][];
  const autoSaves = new Set<AttributeKey>();
  if (ch.onAnagathics && !withdrawal && effects.length > 0) {
    const ranked = [...effects].sort((a, b) => b[1].save - a[1].save);
    const autoSavesPerTerm =
      getEdition(ch.editionId).rules.anagathics?.agingAutoSavesPerTerm ?? 2;
    const n = Math.min(autoSavesPerTerm, ranked.length);
    for (let i = 0; i < n; i++) autoSaves.add(ranked[i]![0]);
    for (const attr of autoSaves) ch.log(ev.agingSave(attr, "auto"));
  }
  for (const [attr, eff] of effects) {
    if (autoSaves.has(attr)) continue;
    if (withdrawal) {
      const r1 = roll(2);
      const r2 = roll(2);
      const failed = r1 < eff.save || r2 < eff.save;
      ch.log(ev.agingSave(
        attr, failed ? "failed" : "passed",
        { dice: [r1, r2], save: eff.save },
      ));
      if (failed) ch.improveAttribute(attr, eff.delta);
    } else {
      ageAttribute(ch, attr, eff.save, eff.delta);
    }
  }
  ch.anagathicsWithdrawalThisTerm = false;
  // Maintained anagathics freezes apparent age; otherwise it tracks
  // chronological.
  if (!ch.onAnagathics) ch.apparentAge = ch.age;

  // Aging crisis: any attribute at or below the configured threshold
  // triggers a save against death. Pass → attribute clamped to 1.
  const crisisThreshold = aging.agingCrisis?.whenAttributeReducedTo ?? 0;
  const crisisSave = aging.agingCrisis?.save ?? 8;
  for (const a of Object.keys(ch.attributes) as AttributeKey[]) {
    if (ch.deceased) break;
    if (ch.attributes[a] <= crisisThreshold) {
      const cr = roll(2);
      ch.log(ev.roll(
        `Aging crisis (${attrShort(a)})`, cr, 0, crisisSave, cr >= crisisSave,
      ));
      if (cr < crisisSave) ch.endChargenDeceased("aging crisis");
      else ch.attributes[a] = 1;
    }
  }
}
