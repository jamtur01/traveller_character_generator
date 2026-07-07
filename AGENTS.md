<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project conventions

A multi-edition Traveller RPG character generator. Classic Traveller (TTB + CotI), MegaTraveller, and Mongoose Traveller 2e (2022 Core Rulebook). ~16k lines of TypeScript across `lib/`, `app/`, with ~4070 tests in `tests/`. Character generation runs behind a per-edition **`ChargenModel`** (see "Pluggable chargen models" below), not edition `if`-branches.

## JSON is the source of truth

Every game rule, table, DM, threshold, rank, skill, cascade, or numeric constant lives in `data/editions/<id>.json`. The engine reads these at runtime via `getEdition(id)` and **strict reads**: `requireRule(value, "json.path", "PM p. N")` (`editions/strict.ts`) throws a citation-bearing error instead of shadowing missing data with a code default. **Do not hardcode game rules in TypeScript, and never write `?? <game-value>` fallbacks** — `tests/audit/rulesLock.audit.test.ts` scans the engine for fallback shadows and fails the suite on any new one (its allowlist requires a written reason per entry and rejects stale entries).

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

## Pluggable chargen models

Character generation dispatches through a `ChargenModel` interface (`chargen/model.ts`); there is no `if (useAcg)` / edition branching in the flow. Each edition's `meta.chargenModels` capability list names its available models and `meta.defaultChargenModel` names the one `startCareer` enters when ACG isn't selected (the `useAcg` option is the only override, forcing `"acg"`); the choice is recorded on `ch.chargenModelId`, then the model's optional `init?(ch)` setup hook runs. Models self-register on import via `chargen/modelRegistry.ts`:

- `classic` (`chargen/models/classic.ts`) — CT/MT basic service lifecycle (enlist → term → muster).
- `acg` (`chargen/models/acg.ts`) — MT Advanced Character Generation (per-year assignment resolution; state on `ch.acgState`).
- `mongoose` (`chargen/models/mongoose.ts`) — Mongoose 2e: 2D+DM task system, per-term qualification → survival(→mishap) → events → advancement/commission → skills → ageing, plus the solo Connections rule and mustering-out. Runtime sub-state on `ch.mongooseState` (`engine/mongoose/state.ts`).

Shared per-term flow helpers live in `chargen/flow.ts`. A model owns its phase set (`entryPhase`, `flowStages`), and `meta.workflowSteps` (`default` / `acg`) drives the JSON-declared "what happens next" start-screen narration. The UI maps a model's phase → panel component through the `MODEL_PHASE_RENDERERS` table in `app/page.tsx` — one map entry per custom model, not a `chargenModelId === "…"` branch in the render tree.

## State model

`Character` (`character.ts`) holds core state plus two cohesive sub-objects declared in `characterState.ts`:

- `ch.anagathics` (`AnagathicsState`) — the anagathics sub-machine + apparent-age; `resetPerTerm()` clears the per-term flags.
- `ch.muster` (`MusterState`) — muster bookkeeping (`forceTable`, `musterRolls`, `musterLog`, …).

Flat accessors on `Character` (e.g. `ch.musterRolls`, `ch.apparentAge`) remain as a stable projection over the sub-objects for the UI/pdfSheet — not dual storage; the sub-object is the source of truth.

`AcgState` (`engine/acg/state.ts`) is a **pathway-discriminated union** (`MercenaryAcgState | NavyAcgState | ScoutAcgState | MerchantAcgState`, keyed on `pathway`) plus a `perTerm` scope sub-record. Read a pathway's role fields only after narrowing — `ch.requireMercenaryAcg()` / `assertPathway(acg, "navy")`.

## Shared roll/DM helpers

Don't hand-roll the "roll a die, find the row, read a column" ritual — reuse:

- `rollDieRow(ch, table, {dice, dm, lo, hi})` and `rollSkillFromColumn(ch, table, col, source)` (`engine/acg/pathways/shared.ts`)
- `columnDmFor(dms, column, ch)` (`engine/acg/tables.ts`) for column-scoped skill-table DMs
- `evaluateDM` (basic) / `applyStructuredDms` (ACG) for condition DMs; `clampedRoll` for bounded rolls

## UI boundary

`app/**` reads rules only through the view-model (`lib/traveller/view.ts`: `termLengthYears`, `anagathicsEligible`, `pistolSkills`, … — surfaced via the `@/lib/traveller` barrel) and `EditionMeta` capability flags (`hasSkillCap`, `hasAnagathics`). Never re-derive a rule from raw JSON in a component; an eslint rule blocks `app/**` imports of `@/lib/traveller/engine/**` and the view layer's deep path.

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

### Correctness oracle

`tests/_characterInvariants.ts` `assertCharacterConsistent(ch)` is the JSON-derived whole-character oracle: it re-derives every invariant (ranks, skills, ages, muster arithmetic) from the edition JSON and asserts the generated character agrees, treating any `$soloPolicy`-governed field as an allowed divergence rather than a failure. `tests/fullCoverage.test.ts` drives **every** registry-enumerated edition × model × pathway/career combo (`tests/_coverageMatrix.ts` enumerates them; `_walker.ts`'s `walkAcg` / `walkBasic` / `walkMongoose` run each to its terminal phase) and asserts `assertCharacterConsistent` on every result — `driven === coverageMatrix().length` proves the sweep is exhaustive. New rules should fall out of this sweep; prefer wiring a combo over a bespoke test.

## Random / determinism

Never `Math.random()` directly in production code — use the wrappers. The bug-fix commit `435b7b1` replaced four such sites with `arnd()`.

## Interactive choices: cursor + re-execution

The resume model is event-sourced re-execution — there is no mid-flight resume and no idempotence caching:

- `ch.pickOrDefer(req)`: in auto mode resolves inline (preferred pool or random). In interactive mode it first consults `ch.decisionCursor` — previously recorded option indices are consumed **synchronously** (the `onResolve` runs immediately and execution continues). Only the frontier choice (cursor exhausted) queues `pendingChoices` and throws `ChoicePendingError` once, unwinding to the session boundary.
- Every session action (`chargen/session.ts`) captures a pre-action base (`cloneCharacter`, rng position included) and runs straight through. The returned snapshot carries `frontier: { action, base, resolutions }` while paused. `session.resolvePending` appends the pick and **re-runs the whole action from the base** — the prefix re-executes identically (same seeded stream), so double-apply is structurally impossible.
- Determinism of re-execution requires a **seeded run** (the UI seeds every run; the harness always seeds) or fully pinned `Math.random` (walker tests). Never rely on unseeded interactive runs.
- Always thread the **whole** `ChargenSnapshot` between actions — reconstructing `{character, phase}` drops the frontier and breaks `resolvePending`.

When catching the pause, catch *specifically* — a bare `catch {}` swallows real engine errors (missing JSON rows, draft rejections, structural bugs):

```ts
import { ChoicePendingError } from "@/lib/traveller/engine/choices";

try {
  runAcgYear(c);
} catch (err) {
  if (!(err instanceof ChoicePendingError)) throw err;
  // …the character now carries pendingChoices; resolution happens via
  // session.resolvePending (re-execution), never by re-entering the runner.
}
```

## Structured DMs

DM rules in JSON are objects, not free-text strings:

```json
{ "attribute": "education", "min": 9, "dm": 2 }
{ "rankAtMost": "O2", "dm": -2 }
{ "fleet": "imperialNavy", "dm": -2 }
{ "modifier": "termNumber" }
```

Evaluated via `applyStructuredDms` / `evaluateDM`. The latter accepts a narrow `DmContext` interface (`{attributes, terms}`), not a full `Character` — widening the evaluator to read other state is now a compile error.

## Option domains

Every player-choice **domain** — the ordered set of options a decision offers — is read through one accessor: `optionDomain(editionId, decisionId) -> { field?, values }` (`editions/optionDomains.ts`). `decisionId` is a dotted key (`"acg.navy.fleet"`, `"mongoose.career"`, `"classic.service"`); `values` is the order-significant enumerable strict-read from the edition JSON (never a `?? [...]` literal); optional `field` names the `EnlistOptions` property the choice writes into — in-flow `pickOrDefer` domains omit it. The `DOMAINS` table registers the promoted decisionIds (navy fleets / subsector-tech / officer-skill-tables, mercenary services, scout divisions, merchant line-types / departments / skill-tables, the ACG pathway list, classic serviceOrder, Mongoose careers / skill-training / muster-benefit columns, CT weapon-benefit types), each guarded by an independent drift-lock in `tests/audit/optionDomains.audit.test.ts`. **Pure yes/no affordances stay engine-side by design** — Accept/Decline a career, Attempt a commission, Apply/Skip an academy carry no enumerable worth citing (see the `optionDomains.ts` header). Don't "promote" them.

## Declarative resolveAssignment verbs

ACG per-assignment side-effects are **declarative JSON verbs**, not named callbacks. A pathway's `resolveAssignment` config carries verb objects — `{ verb: "promote" | "rollSkill" | "finalize" | "awardCashBonus" | "dmTradeoffPrompt", … }` — interpreted by `engine/acg/jsonPhases.ts` (`requireVerbKind` fails loud on edition ↔ interpreter drift). The former per-pathway named-callback registry (`onPass: "callbackName"` strings) is gone; each verb strategy reuses the shared primitives and runs only when the pathway's JSON declares it.

## Enlistment primitives

Enlistment composes generic, JSON-parameterized primitives in `engine/acg/pathways/shared.ts` — `resolveDraft`, `commitStartingRank`, `checkEnlistmentGate` (an ordered-ladder threshold shared by the navy tech gate and the merchant starport gate), `rerollUntilLegal` — instead of per-pathway enlist game literals. A pathway feeds each primitive its table / threshold / ladder from its own JSON block; no `pathway === "…"` branch lives inside the primitives.

## Court-martial effect DSL

`common.courtMartial.dieResults[]` rows carry a structured `effects[]` array — a `kind`-discriminated union (`reprimand` / `reduceRank` / `jailMonths` / `jailYears` / `dishonorableDischarge` / `deathSentence`, validated by `CourtMartialEffectSchema`) — that replaced the prose-regex interpreter formerly in `awards.ts`. The sibling `result` string is now only the human/PM-cited label; the engine applies the effect objects.

## `$soloPolicy` annotations

`$soloPolicy` is a JSON annotation (sibling to the value it qualifies, naming the book page that leaves the point unspecified) marking an **engine auto-play choice the rulebook does NOT print** — distinct from `$rule`, which cites a printed rule. The value still lives in JSON and is read via `requireRule`; the `$soloPolicy` string itself is doc-only (the engine never reads it). Current users: `advancedCharacterGeneration.common.bpSpend` (PM p. 46) and the Mongoose non-printed heuristics `agingCrisisRestore`, `reductionPolicy`, `connectionsPolicy`, `shipSharesPolicy` (Core pp. 19 / 46 / 49). `tests/_characterInvariants.ts` skips any invariant a `$soloPolicy` governs, so the oracle never flags a solo choice as a rules divergence.

## Documented conventions (deliberately NOT rules-in-JSON)

Four audit rounds converged on these as OK-structural — they are conventions, not shadows. Do not "migrate" them, and do not use them as precedent for new literals:

- **Uniform die counts.** Plain 2D checks / 1D table rolls are the system's single resolution mechanic; JSON declares dice **only where they vary** (`courtMartial.*.die`, `navy.retention.throw.die`, `marineTradition.savingThrow.die`, jail/education dice strings — parsed via `parseDieCount`, which throws on unknown formats).
- **`skillPoints += 1` / `rank += 1`** step semantics — definitional to the steps; variable magnitudes (overshoot thresholds) are JSON.
- **BP mechanics**: 1 BP = +1 die step is the definition of a brownie point (definitional, stays in code). The auto-play spend caps and interactive picker bound are NOT book rules — PM p. 46 allows "any number" of BP on a roll — so they live in `advancedCharacterGeneration.common.bpSpend` (`defaultAutoPolicy`, `conservativeCaps.{promotion,default}`, `pickerMax`) under a cited `$soloPolicy` tag (engine auto-play choice the book leaves open), read via `requireRule`.
- **`-99` muster sentinel** for "no benefits" (death penalty) — documented arithmetic encoding.
- **Pre-enlistment placeholders**: `rankCode: "E1"`, constructor `age = 18` — always overwritten from JSON at enlist/start (`acg.common.startAge`, `services.*.startAge`).
- **`beginAcg` API defaults** — pickerless auto flows take the first printed option; UI and RunLog always pass explicit values.
- **Rank-code format strings** (`O${n}`, `E${n}`, `IS-${n}`) — notation; ladder values are JSON.
- **Natural 2..12 clamps** on 2D arithmetic; table-shape loop bounds that double as validators (missing rows throw).
- **Display-layer heuristics** with citations (pistol `endsWith` classification, "Middle Passage" alias, presentation ordering).
- **cellResolver cascade keys.** `cascadeKey === "bladeCombat"` / `"gunCombat"` and the muster `label === "Weapon"` branch in `cellResolver.ts` are cascade **identifiers / notation** that dispatch to the benefit handler — not game values; the pools and tables they name live in JSON.
- **`edition.hooks.doPromotion`** (`editions/*/hooks.ts`) is the sanctioned per-edition **named-hook escape hatch** for genuinely ad-hoc promotion mechanics no JSON table can express (e.g. CT nobles' social-standing-by-rank). Register a hook; never inline an `if (edition === …)`.
- **`AcgState` is a typed discriminated union**, not a stringly-typed `roleState` bag (`engine/acg/state.ts`). The pathway-narrowing guards (`ch.requireMercenaryAcg()`, `assertPathway(acg, "navy")`) are **type-narrowing, not game logic** — they let the compiler prove a pathway's role fields are present and carry no rules.

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
  view.ts                 — UI view-model (termLengthYears, anagathicsEligible, …)
  index.ts                — public barrel (Character NOT re-exported — see comment)
  editions/
    index.ts              — DEFAULT_EDITION_ID, getEdition, listEditions
    schema.ts             — Zod validation of the JSON blocks (parseRules/parseCanonData)
    types.ts              — Edition / EditionMeta / CanonData / hook types
    strict.ts             — requireRule / parseDieCount (fail-loud JSON reads)
    optionDomains.ts      — optionDomain(editionId, decisionId): player-choice domain accessor
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
      phaseRunner.ts, jsonPhases.ts — per-year assignment-resolution drivers
      tables.ts           — structured/column DM evaluation, resolution lookup
      state.ts            — AcgState discriminated union + perTerm scope
      skills.ts           — applyAcgSkillCell
      awards.ts           — decorations, court-martial, brownie awards
      preCareer.ts        — college, naval/military/merchant academy, med/flight school
      schools.ts          — special-assignment school application
      pathways/
        shared.ts         — createPathwaySpecRegistry, rollDieRow/rollSkillFromColumn, reenlist
        mercenary.ts      — army/marines
        navy.ts           — imperial/reserve/system squadron
        scout.ts          — field/bureaucracy divisions
        merchantPrince.ts — line types + departments
    mongoose/             — Mongoose Traveller 2e engine (2022 Core Rulebook)
      core.ts, state.ts   — MongooseState + characteristicDm / rollCheck primitives
      enlist.ts, survival.ts, advancement.ts — qualification, survival/mishap, advance/commission
      skills.ts, skillsTraining.ts, effects.ts — skill grants + caps, the MongooseEffect interpreter
      events.ts, muster.ts, aging.ts, connections.ts, ranks.ts
  chargen/                — session, enlistment, term, muster, reenlist, aging,
                            anagathics, weaponBenefits, skillCap, replay
    model.ts, modelRegistry.ts, flow.ts — ChargenModel interface + registry + shared per-term flow
    models/               — classic.ts (CT/MT basic), acg.ts (MT ACG), mongoose.ts (Mongoose 2e)
data/
  editions/
    ct-classic.json
    mt-megatraveller.json
    mongoose-2e.json
  names.json              — shared name pools
tests/
  *.test.ts               — engine behaviour
  audit/*.audit.test.ts   — data citations vs. PM/TTB + schema enforcement
  regressions.test.ts     — locked-in fixes from the code-review pass
  fullCoverage.test.ts    — exhaustive combo driver → assertCharacterConsistent on each
  _characterInvariants.ts — assertCharacterConsistent: JSON-derived whole-character oracle
  _coverageMatrix.ts      — combo enumeration (walkers in _walker.ts: walkAcg/walkBasic/walkMongoose)
  *.golden.test.ts        — behaviour-lock characterizations (courtMartial, enlist, preCareerSchools, merchantExams, memberName, careerAvailability)
  optionDomainFieldBinding.test.ts — optionDomain field ↔ keyof EnlistOptions binding
  audit/optionDomains.audit.test.ts — per-domain drift-locks (+ audit/bpSpend.audit.test.ts)
```

## When in doubt

- For game-rule changes: read the PM/TTB excerpt, then edit JSON with a `$rule` citation. The engine should already consume it.
- For new tests: run with a deterministic `Math.random` mock and assert exact end state. Use `tests/data.validation.test.ts` as the model for cross-validation patterns.
- For new pathways or editions: extend the JSON; if the engine genuinely lacks support, add a registered hook (`STEP_REGISTRY`, `acgPathways`) rather than special-casing in shared code.
