// Architectural guard: game-rule thresholds on character state belong in the
// edition JSON (predicate DSL / edition data), NOT hardcoded in engine source.
//
// This session moved every such rule out of TypeScript and into JSON. This
// test locks that in: it scans the engine/chargen source and FAILS if anyone
// reintroduces a comparison of a character-state field to a rulebook literal
// (e.g. `ch.rank >= 6`, `education >= 8`, `terms > 7`).
//
// TEETH: re-adding `if (ch.rank >= 6) return;` to steps/promotion.ts puts
// `rank >= 6` back into the scanned source; the detector matches it and the
// first test fails, naming `lib/traveller/engine/steps/promotion.ts:<line>` so
// the developer knows exactly which rule to move into the edition JSON.
// Comments and string/template literals are blanked before matching, so a
// mention like `// rank >= 6` or `"rank >= 6"` cannot trip it — only live code
// does. The second test proves the detector fires on real code and stays
// silent on the dice/loop idioms (`r <= 6`, `r === 12`, `idx <= 2`) that use
// non-field variables or sub-threshold literals.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Genuine, reviewed exceptions go here as "relativePath:line" strings WITH a
// justification comment explaining why the literal legitimately lives in code.
// Keep this empty: a non-empty allowlist is a ratchet that must be defended in
// review. It exists so the guard can be relaxed explicitly, never silently.
const ALLOWLIST: string[] = [];

// Character-state field compared to a rulebook literal (>= 3, up to 12). Dice
// and loop code uses the roll/index variable `r` (or literals 0-2), which is
// deliberately absent from the field list, so it never matches. Non-global so
// `.test()` is stateless across lines.
const THRESHOLD =
  /\b(rank|terms|age|credits|social|education|intelligence|strength|dexterity|endurance|rankNum|enlistedNum)\b\s*(>=|<=|>|<|===|!==)\s*([3-9]|1[0-2])\b/;

const ROOT = resolve(__dirname, "../..");
const SCAN_DIRS = ["lib/traveller/engine", "lib/traveller/chargen"];
// Infra files that legitimately contain math/dice/formatting literals.
const INFRA_EXCLUDE: Record<string, true> = {
  "predicate.ts": true,
  "random.ts": true,
  "formatting.ts": true,
};

function collectSources(relDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectSources(rel));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !INFRA_EXCLUDE[entry.name]
    ) {
      out.push(rel);
    }
  }
  return out;
}

// Blank line comments, block comments, and string/template literals while
// preserving newlines (so line numbers stay aligned), so a threshold mentioned
// inside a comment or string can never trip the scanner — only executable code
// survives. A small char-level state machine avoids the ordering pitfalls of
// regex stripping (e.g. `//` inside a string, `*/` inside a string literal).
function stripNonCode(src: string): string {
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  let out = "";
  let i = 0;
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
      } else if (c === "'") {
        mode = "single";
        out += " ";
        i += 1;
      } else if (c === '"') {
        mode = "double";
        out += " ";
        i += 1;
      } else if (c === "`") {
        mode = "template";
        out += " ";
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
    // string / template literal body
    if (c === "\\") {
      out += " ";
      out += next === "\n" ? "\n" : " ";
      i += 2;
      continue;
    }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      mode = "code";
      out += " ";
      i += 1;
      continue;
    }
    out += c === "\n" ? "\n" : " ";
    i += 1;
  }
  return out;
}

interface Violation {
  key: string;
  display: string;
}

function scanFile(rel: string): Violation[] {
  const src = readFileSync(resolve(ROOT, rel), "utf8");
  const rawLines = src.split("\n");
  const found: Violation[] = [];
  stripNonCode(src)
    .split("\n")
    .forEach((codeLine, idx) => {
      if (!THRESHOLD.test(codeLine)) return;
      const key = `${rel}:${idx + 1}`;
      found.push({ key, display: `${key}: ${(rawLines[idx] ?? "").trim()}` });
    });
  return found;
}

const SCANNED = SCAN_DIRS.flatMap(collectSources);
const VIOLATIONS = SCANNED.flatMap(scanFile).filter((v) => !ALLOWLIST.includes(v.key));

describe("engine constants audit", () => {
  it("engine sources game-rule thresholds from JSON, not hardcoded literals", () => {
    // Guard against a vacuous pass: if the scan silently found no files (dirs
    // moved/renamed), an empty violation list would be meaningless.
    expect(SCANNED.length).toBeGreaterThan(0);

    const hint =
      "Hardcoded game-rule threshold(s) on character state found in engine " +
      "source. Move each comparison into the edition JSON (predicate DSL / " +
      "edition data) instead of testing a character field against a literal:\n" +
      VIOLATIONS.map((v) => `  ${v.display}`).join("\n");
    expect(VIOLATIONS, hint).toEqual([]);
  });

  it("detector flags real thresholds and ignores dice/loop idioms", () => {
    // Fires on live character-state rules.
    expect(THRESHOLD.test("if (ch.rank >= 6) return;")).toBe(true);
    expect(THRESHOLD.test("education >= 8")).toBe(true);
    // Silent on dice/loop code: `r` is not a character-state field, and 0-2 sit
    // below the rule-threshold floor.
    expect(THRESHOLD.test("for (let r = 0; r <= 6; r++)")).toBe(false);
    expect(THRESHOLD.test("if (r === 12)")).toBe(false);
    expect(THRESHOLD.test("idx <= 2")).toBe(false);
  });
});
