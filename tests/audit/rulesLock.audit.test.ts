// Rules-lock structural guard: engine code must never shadow an edition-JSON
// game value with a `?? literal` / `|| literal` fallback. Project law
// (lib/traveller/editions/strict.ts): every game value lives in
// data/editions/<id>.json; when one is missing, code fails loudly via
// requireRule — it never papers over the hole with a default. Two audit
// rounds each found dozens of these shadows; this test makes reintroducing
// one a suite failure with a file:line pointer.
//
// Flagged, on live code only (comments and string BODIES are blanked first):
//   - `?? <integer >= 1>`  and `|| <integer >= 1>`   (e.g. `?? 5`, `|| 12`)
//   - `?? "<Uppercase-leading string>"` and the `||` form — game labels and
//     rank codes like "Deck", "Line", "O1", "E4", "IS-..." all start with an
//     uppercase letter, so one rule covers them for ", ', and ` quotes.
//   - the `??=` / `||=` assignment forms of the above.
// NOT flagged: `?? 0` (absence-of-DM identity), `?? undefined`, `?? null`,
// `?? []`, `?? {}`, `?? ""`, lowercase-leading strings, and the `??=` forms
// of those.
//
// TEETH: adding `const x = cfg.foo ?? 5;` to any scanned file fails the scan
// test naming that file and line. The scanner itself is unit-tested below
// against synthetic positive and negative sources, so the regex cannot rot
// into a silent no-op.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

// Blank comments and string/template bodies while preserving newlines and the
// opening quote plus the FIRST body character of every string (so `?? "Deck"`
// survives as `?? "D   "` — enough for the detector — while a `?? 5` mentioned
// inside a comment or string body can never trip it). Template interpolations
// `${...}` are treated as code, with brace tracking so object literals inside
// them do not end the interpolation early.
function blankNonCode(src: string): string {
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  let out = "";
  let i = 0;
  let kept = false; // first body char of the current string already kept?
  let brace = 0; // brace depth of the current code frame
  const interp: number[] = []; // saved brace depths across `${...}` frames
  while (i < src.length) {
    const c = src.charAt(i);
    const next = src.charAt(i + 1);
    if (mode === "code") {
      if (c === "/" && next === "/") {
        mode = "line";
        out += "  ";
        i += 2;
      } else if (c === "/" && next === "*") {
        mode = "block";
        out += "  ";
        i += 2;
      } else if (c === "'" || c === '"' || c === "`") {
        mode = c === "'" ? "single" : c === '"' ? "double" : "template";
        kept = false;
        out += c;
        i += 1;
      } else if (c === "{") {
        brace += 1;
        out += c;
        i += 1;
      } else if (c === "}") {
        if (brace === 0 && interp.length > 0) {
          brace = interp.pop() ?? 0;
          mode = "template";
          kept = true; // resume blanking the template body
        } else if (brace > 0) {
          brace -= 1;
        }
        out += c;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += "\n";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        out += "  ";
        i += 2;
      } else {
        out += c === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    // string / template body
    if (c === "\\") {
      out += " ";
      out += next === "\n" ? "\n" : " ";
      i += 2;
      continue;
    }
    if (mode === "template" && c === "$" && next === "{") {
      interp.push(brace);
      brace = 0;
      mode = "code";
      out += "  ";
      i += 2;
      continue;
    }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      mode = "code";
      out += c;
      i += 1;
      continue;
    }
    if (c === "\n") {
      out += "\n";
    } else if (kept) {
      out += " ";
    } else {
      kept = true;
      out += c;
    }
    i += 1;
    continue;
  }
  return out;
}

// `??`/`||` (or `??=`/`||=`) followed by an integer >= 1 or a quoted string
// whose first character is an uppercase letter. `\s*` deliberately spans
// newlines so a wrapped `??\n  5` is still caught.
const FALLBACK = /(?:\?\?|\|\|)=?\s*(?:0*[1-9]\d*\b|["'`][A-Z])/g;

interface Hit {
  line: number; // 1-based
  text: string; // raw source line, trimmed
}

function scanSource(src: string): Hit[] {
  const blanked = blankNonCode(src);
  const rawLines = src.split("\n");
  const hits: Hit[] = [];
  const seen = new Set<number>();
  for (const m of blanked.matchAll(FALLBACK)) {
    const line = blanked.slice(0, m.index).split("\n").length;
    if (seen.has(line)) continue;
    seen.add(line);
    hits.push({ line, text: (rawLines[line - 1] ?? "").trim() });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Scan scope
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../..");
const SCAN_DIRS = ["lib/traveller/engine", "lib/traveller/chargen"];
const SCAN_FILES = [
  "lib/traveller/character.ts",
  "lib/traveller/view.ts",
  "lib/traveller/history.ts",
  "lib/traveller/services.ts",
];

function collectSources(relDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectSources(rel));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(rel);
    }
  }
  return out;
}

function editionHooks(): string[] {
  const dir = resolve(ROOT, "lib/traveller/editions");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(dir, e.name, "hooks.ts")))
    .map((e) => `lib/traveller/editions/${e.name}/hooks.ts`);
}

const SOURCES = [...SCAN_DIRS.flatMap(collectSources), ...SCAN_FILES, ...editionHooks()];

// ---------------------------------------------------------------------------
// Allowlist — every entry MUST carry a reason. An entry that no longer
// matches any scanner hit is stale and fails the suite (prune it).
// ---------------------------------------------------------------------------

interface AllowEntry {
  file: string; // relative path, as produced by the scan
  lineIncludes: string; // substring of the raw source line at the hit
  reason: string;
}

const ALLOWLIST: AllowEntry[] = [
  {
    file: "lib/traveller/engine/acg/pathways/mercenary.ts",
    lineIncludes: "armGate.errorMessage ??",
    reason:
      "Diagnostic prose, not a rule value: fallback text for the thrown " +
      "combat-arm-gate error when the JSON's armGates entry supplies no " +
      "custom errorMessage. The gate itself (honorsGraduateOf) is JSON-read.",
  },
  {
    file: "lib/traveller/engine/acg/preCareer.ts",
    lineIncludes: 'branchOptions[0] ?? "Army"',
    reason:
      "REPORTED: candidate violation — pending round-3 audit. \"Army\" " +
      "shadows college.otc.autoEnlist.branchOptions[0] (PM p. 47) when the " +
      "JSON array is empty; strict form is requireRule(branchOptions[0], ...).",
  },
  {
    file: "lib/traveller/engine/acg/preCareer.ts",
    lineIncludes: "parseDieExpression(s, rng) ?? 1",
    reason:
      "Dead narrowing, not a live default: every parseDynamicSkill caller " +
      "gates on hasDieExpression(skill) first, so parseDieExpression cannot " +
      "return null here; the 1 is unreachable type-narrowing.",
  },
  {
    file: "lib/traveller/engine/acg/schools.ts",
    lineIncludes: "meta?.rollsPerAttendance ?? 1",
    reason:
      "REPORTED: candidate violation — pending round-3 audit. All seven " +
      "scout schools declare rollsPerAttendance in scout.schoolMeta " +
      "(PM p. 57); the ?? 1 would silently mask a missing declaration.",
  },
  {
    file: "lib/traveller/engine/runners/acg.ts",
    lineIncludes: "(ch.acgState.year ?? 1) > 1",
    reason:
      "Engine runtime state, not edition data: year is the engine's own " +
      "1-based term-year counter (set to 1 by runAcgTerm itself); this is " +
      "resume-detection bookkeeping.",
  },
  {
    file: "lib/traveller/engine/runners/acg.ts",
    lineIncludes: "(ch.acgState.year ?? 1) - 1",
    reason:
      "Engine runtime state, not edition data: same 1-based year counter as " +
      "the resume-detection guard above, used to compute the loop restart " +
      "index when re-entering a paused term.",
  },
  {
    file: "lib/traveller/engine/steps/autoSkillTerm.ts",
    lineIncludes: "entry.level ?? 1",
    reason:
      "REPORTED: candidate violation — pending round-3 audit. The only " +
      "trigger=\"term\" automaticSkills entry (MT Belter Zero-G Environ) " +
      "declares level:1 in JSON; the ?? 1 would silently invent a level for " +
      "a future entry that omits it. Strict form is requireRule(entry.level).",
  },
  {
    file: "lib/traveller/chargen/enlistment.ts",
    lineIncludes: 'options.service ?? "army"',
    reason:
      "Comment-documented API-surface defaults (see the block above the " +
      "pauseGuard in beginAcg): auto flows and tests that present no picker " +
      "get the first printed option; UI and RunLog always pass explicit values.",
  },
  {
    file: "lib/traveller/chargen/enlistment.ts",
    lineIncludes: 'options.lineType ?? "Free Trader"',
    reason:
      "Comment-documented API-surface default, same beginAcg block as " +
      "options.service: merchant line type for pickerless auto flows; UI and " +
      "RunLog always pass an explicit lineType.",
  },
];

// ---------------------------------------------------------------------------
// Scan + allowlist resolution
// ---------------------------------------------------------------------------

interface FileHit extends Hit {
  file: string;
}

const HITS: FileHit[] = SOURCES.flatMap((rel) =>
  scanSource(readFileSync(resolve(ROOT, rel), "utf8")).map((h) => ({ file: rel, ...h })),
);

const ALLOW_MATCHES: FileHit[][] = ALLOWLIST.map((entry) =>
  HITS.filter((h) => h.file === entry.file && h.text.includes(entry.lineIncludes)),
);
const ALLOWED = new Set<FileHit>(ALLOW_MATCHES.flat());
const VIOLATIONS = HITS.filter((h) => !ALLOWED.has(h));
const STALE = ALLOWLIST.filter((_, idx) => (ALLOW_MATCHES[idx] ?? []).length === 0);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rules-lock audit: no `?? literal` / `|| literal` game-value shadows", () => {
  it(
    "engine code has no non-allowlisted fallback shadows",
    { timeout: 1000 },
    () => {
      // Guard against a vacuous pass: if the scan found no files (dirs moved
      // or renamed), an empty violation list would be meaningless.
      expect(SOURCES.length).toBeGreaterThan(0);

      const hint =
        "Fallback shadow(s) of edition-JSON game values found. Replace each " +
        "`?? literal` / `|| literal` with a strict read " +
        "(requireRule, lib/traveller/editions/strict.ts) so missing JSON " +
        "fails loudly instead of silently using a code default:\n" +
        VIOLATIONS.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join("\n");
      expect(VIOLATIONS, hint).toEqual([]);
    },
  );

  it("allowlist has no stale entries", () => {
    const hint =
      "Allowlist entries that no longer match any scanner hit (the code " +
      "they excused was fixed or moved — prune them):\n" +
      STALE.map((e) => `  ${e.file} ~ "${e.lineIncludes}" (${e.reason})`).join("\n");
    expect(STALE, hint).toEqual([]);
  });

  it("every allowlist entry carries a non-empty reason", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim().length, `${entry.file} ~ "${entry.lineIncludes}"`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("rules-lock audit: scanner self-test", () => {
  const flag = (src: string): number[] => scanSource(src).map((h) => h.line);

  it("flags numeric fallbacks (the injected-probe contract)", () => {
    expect(flag("const x = cfg.foo ?? 5;")).toEqual([1]);
    expect(flag("const n = v || 12;")).toEqual([1]);
    expect(flag("x ??= 3;")).toEqual([1]);
    expect(flag("y ||= 7;")).toEqual([1]);
    // A wrapped fallback is attributed to the operator's line.
    expect(flag("const n =\n  cfg.foo ??\n  7;")).toEqual([2]);
  });

  it("flags uppercase-leading string fallbacks (labels and rank codes)", () => {
    expect(flag('const label = row.label ?? "Deck";')).toEqual([1]);
    expect(flag('const rank = r.code || "O1";')).toEqual([1]);
    expect(flag("const s = t ?? 'Line';")).toEqual([1]);
    expect(flag("const s = t ?? `IS-1`;")).toEqual([1]);
    expect(flag('const e = r ?? "E4";')).toEqual([1]);
  });

  it("stays silent on identity/empty fallbacks", () => {
    expect(flag("const dm = mods.dm ?? 0;")).toEqual([]);
    expect(flag('const s = t ?? "";')).toEqual([]);
    expect(flag("const xs = list ?? [];")).toEqual([]);
    expect(flag("const o = cfg ?? {};")).toEqual([]);
    expect(flag("const u = v ?? undefined;")).toEqual([]);
    expect(flag("const n = v ?? null;")).toEqual([]);
    expect(flag("x ??= 0;")).toEqual([]);
  });

  it("stays silent on non-literal and lowercase fallbacks", () => {
    expect(flag("const y = a || b;")).toEqual([]);
    expect(flag("const y = a ?? other.value;")).toEqual([]);
    expect(flag('const s = x ?? "deck";')).toEqual([]);
  });

  it("stays silent on comments and string bodies mentioning fallbacks", () => {
    expect(flag("// a comment about x ?? 5")).toEqual([]);
    expect(flag("/* block about x ?? 5 */ const y = 1;")).toEqual([]);
    expect(flag('const msg = "never use ?? 5 in engine code";')).toEqual([]);
    expect(flag("const msg = `never use ?? 5 or || 3`;")).toEqual([]);
  });

  it("catches fallbacks inside template interpolations", () => {
    expect(flag("const s = `rank ${r.rank ?? 5}`;")).toEqual([1]);
    expect(flag('const s = `label ${x ?? "Deck"}`;')).toEqual([1]);
    expect(flag("const s = `ok ${x ?? 0} fine`;")).toEqual([]);
  });
});
