// Raw-key leak audit — the headline bug class of commit b9741b1.
//
// ACG skill-table columns are keyed by raw camelCase ids (armyLife,
// commandSkills, merchantLife, freeTraderBusiness, ...). Those are RESOLUTION
// values, never display text. Before b9741b1 they leaked into player-facing
// strings: the mercenary service-skills picker showed "armyLife", and history
// skill-sources logged "(Merchant service merchantLife)".
//
// This audit drives representative seeded characters through the real walkers
// (all four ACG pathways + Mongoose + CT/MT basic) and asserts that NO raw
// camelCase column key surfaces in either channel a player reads:
//
//   (a) a rendered history line  — formatEvent over every character's events.
//   (b) a pending-choice optionLabels entry — captured from EVERY pickOrDefer
//       the engine raises across the (interactive) walks.
//
// plus a structural invariant that gives the picker channel teeth:
//
//   (c) any pickOrDefer whose OPTIONS are raw camelCase keys MUST carry an
//       optionLabels array, and none of those labels may be a raw key. (This
//       is exactly the shape the mercenary picker regressed to — raw options,
//       absent optionLabels.)
//
// The raw-key set is derived from the shipped JSON (every columnDisplayNames
// map), so it tracks the data, not a hand-copied literal. Reverting b9741b1
// reddens (a): the mercenary/merchant/scout skill-sources go back to raw keys.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Character } from "@/lib/traveller/character";
import { formatEvent } from "@/lib/traveller/history";
import { walkAcg, walkBasic, walkMongoose } from "../_walker";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Raw camelCase column-key set, harvested from every columnDisplayNames map in
// the shipped edition JSON. camelCase = an interior lowercase→uppercase seam
// (armyLife, merchantLife). Single-word keys (shipboard, engineer) titleize to
// a clean word and are out of scope for the "raw camelCase" class.
// ---------------------------------------------------------------------------

function collectColumnKeys(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectColumnKeys(item, out);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "columnDisplayNames" && isRecord(value)) {
      for (const col of Object.keys(value)) {
        if (!col.startsWith("$") && /[a-z][A-Z]/.test(col)) out.add(col);
      }
    }
    collectColumnKeys(value, out);
  }
}

function rawCamelKeys(): string[] {
  const out = new Set<string>();
  for (const id of ["mt-megatraveller", "ct-classic", "mongoose-2e"]) {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(__dirname, `../../data/editions/${id}.json`), "utf8"),
    );
    collectColumnKeys(raw, out);
  }
  return [...out];
}

const RAW_KEYS = rawCamelKeys();

/** The raw keys that appear (as a substring) in `text`. camelCase keys never
 *  occur inside a spaced display label, so a substring hit is an unambiguous
 *  leak. */
function leakedKeysIn(text: string): string[] {
  return RAW_KEYS.filter((k) => text.includes(k));
}

/** camelCase identifier KEYS from the nine-commit narrative glossaries
 *  (fa7c7d4..933a185): schoolDefinitions.<ns>.navalAcademy, benefitGlossary
 *  .shipShares, etc. These are RESOLUTION ids, never display text — a verbose
 *  glossary line must show the spaced label ("Ship Shares"), never the key
 *  ("shipShares"). Harvested from the shipped JSON so the scan tracks the data
 *  rather than a hand-copied list. */
function readEditionJson(id: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(__dirname, `../../data/editions/${id}.json`), "utf8"),
  );
  if (!isRecord(raw)) throw new Error(`edition ${id} JSON is not an object`);
  return raw;
}

function glossaryIdentifierKeys(): string[] {
  const out = new Set<string>();
  const addKeys = (node: unknown): void => {
    if (!isRecord(node)) return;
    for (const k of Object.keys(node)) {
      if (!k.startsWith("$") && /[a-z][A-Z]/.test(k)) out.add(k);
    }
  };
  const ct = readEditionJson("ct-classic");
  const mt = readEditionJson("mt-megatraveller");
  const mg = (readEditionJson("mongoose-2e").mongoose ?? {}) as Record<string, unknown>;
  for (const b of ["materialBenefits", "benefitGlossary", "connections", "skillDefinitions"]) {
    addKeys(mg[b]);
  }
  for (const b of ["musterBenefitDefinitions", "skillDefinitions"]) {
    addKeys(ct[b]);
    addKeys(mt[b]);
  }
  const common = ((mt.advancedCharacterGeneration as Record<string, unknown>)?.common ?? {}) as Record<string, unknown>;
  addKeys(common.decorationDefinitions);
  const schools = common.schoolDefinitions;
  if (isRecord(schools)) {
    for (const [ns, entries] of Object.entries(schools)) if (!ns.startsWith("$")) addKeys(entries);
  }
  return [...out];
}

const GLOSSARY_KEYS = glossaryIdentifierKeys();

// ---------------------------------------------------------------------------
// Drive the walkers and harvest both channels.
// ---------------------------------------------------------------------------

interface CapturedReq {
  kind: string;
  options: string[];
  optionLabels: string[] | undefined;
}

const historyLines: string[] = [];
const capturedReqs: CapturedReq[] = [];

beforeAll(() => {
  // Spy on the ONE choke-point every player choice flows through; the spy calls
  // the real implementation, so the walks behave normally while we record every
  // request's options + optionLabels (across both auto and interactive walks).
  const spy = vi.spyOn(Character.prototype, "pickOrDefer");

  const autoAcg = ["mercenary", "navy", "scout", "merchantPrince"] as const;
  const seeds = [1, 7, 4242];
  for (const pathway of autoAcg) {
    for (const seed of seeds) {
      historyLines.push(...walkAcg({ pathway, seed }).character.events.map(formatEvent));
    }
  }
  // A non-Free-Trader merchant exercises the merchantLife / department columns
  // (Free Trader defaults only reach the freeTrader* columns).
  historyLines.push(
    ...walkAcg({ pathway: "merchantPrince", lineType: "Sector-wide", seed: 7 })
      .character.events.map(formatEvent),
  );
  for (const seed of seeds) {
    historyLines.push(
      ...walkBasic({ edition: "ct-classic", service: "navy", seed }).character.events.map(formatEvent),
    );
    historyLines.push(
      ...walkBasic({ edition: "mt-megatraveller", service: "army", seed }).character.events.map(formatEvent),
    );
    historyLines.push(...walkMongoose({ seed }).character.events.map(formatEvent));
  }

  // Interactive walks: these raise the conditional column pickers (mercenary
  // service-skills, merchant skill-column) that auto mode never builds.
  for (const pathway of autoAcg) {
    for (const seed of seeds) {
      walkAcg({ pathway, seed, interactive: true });
    }
  }
  walkAcg({ pathway: "merchantPrince", lineType: "Sector-wide", seed: 7, interactive: true });
  for (const seed of seeds) {
    walkMongoose({ seed, interactive: true });
  }

  for (const call of spy.mock.calls) {
    const req = call[0];
    capturedReqs.push({
      kind: req.kind,
      options: [...req.options],
      optionLabels: req.optionLabels ? [...req.optionLabels] : undefined,
    });
  }
  spy.mockRestore();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("raw camelCase column keys never reach player-facing text", () => {
  it("the raw-key set is derived and non-empty (guards against a vacuous scan)", () => {
    // Headline offenders must be present, else the scan proves nothing.
    expect(RAW_KEYS).toEqual(expect.arrayContaining([
      "armyLife", "commandSkills", "merchantLife", "freeTraderBusiness",
    ]));
  });

  it("no rendered history line contains a raw column key", () => {
    expect(historyLines.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const line of historyLines) {
      const leaks = leakedKeysIn(line);
      if (leaks.length > 0) offenders.push(`${leaks.join(",")} :: ${line}`);
    }
    expect(offenders, "history lines leaked raw column keys").toEqual([]);
  });

  it("no pending-choice optionLabels entry contains a raw column key", () => {
    expect(capturedReqs.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const req of capturedReqs) {
      for (const label of req.optionLabels ?? []) {
        const leaks = leakedKeysIn(label);
        if (leaks.length > 0) offenders.push(`${req.kind}: ${leaks.join(",")} :: ${label}`);
      }
    }
    expect(offenders, "optionLabels leaked raw column keys").toEqual([]);
  });

  it("any picker offering raw-key OPTIONS carries clean display optionLabels", () => {
    // The exact shape the mercenary picker regressed to: raw camelCase options
    // with no optionLabels (so the UI shows the raw key). At least one such
    // picker must be exercised, else this invariant is vacuous.
    const rawOptionReqs = capturedReqs.filter((r) => r.options.some((o) => /[a-z][A-Z]/.test(o)));
    expect(rawOptionReqs.length, "no camelCase-option picker was exercised").toBeGreaterThan(0);
    for (const req of rawOptionReqs) {
      expect(req.optionLabels, `picker "${req.kind}" with raw options must set optionLabels`)
        .toBeDefined();
      for (const label of req.optionLabels ?? []) {
        expect(label, `picker "${req.kind}" optionLabel "${label}" is a raw camelCase key`)
          .not.toMatch(/[a-z][A-Z]/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Extension: the nine-commit narrative glossaries (fa7c7d4..933a185) added new
// verbose lines (skill/characteristic/connection/muster/rank/decoration/school
// meanings). A display line must render the spaced label, never the camelCase
// resolution key. The same harvested history lines are re-scanned for those
// glossary keys, so a hook that logs a raw id (e.g. "navalAcademy" instead of
// "Naval Academy") reddens here too.
// ---------------------------------------------------------------------------

describe("raw glossary identifier keys never reach a verbose line (fa7c7d4..933a185)", () => {
  it("the glossary-key set is derived and non-empty (guards against a vacuous scan)", () => {
    // preCareer school + ship-share keys are the camelCase offenders in scope.
    expect(GLOSSARY_KEYS).toEqual(expect.arrayContaining(["navalAcademy", "shipShares"]));
  });

  it("no rendered history line contains a raw glossary key", () => {
    expect(historyLines.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const line of historyLines) {
      const leaks = GLOSSARY_KEYS.filter((k) => line.includes(k));
      if (leaks.length > 0) offenders.push(`${leaks.join(",")} :: ${line}`);
    }
    expect(offenders, "history lines leaked a raw glossary key").toEqual([]);
  });
});
