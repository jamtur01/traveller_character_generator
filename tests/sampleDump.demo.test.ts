// Runnable per-combo sheet dump: `npm run sample:dump`.
//
// Walks EVERY coverageMatrix() combo at a single deterministic seed
// (DEFAULT_SAMPLE_SEED), validates each generated character with
// assertCharacterConsistent, and writes its formatCharacterSheet to
// coverage-report/sheets/<edition>__<combo-slug>.txt — one file per combo — so
// the real formatted output across the whole coverage matrix can be browsed
// offline. The coverage-report/ dir is gitignored (reused from the coverage
// ledger), so the sheets never enter version control. A one-line summary
// (sheet count + output dir) is printed at the end.
//
// This is a demo AND a test. assertCharacterConsistent is the fail-loud guard:
// a sheet is only written for a character whose whole-character invariants
// hold. The dump also carries teeth of its own — the filenames must be
// collision-free (distinct combo slugs), so a slug that silently merged two
// combos into one file (dropping a sheet) reddens here instead of quietly
// shrinking the output.

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coverageMatrix } from "@/tests/_coverageMatrix";
import { walkCombo, sheetFileName, DEFAULT_SAMPLE_SEED } from "@/tests/_comboWalk";
import { assertCharacterConsistent } from "@/tests/_characterInvariants";
import { formatCharacterSheet } from "@/lib/traveller/sheet";

const SHEETS_DIR = join(process.cwd(), "coverage-report", "sheets");

describe("sample dump — one formatted sheet per coverage combo", () => {
  it("writes a validated sheet file for every coverageMatrix combo", () => {
    const matrix = coverageMatrix();
    mkdirSync(SHEETS_DIR, { recursive: true });
    const written: string[] = [];
    for (const combo of matrix) {
      const { character } = walkCombo(combo, DEFAULT_SAMPLE_SEED);
      // Fail-loud guard: never write a sheet for an inconsistent character.
      assertCharacterConsistent(character);
      const fileName = sheetFileName(combo);
      writeFileSync(join(SHEETS_DIR, fileName), `${formatCharacterSheet(character)}\n`);
      written.push(fileName);
    }
    console.log(
      `\nsample:dump — wrote ${written.length} sheet(s) at seed ` +
        `${DEFAULT_SAMPLE_SEED} to ${SHEETS_DIR}\n`,
    );
    // The matrix must be non-empty (the dump has real work), and every combo
    // must map to a DISTINCT filename — a collision would overwrite a sheet and
    // drop the Set size below the combo count.
    expect(matrix.length).toBeGreaterThan(0);
    expect(new Set(written).size).toBe(matrix.length);
  });
});
