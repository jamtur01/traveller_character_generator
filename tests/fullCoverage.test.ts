// Exhaustive correctness oracle — the culminating Phase-2 artifact.
//
// Drives EVERY registry-enumerated character-creation combo (coverageMatrix())
// through its chargen-model walker and validates the resulting character with
// assertCharacterConsistent. It is exhaustive by construction: coverageMatrix
// sources its combos from the edition registries (proven total by
// tests/coverageMatrix.test.ts), so adding a service / fleet / lineType /
// career to the edition JSON mints a new combo that this driver then walks and
// validates. A newly-added path that generates an inconsistent character
// auto-reddens here.
//
// Terminal handling: the walkers drive each model to the end of its bounded
// walk — a Mongoose Traveller reaches phase "end"; a CT/MT basic character
// runs its term budget (or dies / is denied reenlistment first); an ACG
// character runs its pathway to muster or an enlistment/term failure. Whatever
// state the walk reaches — mustered, retired, deceased, or bounded — is a valid
// finished character whose JSON-derivable invariants must hold. The driver
// never treats early termination as an error; it validates whatever the walk
// produces, uniformly.
//
// Findings: a combo whose character violates an invariant REDDENS that combo's
// it.each case with assertCharacterConsistent's descriptive error (naming the
// invariant + the JSON path it was derived from). We do NOT weaken the
// validator or skip the combo. If a single divergence must ever be isolated,
// mirror the tests/equivalence.property.test.ts KNOWN_DIVERGENCES ledger (add
// an it.todo naming the diverging invariant) and report it loudly — the ledger
// is empty today because every combo validates clean.

import { describe, expect, it } from "vitest";
import { coverageMatrix, type CoverageCombo } from "@/tests/_coverageMatrix";
import { walkAcg, walkBasic, walkMongoose, type WalkResult } from "@/tests/_walker";
import {
  assertCharacterConsistent,
  type SoloDivergence,
} from "@/tests/_characterInvariants";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

const matrix = coverageMatrix();

// $soloPolicy skips recorded across every walked combo. assertCharacterConsistent
// would push here (instead of throwing) for any invariant governed by a
// $soloPolicy-tagged JSON value. Four mongoose heuristics are tagged today, but
// none relaxes a validated invariant (the aging-crisis restore keeps every
// characteristic >= 1, so the floor stays hard), so nothing skips and this
// stays empty (asserted below). Shared across the it.each because tests in a
// file run sequentially in definition order.
const divergences: SoloDivergence[] = [];

// Combos driven to a character AND validated. Compared to a fresh
// coverageMatrix().length to prove exhaustiveness: a combo that throws (a
// finding) or is skipped never reaches the increment, so the count drops.
let driven = 0;

// walkBasic / walkAcg take literal-union params; coverage picks arrive as
// registry-sourced strings (Readonly<Record<string, string>>). The option-domain
// audit-locks and the coverageMatrix self-check prove those values ARE the
// declared union members, so narrowing them here is a sound unchecked cast — the
// compiler simply can't narrow a Record read. The narrowed values are passed
// straight into the walker (which re-types them via EnlistOptions), never
// trusted for a member access.
type WalkBasicOpts = Parameters<typeof walkBasic>[0];
type WalkAcgOpts = Parameters<typeof walkAcg>[0];

/** Dispatch one combo to its chargen-model walker and return the walk result. */
function driveCombo(combo: CoverageCombo): WalkResult {
  switch (combo.model) {
    case "classic":
      return walkBasic({
        edition: combo.edition as WalkBasicOpts["edition"],
        service: combo.service,
      });
    case "acg": {
      // exactOptionalPropertyTypes forbids passing an explicit `undefined`, and
      // a pathway's picks only carry the sub-domains it crosses (navy has no
      // acgService, mercenary has no acgFleet, …). So assign each optional field
      // only when the pick is present; the walker fills the rest with defaults.
      const p = combo.picks;
      const opts: WalkAcgOpts = { pathway: combo.pathway as WalkAcgOpts["pathway"] };
      if (p.acgService !== undefined) opts.service = p.acgService as EnlistOptions["acgService"];
      if (p.acgCombatArm !== undefined) opts.combatArm = p.acgCombatArm;
      if (p.acgFleet !== undefined) opts.fleet = p.acgFleet as EnlistOptions["acgFleet"];
      if (p.acgDivision !== undefined) opts.division = p.acgDivision as EnlistOptions["acgDivision"];
      if (p.acgLineType !== undefined) opts.lineType = p.acgLineType;
      if (p.acgSubsectorTech !== undefined) opts.subsectorTech = p.acgSubsectorTech;
      return walkAcg(opts);
    }
    case "mongoose":
      return walkMongoose({ career: combo.career });
  }
}

/** Human-readable it.each name that names the exact combo a failure came from. */
function comboLabel(combo: CoverageCombo): string {
  switch (combo.model) {
    case "classic":
      return `${combo.edition} · classic · service=${combo.service}`;
    case "acg": {
      const picks = Object.entries(combo.picks)
        .map(([field, value]) => `${field}=${value}`)
        .join(", ");
      return `${combo.edition} · acg · ${combo.pathway}${picks ? ` · ${picks}` : ""}`;
    }
    case "mongoose":
      return `${combo.edition} · mongoose · career=${combo.career}`;
  }
}

describe("full coverage — every chargen combo yields a rulebook-consistent character", () => {
  it.each(matrix.map((combo) => ({ label: comboLabel(combo), combo })))(
    "$label",
    ({ combo }) => {
      const { character } = driveCombo(combo);
      // The oracle. Throws naming the violated invariant + JSON path on any
      // inconsistency; $soloPolicy-governed skips accumulate in `divergences`
      // instead. Calling it IS the assertion (rich, descriptive failure).
      assertCharacterConsistent(character, divergences);
      driven += 1;
    },
  );

  it("drives every coverageMatrix combo to a validated character (exhaustive)", () => {
    // Runtime proof of exhaustiveness: the number of combos that reached the
    // post-validation increment equals a fresh enumeration of the whole matrix.
    expect(driven).toBe(coverageMatrix().length);
  });

  it("records zero $soloPolicy divergences across the whole matrix", () => {
    // Four mongoose values carry $soloPolicy tags, but none relaxes a
    // whole-character invariant, so no combo skips one. If a future tag ever
    // governs a real skip, this reddens and names the skip.
    expect(divergences).toEqual([]);
  });
});
