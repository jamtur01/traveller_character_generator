# Traveller Character Generator

A step-by-step web app that rolls up an RPG character through the canonical Traveller procedure: UPP, homeworld (MegaTraveller), enlistment, terms of service, commission and promotion, skill picks, aging, muster-out cash and benefits, and a final TAS Form 2 PDF.

Supports multiple editions side-by-side, currently:

- **Classic Traveller** (1981 / _The Traveller Book_ + _Citizens of the Imperium_)
- **MegaTraveller** (1987 / _MegaTraveller Players' Manual_) — including Advanced Character Generation (four career pathways with per-year assignment resolution, brownie points, decorations, court martial, and pre-career schooling)
- **Mongoose Traveller 2e** (2022 / _Core Rulebook_) — a 2D+DM task system with per-term qualification, survival, events, commission/advancement, and mustering-out

Every rules table, DM, threshold, rank, cascade, and numeric constant is data-driven from the original rulebook pages; each edition's JSON file lives under `data/editions/`. Inspired by [Paul Gorman's 2015 JS generator](https://github.com/pgorman/travellercharactergenerator) for the CT layer.

## Stack

- Next.js 16 (App Router) on React 19
- Tailwind CSS v4
- jsPDF for the TAS Form 2 output
- Vitest for tests
- TypeScript with `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`

## Setup

Requires Node 24 (pinned in `mise.toml`).

```bash
npm install
npm run dev   # http://localhost:3000
```

## Scripts

| Script               | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Local dev server                               |
| `npm run build`      | Production build                               |
| `npm run start`      | Serve the production build                     |
| `npm run lint`       | ESLint                                         |
| `npm test`           | Run all Vitest tests once (engine + audit)     |
| `npm run test:engine`| Engine-behaviour tests only                    |
| `npm run test:audit` | Data-correctness audits (JSON vs rulebook)     |
| `npm run test:watch` | Vitest in watch mode                           |
| `npm run sample`     | Print sample character sheets (see below)      |
| `npm run sample:dump`| Dump one sheet per creation path to files      |

## Architecture

**JSON is the source of truth.** Every game rule lives in `data/editions/<id>.json`, read at runtime via `getEdition(id)`. Rules are never hardcoded in TypeScript; each value carries a `$rule` / `$comment` citation to its rulebook page. The engine is edition-agnostic and routes through the active edition's data.

- **Edition registry** (`lib/traveller/editions/index.ts`) pairs each edition's JSON with its named-hook implementations (`<edition>/hooks.ts`). A Zod schema (`editions/schema.ts`) validates the load-bearing blocks at load; the UI/engine read the typed `edition.rules` view rather than raw JSON.
- **Engine** (`lib/traveller/engine/`): `serviceLoader.buildServiceDef` builds a runtime service from one JSON service entry; `cellResolver.applyCell` interprets printed cell labels (`"+1 Intel"`, `"Blade Cbt"`, `"Free Trader"`, …) into character mutations; `predicate.ts` is the one condition/DM interpreter (`evaluatePredicate`); `cascadeMap.ts` resolves edition-aware cascade pools; `dmEvaluator`/`musterDm` sum DMs; `skillRestrictions`/`homeworld` handle MT homeworld generation and its skill limits.
- **Basic chargen** (both editions) runs as ordered lifecycle steps (`engine/steps/`, `engine/runners/basic.ts`, `chargen/*`). **Advanced Character Generation** (MegaTraveller only, `engine/acg/`) runs four pathways (`pathways/{mercenary,navy,scout,merchantPrince}.ts`) through a data-driven phase runner with per-year assignment resolution, decorations, brownie points, court martial, and pre-career options.
- **State**: the `Character` class holds core state plus cohesive sub-objects (`characterState.ts`: `AnagathicsState`, `MusterState`, each with its own reset). `AcgState` (`engine/acg/state.ts`) is a **pathway-discriminated union** with a `perTerm` scope sub-record.
- **Interactive vs auto**: `pickOrDefer` resolves recorded picks synchronously via `decisionCursor`; the frontier choice throws `ChoicePendingError`, and `session.resolvePending` re-runs the paused action from its pre-action base with the pick appended (event-sourced re-execution — no mid-flight resume state). `chargen/replay.ts` folds a recorded action log into a snapshot deterministically.
- **UI boundary**: `app/**` reads rules only through the view-model (`lib/traveller/view.ts`, via the barrel) and `EditionMeta` capability flags — it never re-derives rules from raw JSON.

## Project layout

```
app/                     Next.js App Router pages + phase-card UI
  page.tsx               Stepper, character summary, phase cards
  components/phases/      Per-phase UI (enlistment, term, muster, ACG, …)

data/editions/           Source-of-truth rule data (one file per edition)
  ct-classic.json
  mt-megatraveller.json
  names.json             Shared name pools

lib/
  pdfSheet.ts            TAS Form 2 + ACG record-sheet PDF renderer (jsPDF)
  traveller/
    index.ts             Public barrel
    types.ts             ServiceKey, AttributeKey, ServiceDef, Skill, …
    character.ts         Character class + cloneCharacter
    characterState.ts    AnagathicsState / MusterState sub-objects
    random.ts            Rng (roll, arnd, rndInt)
    history.ts           Typed HistoryEvent log + render-time verbosity
    view.ts              UI-facing view-model (term length, capability queries)
    sheet.ts             formatCharacterSheet / benefit aggregation
    formatting.ts        numCommaSep, intToOrdinal, extendedHex
    editions/
      index.ts           Registry: getEdition, DEFAULT_EDITION_ID, listEditions
      schema.ts          Zod validation of the JSON blocks
      types.ts           Edition / EditionMeta / CanonData / hook types
      strict.ts          requireRule / parseDieCount (fail-loud JSON reads)
      ct-classic/hooks.ts, mt-megatraveller/hooks.ts
    engine/
      serviceLoader.ts   buildServiceDef (JSON -> runtime ServiceDef)
      cellResolver.ts    applyCell: cell label -> mutation
      cascadeMap.ts      edition-aware cascade pools + aliases
      predicate.ts       evaluatePredicate (the one DM/condition DSL)
      dmEvaluator.ts     evaluateDM (basic-chargen DMs)
      musterDm.ts        muster benefit/cash DMs
      skillRestrictions.ts  homeworld tech/law skill gates
      homeworld.ts       MT homeworld generation
      registry.ts        named-extension registry helper
      choices.ts         ChoicePendingError + pickOrDefer plumbing
      steps/             basic lifecycle steps (survival, commission, …)
      runners/           basic.ts + acg.ts step walkers
      acg/               Advanced Character Generation (MT)
        phaseRunner.ts, jsonPhases.ts, tables.ts, skills.ts,
        awards.ts, preCareer.ts, schools.ts, state.ts
        pathways/        mercenary, navy, scout, merchantPrince, shared
    chargen/             session, enlistment, term, muster, reenlist,
                         aging, anagathics, weaponBenefits, skillCap, replay

tests/                   Vitest — engine behaviour + tests/audit/ data citations
```

## Rulebook fidelity

Every value comes from the printed rulebooks, cited inline in the JSON with a `$rule`/`$comment` page reference:

- **CT — 6 core services** (Navy, Marines, Army, Scouts, Merchants, Other) from _The Traveller Book_ pp. 24–25.
- **CT — 12 supplement services** (Pirates, Belters, Sailors, Diplomats, Doctors, Flyers, Barbarians, Bureaucrats, Rogues, Scientists, Hunters, Nobles) from _Citizens of the Imperium_ (Supplement 4) pp. 6–9, 13–14.
- **MT — 18 basic services** from the _MegaTraveller Players' Manual_ pp. 20–25, plus the Advanced Character Generation pathways (pp. 44–65) and homeworld generation (pp. 12–13).

Fidelity is enforced by two test tiers (`npm test` runs both):

- `test:engine` — engine behaviour with deterministic dice mocks; asserts exact state changes. `tests/data.validation.test.ts` parameterizes over every edition and cross-checks every service skill/muster cell against the engine.
- `test:audit` (`tests/audit/`) — data-correctness audits verifying the JSON matches the printed tables and the edition schema.

## Validating every character-creation path

The engine ships with an **exhaustive correctness oracle** that generates a real character down every registered creation path and checks each result against the rules:

```bash
npx vitest run tests/fullCoverage.test.ts
```

- **Exhaustive by construction.** `tests/_coverageMatrix.ts` enumerates every path from the edition registries — all Classic and MegaTraveller basic services, every MegaTraveller ACG pathway × fleet × subsector-tech × division × line-type × combat-arm, and every Mongoose career (76 combinations today). The enumerables are read from the JSON, never a hardcoded list, so adding a service / fleet / line-type / career to `data/editions/*.json` automatically mints a new combo the oracle then walks. `tests/coverageMatrix.test.ts` proves the enumeration stays total.
- **Real characters.** `tests/fullCoverage.test.ts` drives each combo end-to-end through the session API (the same surface the UI uses) to a terminal state — mustered out, retired, deceased, or bounded — never treating early termination as an error.
- **Rulebook-consistent output.** Each finished character is checked by `assertCharacterConsistent` (`tests/_characterInvariants.ts`) against invariants derived from the JSON: rank within the declared ladder, benefit/muster rolls within declared bounds, an exactly reconstructable age, skill levels within the skill cap, decorations only from declared tiers, characteristics ≥ 1, and more. A failing combo reddens with the exact path and the violated invariant, naming the JSON value it was derived from.
- **Every outcome, not just the happy path.** `tests/fullCoverageSeeded.test.ts` re-runs all 76 combos across 20 dice seeds each (~1,500 walks), so the same invariants are validated over real failures — deaths, enlistment wash-outs, discharges — not only successful careers. Measured outcome floors (CT deaths, ACG wash-outs) fail the build if a failure branch stops firing.
- **Unexercised-path ledger.** `tests/coverageLedger.test.ts` enumerates every path *element* — each service, skill-table cell, cascade weapon, pre-career school, ACG assignment, Mongoose career/assignment/event, muster row, and terminal outcome (1,152 tags today) — unions what a broad seeded + fuzzed run actually exercises, and **fails on any unexercised tag not covered by a documented allowlist rule** (dice-gated rarities and by-design-unreachable terminals, each with a written reason). The full report is written to `coverage-report/` (git-ignored); currently ~90% exercised, the remainder allowlisted with reasons.

Run it alongside the cell-level and audit checks with `npm test`.

### Generating sample characters

`npm run sample` prints a few real character sheets (including a death and an enlistment wash-out). To generate a specific one, set the selectors:

```bash
SAMPLE_EDITION=mt-megatraveller SAMPLE_COMBO=classic__service-navy SAMPLE_SEED=7 npm run sample
```

`npm run sample:dump` writes one sheet per creation path (76 today) to `coverage-report/sheets/` for offline browsing.

## CI

`.github/workflows/test.yml` runs `lint`, `tsc --noEmit`, `vitest`, and `next build` on every push and pull request, cancelling in-flight runs on the same ref.

## Acknowledgements

- Paul Gorman (original JS generator)
- Frank Filz (contributor to the original)
- Marc Miller, Game Designers' Workshop — _Traveller_ (1977, 1981), _MegaTraveller_ (1987)
