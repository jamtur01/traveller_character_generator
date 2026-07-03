// Tests for the JSON-driven pathway phase loader (Option D).
//
// The loader compiles per-pathway resolveAssignment JSON into a
// PathwaySpec executable by runPhases. These tests verify:
//  - the loader errors loudly on a missing callback (data ↔ code drift
//    surfaces at edition load time, not at run time)
//  - each MT pathway's JSON config builds successfully against its
//    registered callback set
//  - the JSON config matches the canonical phase ordering documented
//    in the PM checklist

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";
import {
  buildPathwaySpecFromConfig, type PathwayCallbacks,
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

describe("buildPathwaySpecFromConfig drift detection", () => {
  it("throws on a missing onPass callback (typo in JSON)", () => {
    const config: ResolveAssignmentConfig = {
      phases: [
        {
          kind: "skills",
          consequence: "Earn a skill",
          onPass: "noSuchCallback",
        },
      ],
    };
    expect(() => buildPathwaySpecFromConfig(config, {}, {
      combatAssignments: () => [],
    })).toThrow(/Unknown pathway callback: noSuchCallback/);
  });

  it("throws on a missing finalize callback", () => {
    const config: ResolveAssignmentConfig = {
      phases: [],
      finalize: "notRegistered",
    };
    expect(() => buildPathwaySpecFromConfig(config, {}, {
      combatAssignments: () => [],
    })).toThrow(/Unknown finalize callback: notRegistered/);
  });

  it("throws on a missing preRun hook", () => {
    const config: ResolveAssignmentConfig = {
      phases: [],
      preRun: "notAHook" as "decorationDmTradeoff",
    };
    expect(() => buildPathwaySpecFromConfig(config, {}, {
      combatAssignments: () => [],
    })).toThrow(/Unknown preRun hook: notAHook/);
  });

  it("decorationDmTradeoff preRun is registered (used by mercenary/navy)", () => {
    const config: ResolveAssignmentConfig = {
      phases: [],
      preRun: "decorationDmTradeoff",
    };
    const spec = buildPathwaySpecFromConfig(config, {}, {
      combatAssignments: () => [],
    });
    expect(spec.phases).toEqual([]);
    expect(typeof spec.preRun).toBe("function");
  });

  it("builds a minimal survival-only spec", () => {
    const callbacks: PathwayCallbacks = {};
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
    const spec = buildPathwaySpecFromConfig(config, callbacks, {
      combatAssignments: () => [],
    });
    expect(spec.phases).toHaveLength(1);
    expect(spec.phases[0]!.phase).toBe("survival");
  });
});
