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
import { coverageMatrix } from "@/tests/_coverageMatrix";
import { walkCombo, comboLabel } from "@/tests/_comboWalk";
import {
  assertCharacterConsistent,
  type SoloDivergence,
} from "@/tests/_characterInvariants";

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

describe("full coverage — every chargen combo yields a rulebook-consistent character", () => {
  it.each(matrix.map((combo) => ({ label: comboLabel(combo), combo })))(
    "$label",
    ({ combo }) => {
      const { character } = walkCombo(combo);
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
