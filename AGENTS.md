<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project conventions

A multi-edition Traveller RPG character generator. Classic Traveller (TTB + CotI) and MegaTraveller. ~15k lines of TypeScript across `lib/`, `app/`, with ~3400 tests in `tests/`.

## JSON is the source of truth

Every game rule, table, DM, threshold, rank, skill, cascade, or numeric constant lives in `data/editions/<id>.json`. The engine reads these at runtime via `getEdition(id)`. **Do not hardcode game rules in TypeScript.** If you find yourself writing `if (target >= 6)` for a survival check, the `6` belongs in JSON.

When adding or moving data into JSON, include a `$rule` or `$comment` field with the PM/TTB page and line reference. Example:

```json
"decorationTiers": {
  "$rule": "PM p. 49 line 3050-3056 (Mercenary), echoed on p. 53 for Navy. ...",
  "tiers": [ ... ]
}
```

The decoration-tier engine bug I fixed in `awards.ts` was caused by a missing fallback to `common.decorationTiers` — mercenary characters never got decorations because the pathway didn't declare its own tier block. Bugs like this are easy to introduce when JSON shape diverges silently.

## Edition-aware engine

Every `Character` carries an `editionId`. Engine code that reads game data takes either a `Character` or an explicit `editionId` and routes through:

- `getEdition(id)` — full edition data
- `getEditionServices(id)` — per-edition service registry
- `cascadePoolByKey("bladeCombat", id)` — per-edition cascade pool
- `cascadeKeyForLabel(label, id)` — printed label → cascade key
- `attrKeyFromAbbreviation(id, "Stren")` — abbreviation → attribute

CT uses abbreviations like `"Stren"`. MT uses both abbreviations and full names (`"Strength"`, `"Str"`). Every edition declares its own `attributeAbbreviations` and `skillLabelRenames` blocks to normalize.

The legacy `s` global (`lib/traveller/services`) binds to `DEFAULT_EDITION_ID` only. For edition-agnostic code, use `getEditionServices(ch.editionId)` instead.

## State model

`Character` (`character.ts`) holds core state plus two cohesive sub-objects declared in `characterState.ts`:

- `ch.anagathics` (`AnagathicsState`) — the anagathics sub-machine + apparent-age; `resetPerTerm()` clears the per-term flags.
- `ch.muster` (`MusterState`) — muster bookkeeping (`forceTable`, `musterRolls`, `musterLog`, …).

Flat accessors on `Character` (e.g. `ch.musterRolls`, `ch.apparentAge`) remain as a stable projection over the sub-objects for the UI/pdfSheet — not dual storage; the sub-object is the source of truth.

`AcgState` (`engine/acg/state.ts`) is a **pathway-discriminated union** (`MercenaryAcgState | NavyAcgState | ScoutAcgState | MerchantAcgState`, keyed on `pathway`) plus `perYear`/`perTerm` scope sub-records. Read a pathway's role fields only after narrowing — `ch.requireMercenaryAcg()` / `assertPathway(acg, "navy")`; `clearYearScopedState` is `acg.perYear = freshPerYear()`.

## Shared roll/DM helpers

Don't hand-roll the "roll a die, find the row, read a column" ritual — reuse:

- `rollDieRow(ch, table, {dice, dm, lo, hi})` and `rollSkillFromColumn(ch, table, col, source)` (`engine/acg/pathways/shared.ts`)
- `columnDmFor(dms, column, ch)` (`engine/acg/tables.ts`) for column-scoped skill-table DMs
- `evaluateDM` (basic) / `applyStructuredDms` (ACG) for condition DMs; `clampedRoll` for bounded rolls

## UI boundary

`app/**` reads rules only through the edition view-model (`editions/view.ts`: `termLengthYears`, `anagathicsEligible`, `pistolSkills`, …) and `EditionMeta` capability flags (`hasSkillCap`, `hasAnagathics`). Never re-derive a rule from raw JSON in a component.

## Test discipline

The suite is split into two categories with separate npm scripts:

- `npm run test:engine` — engine behaviour tests. Run the engine with deterministic mocks; assert state changes.
- `npm run test:audit` — data-correctness tests under `tests/audit/`. Verify JSON matches the printed rulebooks and edition schema.
- `npm test` — both.

### Anti-theatre rules

A test that always passes regardless of engine state is worse than no test. Avoid these patterns:

```ts
// THEATRE — both branches pass; assertions are trivially true.
if (!c.activeDuty) {
  expect(c.acgState!.browniePoints).toBe(initialBp);
} else {
  expect(c.acgState!.browniePoints).toBeLessThanOrEqual(initialBp);
}

// THEATRE — passes if the random outcome doesn't produce decorations.
if (c.decorations.length > 0) {
  expect(...).toContain("MCUF");
}

// THEATRE — "didn't throw" is the only assertion.
expect(() => runAcgTerm(c)).not.toThrow();

// THEATRE — tautological / unconstrained.
expect(typeof result).toBe("boolean");
expect(c.acgState!.year).toBeGreaterThanOrEqual(yearBefore);
```

If you must guard behind a conditional, document why the condition holds deterministically given your mock, or remove the guard and assert directly. With `Math.random` pinned, outcomes should be predictable enough to assert exact values.

### Mocking randomness

```ts
import { roll, arnd, rndInt } from "@/lib/traveller/random";
```

- `roll(n)` — sum of n d6 (game dice)
- `arnd(arr)` — random element of array
- `rndInt(min, max)` — uniform integer in `[min, max]`

In tests, mock `Math.random` directly with sequenced returns:

```ts
const d6 = (v: number) => (v - 1) / 6 + 0.001;
let i = 0;
const seq = [d6(6), d6(6), d6(1), ...];
vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(6));
```

`Character`'s constructor consumes 12 `Math.random` calls for attribute generation. Install the mock **after** construction, or pad the sequence with 12 leading values, or override attributes after constructing.

### Cross-validation (gold tier)

`tests/data.validation.test.ts` parameterizes over every active edition. It picks every cell of every service's skill tables + muster tables, runs the engine, and asserts the engine output matches the JSON cell. New rules and edge cases should be wired so this auto-discovers them — don't add cell-specific tests when the parameterized sweep already covers them.

## Random / determinism

Never `Math.random()` directly in production code — use the wrappers. The bug-fix commit `435b7b1` replaced four such sites with `arnd()`.

## Catching `ChoicePendingError`

Interactive ACG flow throws `ChoicePendingError` to pause the runner and surface a player choice. Always catch this *specifically*:

```ts
import { ChoicePendingError } from "@/lib/traveller/engine/choices";

try {
  runAcgYear(c);
} catch (err) {
  if (!(err instanceof ChoicePendingError)) throw err;
  // …handle the pending choice
}
```

A bare `catch {}` here will swallow real engine errors (missing JSON rows, draft rejections, structural bugs).

## Structured DMs

DM rules in JSON are objects, not free-text strings:

```json
{ "attribute": "education", "min": 9, "dm": 2 }
{ "rankAtMost": "O2", "dm": -2 }
{ "fleet": "imperialNavy", "dm": -2 }
{ "modifier": "termNumber" }
```

Evaluated via `applyStructuredDms` / `evaluateDM`. The latter accepts a narrow `DmContext` interface (`{attributes, terms}`), not a full `Character` — widening the evaluator to read other state is now a compile error.

## Hard limits & style

Inherits the global CLAUDE.md standards:
- ≤100 lines/function, complexity ≤8, ≤5 positional params, 100-char lines
- Absolute imports only (no `../..`); paths use `@/lib/...`
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Zero lint warnings
- No bare `catch {}`, no swallowed errors
- Avoid commented-out code, no `TODO`/`FIXME` (file an issue instead)

## Workflow

Before committing:
1. `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` (verify TS clean — IDE diagnostics are often stale-cache)
2. `npm run lint`
3. `npm test`

Useful scripts:
- `npm run test:engine` — engine tests only (~1700 tests)
- `npm run test:audit` — data audits only (~1300 tests)
- `npm test` — both

If you're working on JSON content, run `test:audit` first — failures there mean your JSON is out of sync with the PM/TTB.

## Common pitfalls

1. **LSP stale-cache diagnostics.** The TypeScript server in your editor will sometimes report `Character is missing properties X, Y, Z` or `Module has no exported member` when `tsc --noEmit` says exit 0. Trust `tsc`. Restart the TS server (⌘⇧P → "TypeScript: Restart TS Server").

2. **Mocking randomness for `Character` constructor.** `new Character()` consumes 12 `Math.random` calls for attribute rolls (plus 2-3 for gender/name). Preferred: pass `new Character({ attributes: {...} })` to skip the attribute rolls entirely. Otherwise install the mock after construction, or pad the sequence with 12 leading values.

3. **MT vs. CT cell labels.** MT uses canonical `"Blade Combat"`, CT uses abbreviated `"Blade Cbt"`. Both edition JSONs declare aliases via `cascadeAliases`. When writing tests, use the label the edition's JSON declares — don't assume CT-style.

4. **Adding services or pathways.** Most "I need to write engine code for this" turns out to be "I need to add data to JSON and the engine already reads it." Skim `data/editions/mt-megatraveller.json` before extending TS.

5. **Anagathics retry path is subtle.** `tryAnagathics(allowRetry=true)` may call `rollAnagathicsAvailability` twice. The state flags now live on `ch.anagathics` (`AnagathicsState`): `anagathicsWithdrawalThisTerm`, `onAnagathics`, etc. must be consistent at the end, and per-term flags reset via `ch.anagathics.resetPerTerm()`. See the regression test in `tests/regressions.test.ts`.

6. **Ship mortgage.** First receipt of a mortgaged ship sources the initial mortgage from `benefitDetails.firstReceiptMortgageYears` (owned ships omit it → no mortgage). Repeat receipts pay down `repeatReducesMortgageYears` per receipt, clamped at 0 — never negative. See `cellResolver.ts applyShipBenefit`.

## File map

```
lib/traveller/
  character.ts            — Character class (~1500 lines)
  characterState.ts       — AnagathicsState / MusterState sub-objects
  random.ts               — Rng: roll, arnd, rndInt
  history.ts              — typed HistoryEvent log + render-time verbosity
  cascades.ts             — CT-bound cascade exports (legacy; prefer cascadePoolByKey)
  index.ts                — public barrel (Character NOT re-exported — see comment)
  editions/
    index.ts              — DEFAULT_EDITION_ID, getEdition, listEditions
    schema.ts             — Zod validation of the JSON blocks (parseRules/parseCanonData)
    types.ts              — Edition / EditionMeta / CanonData / hook types
    view.ts               — UI view-model (termLengthYears, anagathicsEligible, …)
    ct-classic/hooks.ts   — CT-only doPromotion overrides (e.g., nobles social-by-rank)
    mt-megatraveller/hooks.ts
  engine/
    serviceLoader.ts      — buildServiceDef: JSON ServiceData → runtime ServiceDef
    cellResolver.ts       — applyCell: attribute / cascade / Includes / ship / passage
    cascadeMap.ts         — cascadePoolByKey, isCascadeLabel, cascadeKeyForLabel
    predicate.ts          — evaluatePredicate (the one DM/condition DSL)
    dmEvaluator.ts        — evaluateDM(rules, DmContext)
    musterDm.ts           — benefitDmFor, cashDmFor, maxCashRolls
    skillRestrictions.ts  — homeworld tech/law skill gates
    homeworld.ts          — MT homeworld generation
    registry.ts           — named-extension registry helper
    choices.ts            — ChoicePendingError, pickOrDefer plumbing
    steps/                — basic lifecycle steps: survival, commission, promotion, …
    runners/              — basic.ts + acg.ts step walkers
    acg/                  — Advanced Character Generation (MT)
      runner.ts, phaseRunner.ts, jsonPhases.ts — per-year/term step drivers
      tables.ts           — structured/column DM evaluation, resolution lookup
      state.ts            — AcgState discriminated union + perYear/perTerm
      subStepCache.ts     — per-year sub-step memoization for resume
      browniePoints.ts    — tryMitigate, spendBrowniePoints
      awards.ts           — decorations, court-martial, brownie awards
      preCareer.ts        — college, naval/military/merchant academy, med/flight school
      schools.ts          — special-assignment school application
      pathways/
        shared.ts         — createPathwaySpecRegistry, rollDieRow/rollSkillFromColumn, reenlist
        mercenary.ts      — army/marines
        navy.ts           — imperial/reserve/system squadron
        scout.ts          — field/bureaucracy divisions
        merchantPrince.ts — line types + departments
  chargen/                — session, enlistment, term, muster, reenlist, aging,
                            anagathics, weaponBenefits, skillCap, replay
data/
  editions/
    ct-classic.json
    mt-megatraveller.json
  names.json              — shared name pools
tests/
  *.test.ts               — engine behaviour
  audit/*.audit.test.ts   — data citations vs. PM/TTB + schema enforcement
  regressions.test.ts     — locked-in fixes from the code-review pass
```

## When in doubt

- For game-rule changes: read the PM/TTB excerpt, then edit JSON with a `$rule` citation. The engine should already consume it.
- For new tests: run with a deterministic `Math.random` mock and assert exact end state. Use `tests/data.validation.test.ts` as the model for cross-validation patterns.
- For new pathways or editions: extend the JSON; if the engine genuinely lacks support, add a registered hook (`STEP_REGISTRY`, `acgPathways`) rather than special-casing in shared code.
