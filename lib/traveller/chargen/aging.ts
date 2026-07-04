// Aging table application (PM p. 24 / TTB equivalent). Extracted from
// character.ts. Reads `edition.data.aging` and applies the highest-
// matching row's per-attribute saves, then runs the aging-crisis sweep
// on any characteristic reduced to the configured threshold.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import { attrShort } from "@/lib/traveller/formatting";
import type { AttributeKey } from "@/lib/traveller/types";

interface AgingRow {
  age: number | string;
  endOfTerm: number;
  effects: Partial<Record<AttributeKey, { delta: number; save: number }>>;
}

interface AgingCrisis {
  whenAttributeReducedTo?: number;
  save?: number;
  restoreTo?: number;
}

/** Roll a single aging saving throw; on failure, apply the reduction. */
export function ageAttribute(
  ch: Character, attrib: AttributeKey, req: number, reduction: number,
): void {
  const r = ch.rng.roll(2);
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
    withdrawalDoubleSave?: boolean;
  } | undefined;
  if (!aging?.rows) return;

  // Persist the apparent-age snapshot so a later anagathics opt-in
  // freezes from this point rather than from chronological age. The
  // getter reports `age` when the backing field is 0, but a later
  // freeze needs the concrete value.
  ch.anagathics.snapshotApparentAge(ch.age);

  // Short terms count as 2 years (PM p. 16) — don't trip full-term
  // aging breakpoints. On anagathics, apparent age (frozen) drives the
  // row pick, anchored at the service's startAge. A Navy Frozen Watch
  // offset (acgState.physicalAgeOffset, <= 0) likewise pulls the aging
  // basis back to physical age (PM p. 56), so cold-sleep years advance
  // chronological age without aging the body.
  const serviceStartAge = requireRule(
    getEdition(ch.editionId).data.services[ch.service]?.startAge,
    `services.${String(ch.service)}.startAge`, "TTB p. 18 / PM service tables",
  );
  const physicalOffset = ch.acgState?.physicalAgeOffset ?? 0;
  const physicalAge = ch.apparentAge + physicalOffset;
  const usesAgeBasis = ch.anagathics.onAnagathics || physicalOffset !== 0;
  const effectiveTermsForAging = usesAgeBasis
    ? Math.max(0, Math.floor((physicalAge - serviceStartAge) / ch.fullTermYears()))
    : Math.max(0, ch.terms - ch.shortTermsCount);

  const applicable = aging.rows
    .filter((r) => effectiveTermsForAging >= r.endOfTerm)
    .sort((a, b) => b.endOfTerm - a.endOfTerm)[0];
  if (!applicable) return;

  const withdrawal = ch.anagathics.anagathicsWithdrawalThisTerm;
  // Anagathics benefit: auto-save the N highest-save attrs (N =
  // rules.anagathics.agingAutoSavesPerTerm) — most likely to fail, so
  // the benefit lands where it helps most.
  const effects = Object.entries(applicable.effects) as
    [AttributeKey, { delta: number; save: number }][];
  const autoSaves = new Set<AttributeKey>();
  if (ch.anagathics.onAnagathics && !withdrawal && effects.length > 0) {
    const ranked = [...effects].sort((a, b) => b[1].save - a[1].save);
    const autoSavesPerTerm = requireRule(
      getEdition(ch.editionId).rules.anagathics?.agingAutoSavesPerTerm,
      "rules.anagathics.agingAutoSavesPerTerm", "PM p. 15",
    );
    const n = Math.min(autoSavesPerTerm, ranked.length);
    for (let i = 0; i < n; i++) autoSaves.add(ranked[i]![0]);
    for (const attr of autoSaves) ch.log(ev.agingSave(attr, "auto"));
  }
  for (const [attr, eff] of effects) {
    if (autoSaves.has(attr)) continue;
    if (withdrawal) {
      // PM p. 15: withdrawal doubles each aging save — both throws must
      // pass. The rule is declared by aging.withdrawalDoubleSave; a
      // character can only be in withdrawal in an edition that has the
      // anagathics rule, so the flag must be present.
      const doubleSave = requireRule(
        aging.withdrawalDoubleSave, "aging.withdrawalDoubleSave", "PM p. 15",
      );
      const r1 = ch.rng.roll(2);
      const r2 = doubleSave ? ch.rng.roll(2) : r1;
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
  ch.anagathics.anagathicsWithdrawalThisTerm = false;
  // Maintained anagathics freezes apparent age; otherwise it tracks
  // chronological age, less any Frozen Watch physical-age offset so the
  // apparent (physical) age stays behind chronological on the sheet.
  if (!ch.anagathics.onAnagathics) ch.anagathics.apparentAgeLine = ch.age + physicalOffset;

  // Aging crisis: any attribute at or below the configured threshold
  // triggers a save against death. Pass → attribute restored to the
  // JSON-declared restoreTo value (PM p. 47 / TTB p. 24).
  const crisis = aging.agingCrisis;
  const crisisThreshold = requireRule(
    crisis?.whenAttributeReducedTo,
    "aging.agingCrisis.whenAttributeReducedTo", "PM p. 47 / TTB p. 24",
  );
  const crisisSave = requireRule(
    crisis?.save, "aging.agingCrisis.save", "PM p. 47 / TTB p. 24",
  );
  const restoreTo = requireRule(
    crisis?.restoreTo, "aging.agingCrisis.restoreTo", "PM p. 47 / TTB p. 24",
  );
  for (const a of Object.keys(ch.attributes) as AttributeKey[]) {
    if (ch.deceased) break;
    if (ch.attributes[a] <= crisisThreshold) {
      const cr = ch.rng.roll(2);
      ch.log(ev.roll(
        `Aging crisis (${attrShort(a)})`, cr, 0, crisisSave, cr >= crisisSave,
      ));
      if (cr < crisisSave) ch.endChargenDeceased("aging crisis");
      else ch.attributes[a] = restoreTo;
    }
  }
}
