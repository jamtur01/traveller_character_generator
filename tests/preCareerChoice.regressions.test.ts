// Regression tests: interactive pre-career picks must survive re-execution.
//
// Review round 5 found the rewrite's ordering inversion left two prompts
// broken: onResolve runs inline (decision cursor), but the OTC and
// medical-school prompts still assigned their defaults AFTER pickOrDefer,
// clobbering the resolved pick on the re-run (pick Marines ->
// preCareerBranch "army"; pick Army -> acgPathway "navy"). The equivalence
// harness cannot catch this class — live and replay err identically (see
// its header) — so these tests resolve NON-default options and assert the
// pick's observable end state, cross-checked against the edition JSON.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as session from "../lib/traveller/chargen/session";

const MT = JSON.parse(readFileSync(
  resolve(__dirname, "../data/editions/mt-megatraveller.json"), "utf8",
)) as {
  advancedCharacterGeneration: {
    common: {
      preCareerOptions: {
        college: { otc: { autoEnlist: { pathway: string } } };
        medicalSchool: {
          directCommissionBranches: Array<{
            label: string; branch: string | null; pathway: string;
          }>;
        };
      };
    };
  };
};

const START = {
  edition: "mt-megatraveller",
  verbose: false,
  interactiveMode: true,
  supportsInteractive: true,
  useAcg: true,
  acgPathway: "mercenary",
};

/** Drive a seeded interactive run to the paused OTC branch prompt.
 *  Seeds 1/7/23 are known to reach it (probed); a drifted flow fails the
 *  toBeDefined assertion loudly rather than skipping. */
function otcPause(seed: number) {
  const snap0 = session.startCareer({ ...START, seed });
  expect(snap0.phase).toBe("pre_career");
  const r = session.applyPreCareer(snap0, "college");
  const otc = r.snapshot.character.pendingChoices.find(
    (p) => p.context?.source === "otcBranch",
  );
  expect(otc, `seed ${seed} must reach the OTC branch prompt`).toBeDefined();
  return { snap: r.snapshot, otc: otc! };
}

describe("interactive pre-career pick fidelity", () => {
  it("OTC: resolving Marines survives the re-run (not clobbered to the Army default)", () => {
    const { snap, otc } = otcPause(1);
    expect(otc.options).toEqual(["Army", "Marines"]);
    const marinesIdx = otc.options.indexOf("Marines");
    expect(marinesIdx).toBeGreaterThan(0); // non-default: default is options[0]

    const resolved = session.resolvePending(snap, otc.id, marinesIdx);
    const c = resolved.snapshot.character;
    expect(c.acgState?.preCareerBranch).toBe("marines");

    // Exactly one promotion, logged with the PICKED branch.
    const promotions = c.events.filter((e) => e.kind === "promoted");
    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toMatchObject({ rank: "O1", source: "OTC (Marines)" });

    // The stale run-last-model note must not survive into the final history.
    expect(JSON.stringify(c.events)).not.toContain("pending choice");
    expect(c.pendingChoices).toHaveLength(0);
  });

  it("OTC: the resolving call returns the enlistment-form hints", () => {
    const { snap, otc } = otcPause(7);
    const resolved = session.resolvePending(
      snap, otc.id, otc.options.indexOf("Marines"),
    );
    expect(resolved.snapshot.character.pendingChoices).toHaveLength(0);
    const otcPathway =
      MT.advancedCharacterGeneration.common.preCareerOptions.college
        .otc.autoEnlist.pathway;
    expect(resolved.hints).toEqual({
      acgPathway: otcPathway,
      acgService: "marines",
    });
  });

  it("medical school: resolving Army survives (not clobbered to the Navy fallback)", () => {
    // Seed 92 (probed): honors college graduate -> medical school ->
    // direct-commission branch prompt.
    const snap0 = session.startCareer({ ...START, seed: 92 });
    expect(snap0.phase).toBe("pre_career");
    const r1 = session.applyPreCareer(snap0, "college");
    expect(r1.snapshot.character.pendingChoices).toHaveLength(0);
    const r2 = session.applyPreCareer(r1.snapshot, "medicalSchool");
    const med = r2.snapshot.character.pendingChoices.find(
      (p) => p.context?.source === "medicalCommission",
    );
    expect(med, "seed 92 must reach the direct-commission prompt").toBeDefined();

    const branches =
      MT.advancedCharacterGeneration.common.preCareerOptions.medicalSchool
        .directCommissionBranches;
    const army = branches.find((b) => b.label === "Army");
    expect(army).toBeDefined();
    const armyIdx = med!.options.indexOf("Army");
    expect(armyIdx).toBeGreaterThan(0); // non-default: fallback is branches[0]

    const resolved = session.resolvePending(r2.snapshot, med!.id, armyIdx);
    const c = resolved.snapshot.character;
    // Assert against the JSON-declared entry, not literals.
    expect(c.acgPathway).toBe(army!.pathway);
    expect(c.acgState?.preCareerBranch).toBe(army!.branch);
    // Negative-assert the old bug: the pick must not fall back to branches[0].
    const fallback = branches[0]!;
    expect(fallback.pathway).not.toBe(army!.pathway); // premise: they differ
    expect(c.acgPathway).not.toBe(fallback.pathway);
    // Hints mirror the pick.
    expect(resolved.hints).toEqual({
      acgPathway: army!.pathway,
      acgService: army!.branch,
    });
  });
});

describe("paused-session dispatch guard", () => {
  it("new actions throw while a choice is pending; runTerm soft-returns identity", () => {
    const { snap } = otcPause(23);
    expect(snap.frontier).toBeDefined();

    expect(() => session.pickSkill(snap, 0))
      .toThrow(/while a choice is pending/);
    expect(() => session.musterChoice(snap, "cash"))
      .toThrow(/while a choice is pending/);
    expect(() => session.applyPreCareer(snap, "college"))
      .toThrow(/while a choice is pending/);
    expect(() => session.enlist(snap, {
      verbose: false,
      preferredService: "random",
      acgService: "army", acgCombatArm: "Infantry",
      acgFleet: "imperialNavy", acgDivision: "field",
      acgLineType: "Free Trader", acgSubsectorTech: "",
      acgMerchantAcademy: false,
    })).toThrow(/while a choice is pending/);

    // runTerm keeps the documented soft no-op contract.
    expect(session.runTerm(snap)).toBe(snap);
  });
});
