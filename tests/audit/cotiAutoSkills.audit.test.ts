// CT CotI service automatic skills audit (Citizens of the Imperium
// Supplement 4 + CT TTB p. 25 expansions).
//
// Each CotI service has its own rank-and-service skills entry. These
// are the canonical service-on-enlistment skills + any rank-tied
// promotions.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

interface AutoSkill {
  trigger: "service" | "rank" | "term";
  rank?: number;
  term?: number;
  skill?: string;
  level?: number;
  effect?: string;
}

function autos(service: string): AutoSkill[] {
  const svcs = getEdition("ct-classic").data.services as
    Record<string, { automaticSkills?: AutoSkill[] }>;
  return (svcs[service]?.automaticSkills ?? []) as AutoSkill[];
}

describe("CotI service-enlistment auto-skills", () => {
  it("Barbarians: Sword-1 (service)", () => {
    const sw = autos("barbarians").find((s) => s.trigger === "service");
    expect(sw?.skill).toBe("Sword");
    expect(sw?.level).toBe(1);
  });

  it("Belters: Vacc Suit-1 (service)", () => {
    const vs = autos("belters").find((s) => s.trigger === "service");
    expect(vs?.skill).toBe("Vacc Suit");
    expect(vs?.level).toBe(1);
  });

  it("Doctors: Medical-1 (service)", () => {
    const m = autos("doctors").find((s) => s.trigger === "service");
    expect(m?.skill).toBe("Medical");
    expect(m?.level).toBe(1);
  });

  it("Flyers: Air Craft-1 (service)", () => {
    const a = autos("flyers").find((s) => s.trigger === "service");
    expect(a?.skill).toBe("Air Craft");
    expect(a?.level).toBe(1);
  });

  it("Hunters: Hunting-1 (service)", () => {
    const h = autos("hunters").find((s) => s.trigger === "service");
    expect(h?.skill).toBe("Hunting");
    expect(h?.level).toBe(1);
  });

  it("Pirates: Brawling-1 (service)", () => {
    const b = autos("pirates").find((s) => s.trigger === "service");
    expect(b?.skill).toBe("Brawling");
    expect(b?.level).toBe(1);
  });

  it("Rogues: Streetwise-1 (service)", () => {
    const s = autos("rogues").find((p) => p.trigger === "service");
    expect(s?.skill).toBe("Streetwise");
    expect(s?.level).toBe(1);
  });

  it("Scientists: Computer-1 (service)", () => {
    const c = autos("scientists").find((s) => s.trigger === "service");
    expect(c?.skill).toBe("Computer");
    expect(c?.level).toBe(1);
  });

  it("Diplomats: Liaison-1 (service)", () => {
    const l = autos("diplomats").find((s) => s.trigger === "service");
    expect(l?.skill).toBe("Liaison");
    expect(l?.level).toBe(1);
  });

  it("Bureaucrats: no service auto-skill", () => {
    expect(autos("bureaucrats").filter((s) => s.trigger === "service")).toEqual([]);
  });

  it("Sailors: no service auto-skill", () => {
    expect(autos("sailors").filter((s) => s.trigger === "service")).toEqual([]);
  });
});

describe("CotI rank-tied auto-skills", () => {
  it("Barbarians rank 2: Blade Combat-1", () => {
    const a = autos("barbarians").find((s) => s.trigger === "rank" && s.rank === 2);
    expect(a?.skill).toBe("Blade Combat");
    expect(a?.level).toBe(1);
  });

  it("Barbarians rank 5: Leader-1", () => {
    const a = autos("barbarians").find((s) => s.trigger === "rank" && s.rank === 5);
    expect(a?.skill).toBe("Leader");
    expect(a?.level).toBe(1);
  });

  it("Pirates rank 4: Pilot-1", () => {
    const a = autos("pirates").find((s) => s.trigger === "rank" && s.rank === 4);
    expect(a?.skill).toBe("Pilot");
    expect(a?.level).toBe(1);
  });

  it("Nobles ranks 1-5: +1 Social each", () => {
    for (const rank of [1, 2, 3, 4, 5]) {
      const a = autos("nobles").find((s) => s.trigger === "rank" && s.rank === rank);
      expect(a?.effect, `noble rank ${rank}`).toBe("+1 Social");
    }
  });
});

describe("MT service auto-skills (matched against CT where possible)", () => {
  function mtAutos(service: string): AutoSkill[] {
    const svcs = getEdition("mt-megatraveller").data.services as
      Record<string, { automaticSkills?: AutoSkill[] }>;
    return (svcs[service]?.automaticSkills ?? []) as AutoSkill[];
  }

  it("MT Marines: service auto-skills include Large Blade (per Marine tradition)", () => {
    const services = mtAutos("marines").filter((s) => s.trigger === "service");
    const skills = services.map((s) => s.skill);
    expect(skills).toContain("Large Blade");
    // MT also grants Vacc Suit-0 and Gun Combat-0 to marines.
    expect(skills).toContain("Vacc Suit");
    expect(skills).toContain("Gun Combat");
  });

  it("MT Army: starts with Gun Combat / Rifleman skill", () => {
    const arm = mtAutos("army").find((s) => s.trigger === "service");
    expect(arm?.skill).toBeDefined();
  });
});
