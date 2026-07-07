// Tests for the JSON-driven pathway phase loader (Option D).
//
// The loader compiles per-pathway resolveAssignment JSON into a
// PathwaySpec executable by runPhases. Side effects are declarative
// verbs; these tests verify:
//  - an unknown verb kind throws at edition load (JSON ↔ interpreter
//    drift surfaces at load time, not at run time)
//  - each MT pathway's JSON config builds successfully
//  - the JSON config matches the canonical phase ordering documented
//    in the PM checklist

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";
import {
  buildPathwaySpecFromConfig,
  type ResolveAssignmentConfig,
} from "../lib/traveller/engine/acg/jsonPhases";

function configFor(pathway: "mercenary" | "navy" | "scout" | "merchantPrince"): ResolveAssignmentConfig {
  const acg = getEdition("mt-megatraveller").data.advancedCharacterGeneration;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = (acg as any)?.[pathway];
  return block?.resolveAssignment as ResolveAssignmentConfig;
}

describe("MT pathway resolveAssignment configs exist", () => {
  it.each(["mercenary", "navy", "scout", "merchantPrince"] as const)(
    "%s has a resolveAssignment block",
    (pathway) => {
      const config = configFor(pathway);
      expect(config, `${pathway} JSON resolveAssignment`).toBeDefined();
      expect(config.phases.length).toBeGreaterThan(0);
    },
  );

  it("phase orderings match the PM checklists", () => {
    expect(configFor("mercenary").phases.map((p) => p.kind))
      .toEqual(["survival", "decoration", "promotion", "skills"]);
    expect(configFor("navy").phases.map((p) => p.kind))
      .toEqual(["survival", "decoration", "promotion", "skills"]);
    expect(configFor("scout").phases.map((p) => p.kind))
      .toEqual(["survival", "promotion", "skills"]);
    expect(configFor("merchantPrince").phases.map((p) => p.kind))
      .toEqual(["survival", "skills", "bonus"]);
  });
});

describe("buildPathwaySpecFromConfig verb-kind drift detection", () => {
  it("throws on an unknown onPass verb kind at load (JSON ↔ interpreter drift)", () => {
    const config = {
      phases: [
        { kind: "skills", consequence: "Earn a skill", onPass: { verb: "bogusVerb" } },
      ],
    } as unknown as ResolveAssignmentConfig;
    expect(() => buildPathwaySpecFromConfig(config, { combatAssignments: () => [] }))
      .toThrow(/Unknown skills\.onPass verb "bogusVerb"/);
  });

  it("throws on an unknown finalize verb kind at load", () => {
    const config = {
      phases: [],
      finalize: { verb: "bogusFinalize" },
    } as unknown as ResolveAssignmentConfig;
    expect(() => buildPathwaySpecFromConfig(config, { combatAssignments: () => [] }))
      .toThrow(/Unknown finalize verb "bogusFinalize"/);
  });

  it("dmTradeoffPrompt preRun verb builds a spec preRun (mercenary/navy)", () => {
    const config: ResolveAssignmentConfig = {
      phases: [],
      preRun: {
        verb: "dmTradeoffPrompt", boundsRule: "decorationDmTradeoff",
        rollA: "survival", rollB: "decoration",
      },
    };
    const spec = buildPathwaySpecFromConfig(config, { combatAssignments: () => [] });
    expect(spec.phases).toEqual([]);
    expect(typeof spec.preRun).toBe("function");
  });

  it("builds a minimal survival-only spec", () => {
    const config: ResolveAssignmentConfig = {
      phases: [
        {
          kind: "survival",
          consequence: "Mustered out",
          onMitigatedRevive: "Revived",
          endChargenOnFail: { kind: "retired", reason: "test" },
        },
      ],
    };
    const spec = buildPathwaySpecFromConfig(config, { combatAssignments: () => [] });
    expect(spec.phases).toHaveLength(1);
    expect(spec.phases[0]!.phase).toBe("survival");
  });
});
