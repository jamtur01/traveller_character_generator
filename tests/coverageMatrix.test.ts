// Self-check for the exhaustive-by-construction coverage matrix
// (tests/_coverageMatrix.ts). It validates the ENUMERATION only — it does not
// drive characters (that is the Phase-2 correctness-oracle driver's job). The
// contract under test: the matrix omits no active edition/model, no enlistable
// service, no ACG pathway (nor any of a pathway's sub-domain values), and no
// voluntary mongoose career. Because every check reads its golden set straight
// from the registries (getEnlistableServices / optionDomain / getAcgPathway),
// adding a service / fleet / line type / career to the edition JSON without the
// matrix picking it up reddens exactly the assertion that names the gap.

import { describe, expect, it } from "vitest";
import { coverageMatrix, type CoverageCombo } from "@/tests/_coverageMatrix";
import { listEditions, getAcgPathway } from "@/lib/traveller/editions";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import { getEnlistableServices } from "@/lib/traveller/services";

const matrix = coverageMatrix();
const activeEditions = listEditions().filter((m) => m.status === "active");

// Model-id + decisionId keys used to read golden sets. These mirror the
// registry ids and optionDomain API keys; the matrix file is what must stay
// literal-free, not this checker.
const CLASSIC = "classic";
const ACG = "acg";
const MONGOOSE = "mongoose";

/** Non-gated combat arms for a pathway, re-derived from getAcgPathway (the same
 *  registry source the matrix uses) so the check is independent of the matrix's
 *  private helper. */
function combatArmsFor(edition: string, pathway: string): readonly string[] {
  const data = getAcgPathway(edition, pathway) as
    | { combatArms?: readonly string[]; combatArmEligibility?: { armGates?: Record<string, unknown> } }
    | undefined;
  const gated = new Set(Object.keys(data?.combatArmEligibility?.armGates ?? {}));
  return (data?.combatArms ?? []).filter((arm) => !gated.has(arm));
}

const classicOf = (edition: string) =>
  matrix.filter(
    (c): c is Extract<CoverageCombo, { model: "classic" }> =>
      c.edition === edition && c.model === CLASSIC,
  );
const acgOf = (edition: string) =>
  matrix.filter(
    (c): c is Extract<CoverageCombo, { model: "acg" }> =>
      c.edition === edition && c.model === ACG,
  );
const mongooseOf = (edition: string) =>
  matrix.filter(
    (c): c is Extract<CoverageCombo, { model: "mongoose" }> =>
      c.edition === edition && c.model === MONGOOSE,
  );

describe("coverage matrix — enumeration", () => {
  it("is non-empty", () => {
    expect(matrix.length).toBeGreaterThan(0);
  });

  it("covers every active edition × declared chargen model with ≥1 combo", () => {
    for (const meta of activeEditions) {
      for (const model of meta.chargenModels) {
        const n = matrix.filter((c) => c.edition === meta.id && c.model === model).length;
        expect(n, `${meta.id}/${model}`).toBeGreaterThan(0);
      }
    }
  });

  it("enumerates only active editions and their declared models", () => {
    for (const combo of matrix) {
      const meta = activeEditions.find((m) => m.id === combo.edition);
      expect(meta, `combo edition "${combo.edition}" is active`).toBeDefined();
      expect(meta!.chargenModels, `${combo.edition} declares model "${combo.model}"`).toContain(
        combo.model,
      );
    }
  });
});

describe("coverage matrix — exhaustive per registry source", () => {
  it("covers every enlistable service for each classic edition", () => {
    for (const meta of activeEditions) {
      if (!meta.chargenModels.includes(CLASSIC)) continue;
      const covered = new Set(classicOf(meta.id).map((c) => c.service));
      const services = getEnlistableServices(meta.id);
      expect(services.length, `${meta.id} has enlistable services`).toBeGreaterThan(0);
      for (const svc of services) {
        expect(covered.has(svc), `${meta.id} classic service "${svc}" covered`).toBe(true);
      }
    }
  });

  it("covers every ACG pathway and every sub-domain value it crosses", () => {
    for (const meta of activeEditions) {
      if (!meta.chargenModels.includes(ACG)) continue;
      const combos = acgOf(meta.id);
      const pathways = optionDomain(meta.id, "acg.pathway").values;
      expect(pathways.length, `${meta.id} has ACG pathways`).toBeGreaterThan(0);

      for (const pathway of pathways) {
        const forPathway = combos.filter((c) => c.pathway === pathway);
        expect(forPathway.length, `${meta.id} pathway "${pathway}" covered`).toBeGreaterThan(0);
      }

      const pickValues = new Set(combos.flatMap((c) => Object.values(c.picks)));
      // optionDomain-backed sub-domains: every declared value must be crossed in.
      const subDomains: ReadonlyArray<readonly [string, string]> = [
        ["mercenary", "acg.mercenary.service"],
        ["navy", "acg.navy.fleet"],
        ["navy", "acg.navy.subsectorTech"],
        ["scout", "acg.scout.division"],
        ["merchant", "acg.merchant.lineType"],
      ];
      for (const [segment, decision] of subDomains) {
        const pathway = pathways.find((p) => p.startsWith(segment));
        if (pathway === undefined) continue;
        for (const value of optionDomain(meta.id, decision).values) {
          expect(pickValues.has(value), `${meta.id} ${decision} value "${value}" crossed`).toBe(
            true,
          );
        }
      }
      // Combat arm has no optionDomain (getAcgPathway source); every non-gated
      // arm must still be crossed into the mercenary combos.
      const mercPathway = pathways.find((p) => p.startsWith("mercenary"));
      if (mercPathway !== undefined) {
        const arms = combatArmsFor(meta.id, mercPathway);
        expect(arms.length, `${meta.id} mercenary has combat arms`).toBeGreaterThan(0);
        for (const arm of arms) {
          expect(pickValues.has(arm), `${meta.id} combat arm "${arm}" crossed`).toBe(true);
        }
      }
    }
  });

  it("covers every voluntary mongoose career", () => {
    for (const meta of activeEditions) {
      if (!meta.chargenModels.includes(MONGOOSE)) continue;
      const covered = new Set(mongooseOf(meta.id).map((c) => c.career));
      const careers = optionDomain(meta.id, "mongoose.career").values;
      expect(careers.length, `${meta.id} has voluntary careers`).toBeGreaterThan(0);
      for (const career of careers) {
        expect(covered.has(career), `${meta.id} mongoose career "${career}" covered`).toBe(true);
      }
    }
  });
});
