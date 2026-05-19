// Automatic skills audit against TTB p. 25 + MT PM. The Rank and
// Service Skills table grants specific skills at the named rank or
// upon entering the service.

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";

interface AutoSkill {
  trigger: "service" | "rank" | "term";
  rank?: number;
  term?: number;
  skill?: string;
  level?: number;
  effect?: string;
}

function autos(editionId: string, service: string): AutoSkill[] {
  const svcs = getEdition(editionId).data.services as Record<string, { automaticSkills?: AutoSkill[] }>;
  return (svcs[service]?.automaticSkills ?? []) as AutoSkill[];
}

describe("CT Rank and Service Skills table (TTB p. 25)", () => {
  it("Marines start with Cutlass-1 (service)", () => {
    const a = autos("ct-classic", "marines");
    const cutlass = a.find((s) => s.trigger === "service" && s.skill === "Cutlass");
    expect(cutlass?.level).toBe(1);
  });

  it("Marines rank 1: Revolver-1", () => {
    const a = autos("ct-classic", "marines");
    const r = a.find((s) => s.trigger === "rank" && s.rank === 1);
    expect(r?.skill).toBe("Revolver");
    expect(r?.level).toBe(1);
  });

  it("Army starts with Rifle-1 (service)", () => {
    const a = autos("ct-classic", "army");
    const rifle = a.find((s) => s.trigger === "service" && s.skill === "Rifle");
    expect(rifle?.level).toBe(1);
  });

  it("Army rank 1: SMG-1", () => {
    const a = autos("ct-classic", "army");
    const r = a.find((s) => s.trigger === "rank" && s.rank === 1);
    expect(r?.skill).toBe("SMG");
    expect(r?.level).toBe(1);
  });

  it("Scouts start with Pilot-1 (service)", () => {
    const a = autos("ct-classic", "scouts");
    const pilot = a.find((s) => s.trigger === "service" && s.skill === "Pilot");
    expect(pilot?.level).toBe(1);
  });

  it("Navy has no service auto-skill (rank-driven only)", () => {
    const a = autos("ct-classic", "navy");
    // TTB p. 25: Navy gets Vacc Suit at rank 5+ — not on enlistment.
    const svc = a.find((s) => s.trigger === "service");
    expect(svc).toBeUndefined();
  });

  it("Merchants have no service auto-skill", () => {
    const a = autos("ct-classic", "merchants");
    const svc = a.find((s) => s.trigger === "service");
    expect(svc).toBeUndefined();
  });

  it("Other service has no auto-skills", () => {
    const a = autos("ct-classic", "other");
    expect(a).toEqual([]);
  });
});

describe("CT Rank-tied auto-skills (TTB p. 25)", () => {
  it("Navy rank 5 (Captain): +1 Social", () => {
    const a = autos("ct-classic", "navy");
    const r = a.find((s) => s.trigger === "rank" && s.rank === 5);
    expect(r?.effect).toBe("+1 Social");
  });

  it("Navy rank 6 (Admiral): +1 Social", () => {
    const a = autos("ct-classic", "navy");
    const r = a.find((s) => s.trigger === "rank" && s.rank === 6);
    expect(r?.effect).toBe("+1 Social");
  });

  it("Merchant rank 4 (First Officer): Pilot-1", () => {
    const a = autos("ct-classic", "merchants");
    const r = a.find((s) => s.trigger === "rank" && s.rank === 4);
    expect(r?.skill).toBe("Pilot");
    expect(r?.level).toBe(1);
  });
});
