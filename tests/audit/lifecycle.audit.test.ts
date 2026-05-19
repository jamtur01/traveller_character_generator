// Per-edition lifecycle.terms step config audit.
//
// CT (TTB pp. 17-18): allocate skills, survival, commission, promotion.
//   No special-duty step, no "double skill if overshoot by 4+" rule.
//
// MT (PM p. 17): survival, commission (+ position), promotion, special
//   duty, allocate skills, automatic skills.
//   Rule (PM p. 17 line 1206): "If any throw (including DMs) for
//   commission/position, promotion, or special duty is at least 4 or
//   greater than the required throw, then two extra skills are received
//   instead of one." So commission/promotion/specialDuty config carries
//   doubleBonusOvershoot=4.

import { describe, expect, it } from "vitest";
import { getEdition } from "../../lib/traveller/editions";

interface LifecycleStep {
  id: string;
  config?: Record<string, unknown>;
}

describe("CT lifecycle.terms (TTB pp. 17-18)", () => {
  const terms = getEdition("ct-classic").data.lifecycle?.terms as LifecycleStep[];

  it("Four steps in canonical order: allocateSkills, survival, commission, promotion", () => {
    expect(terms.map((t) => t.id)).toEqual([
      "allocateSkills", "survival", "commission", "promotion",
    ]);
  });

  it("No specialDuty step (CT has no Special Duty mechanic)", () => {
    expect(terms.find((t) => t.id === "specialDuty")).toBeUndefined();
  });

  it("No autoSkillTerm step (CT auto-skills fire via rank/service triggers in-line)", () => {
    expect(terms.find((t) => t.id === "autoSkillTerm")).toBeUndefined();
  });

  it("CT commission/promotion have no doubleBonusOvershoot (PM p. 17 rule is MT-only)", () => {
    const comm = terms.find((t) => t.id === "commission");
    const prom = terms.find((t) => t.id === "promotion");
    expect(comm?.config?.doubleBonusOvershoot).toBeUndefined();
    expect(prom?.config?.doubleBonusOvershoot).toBeUndefined();
  });
});

describe("MT lifecycle.terms (PM p. 17)", () => {
  const terms = getEdition("mt-megatraveller").data.lifecycle?.terms as LifecycleStep[];

  it("Six steps in canonical order", () => {
    expect(terms.map((t) => t.id)).toEqual([
      "survival", "commission", "promotion", "specialDuty",
      "allocateSkills", "autoSkillTerm",
    ]);
  });

  it("commission carries doubleBonusOvershoot=4 (PM p. 17 line 1206)", () => {
    const c = terms.find((t) => t.id === "commission");
    expect(c?.config?.doubleBonusOvershoot).toBe(4);
  });

  it("promotion carries doubleBonusOvershoot=4", () => {
    const p = terms.find((t) => t.id === "promotion");
    expect(p?.config?.doubleBonusOvershoot).toBe(4);
  });

  it("specialDuty carries doubleBonusOvershoot=4", () => {
    const s = terms.find((t) => t.id === "specialDuty");
    expect(s?.config?.doubleBonusOvershoot).toBe(4);
  });

  it("allocateSkills carries term1Bonus=true (PM p. 17: 2 skills for first term)", () => {
    const a = terms.find((t) => t.id === "allocateSkills");
    expect(a?.config?.term1Bonus).toBe(true);
  });

  it("autoSkillTerm has no config (its trigger is rank/service from JSON)", () => {
    const a = terms.find((t) => t.id === "autoSkillTerm");
    expect(a?.config).toBeUndefined();
  });
});
