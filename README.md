# Traveller Character Generator

A step-by-step web app that rolls up an RPG character through the canonical Traveller procedure: UPP, enlistment, terms of service, commission and promotion, skill picks, aging, muster-out cash and benefits, and a final TAS Form 2 PDF.

Supports multiple editions side-by-side, currently:

- **Classic Traveller** (1981 / _The Traveller Book_ + _Citizens of the Imperium_)
- **MegaTraveller** (1987 / _MegaTraveller Players' Manual_)

Every rules table is data-driven from the original rulebook pages; each edition's JSON file lives under `data/editions/`. Inspired by [Paul Gorman's 2015 JS generator](https://github.com/pgorman/travellercharactergenerator) for the CT layer.

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

| Script               | Purpose                    |
| -------------------- | -------------------------- |
| `npm run dev`        | Local dev server           |
| `npm run build`      | Production build           |
| `npm run start`      | Serve the production build |
| `npm run lint`       | ESLint                     |
| `npm test`           | Run Vitest once            |
| `npm run test:watch` | Vitest in watch mode       |

## Project layout

```
app/                 Next.js App Router pages + CSS
  page.tsx           The step-by-step UI (stepper, character summary, phase cards)
  layout.tsx
  globals.css

lib/
  pdfSheet.ts        TAS Form 2 PDF renderer (jsPDF)
  traveller/
    index.ts         Public barrel
    types.ts         ServiceKey, AttributeKey, ServiceDef, Skill, ShowHistory
    random.ts        rndInt, arnd, roll (2d6 etc.)
    names.ts         Procedural name pools
    formatting.ts    numCommaSep, intToOrdinal, extendedHex, attrShort
    cascades.ts      BLADES / BOWS / GUNS / VEHICLES / AIRCRAFTS / WATERCRAFTS
    character.ts     Character class + cloneCharacter
    sheet.ts         formatCharacterSheet / formatBenefit / aggregateBenefits
    services/
      common.ts      survivalCheck / commissionCheck / promotionCheck helpers
      navy.ts, marines.ts, … (18 service files — one per career)
      index.ts       Assembles `s` registry, SERVICES, DRAFT_SERVICES

tests/
  sheet.test.ts          TTB Jamison worked-example regression
  services.cells.test.ts Cell-by-cell assertions with rulebook page citations
  services.snapshot.test.ts  One snapshot per service locks every value
  cascades.test.ts       Cascade-pool integrity
  character.test.ts      cloneCharacter, addSkill, improveAttribute, aging
  musterLog.test.ts      Muster-roll outcome descriptions
  flows.test.ts          Multi-step flows with mocked dice
  pdfSheet.test.ts       safeFilename, splitSkills, highestSkillIn, deceased path
```

## Rulebook fidelity

Every value comes from the printed rulebooks:

- **6 core services** (Navy, Marines, Army, Scouts, Merchants, Other) — _The Traveller Book_ pages 24–25
- **12 supplement services** (Pirates, Belters, Sailors, Diplomats, Doctors, Flyers, Barbarians, Bureaucrats, Rogues, Scientists, Hunters, Nobles) — _Citizens of the Imperium_ (CT Supplement 4) pages 6–9 and 13–14

TTB is the canonical reference where the books disagree.

When a rule is encoded inside a function body (DM thresholds, muster-benefit branches, skill-table outcomes), it is locked down two ways:

1. **`tests/services.cells.test.ts`** — explicit, rulebook-readable assertions for every throw, DM, cash cell, rank label, and table cell.
2. **`tests/services.snapshot.test.ts`** — per-service comprehensive snapshot that exercises every skill table × every d6 face and every muster benefit roll with mocked dice. Any value drift fails the snapshot.

## CI

`.github/workflows/test.yml` runs `lint`, `tsc --noEmit`, `vitest`, and `next build` on every push and pull request. The workflow cancels in-flight runs on the same ref when a new commit lands.

## Acknowledgements

- Paul Gorman (original JS generator)
- Frank Filz (contributor to the original)
- Marc Miller, Game Designers' Workshop — _Traveller_ (1977, 1981)
