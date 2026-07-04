// Locks down every service's data + behavior with one snapshot per service.
// Any drift in a throw, DM threshold, rank label, cash cell, benefit roll, or
// skill-table cell will fail the snapshot and require an explicit update —
// reviewers will see the diff alongside the code change.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEditionServices, getEnlistableServices,
  type AttributeKey, type ServiceDef, type ServiceKey,
} from "../lib/traveller";
import { Character } from "../lib/traveller/character";

afterEach(() => {
  vi.restoreAllMocks();
});

// CT-only test — cast the Partial<Record> to a full Record so the
// per-key lookups don't need `!` everywhere. Edition isolation is
// asserted by getEnlistableServices below; an unexpectedly-missing CT
// service throws TypeError at first access.
const s = getEditionServices("ct-classic") as Record<ServiceKey, ServiceDef>;
const ALL: ServiceKey[] = [...getEnlistableServices("ct-classic"), "nobles"];
// 8 (not 7) so the character clears the advancedEducation8Plus Edu gate
// (advancedEducationEduMin = 8) when acquireSkillMatrix forces table 4; the
// snapshot's attrDelta is relative to BASE, so absolute value is inconsequential.
const BASE = 8;

/** Force every Math.random() call to produce d6 = `v`. */
function forceD6(v: number): void {
  vi.spyOn(Math, "random").mockReturnValue((v - 1) / 6 + 0.0001);
}

function freshCharacter(svc: ServiceKey): Character {
  const c = new Character();
  c.showHistory = "none";
  c.attributes = {
    strength: BASE, dexterity: BASE, endurance: BASE,
    intelligence: BASE, education: BASE, social: BASE,
  };
  c.skills = [];
  c.benefits = [];
  c.events = [];
  c.muster.musterLog = [];
  c.bladeBenefit = "";
  c.gunBenefit = "";
  c.mortgage = 0;
  c.ship = false;
  c.TAS = false;
  c.service = svc;
  return c;
}

function diffState(c: Character) {
  const attrDelta: Record<string, number> = {};
  for (const k of [
    "strength", "dexterity", "endurance",
    "intelligence", "education", "social",
  ] as AttributeKey[]) {
    const d = c.attributes[k] - BASE;
    if (d !== 0) attrDelta[k] = d;
  }
  return {
    benefits: [...c.benefits],
    skills: c.skills.map(([n, l]) => `${n}-${l}`),
    attrDelta,
    mortgage: c.mortgage || undefined,
    ship: c.ship || undefined,
    TAS: c.TAS || undefined,
  };
}

/** Sweep one attribute 0..15, others at 0, recording every nonzero DM. */
function dmSweep(svc: ServiceKey) {
  const out: Record<string, Record<number, number>> = {};
  for (const attr of [
    "strength", "dexterity", "endurance",
    "intelligence", "education", "social",
  ] as AttributeKey[]) {
    for (let v = 0; v <= 15; v++) {
      const a = {
        strength: 0, dexterity: 0, endurance: 0,
        intelligence: 0, education: 0, social: 0,
      };
      a[attr] = v;
      const dm = s[svc].enlistmentDM(a);
      if (dm !== 0) {
        out[attr] ??= {};
        out[attr][v] = dm;
      }
    }
  }
  return out;
}

function musterBenefitsTable(svc: ServiceKey) {
  const rows: Record<number, ReturnType<typeof diffState>> = {};
  for (let d = 1; d <= 7; d++) {
    const c = freshCharacter(svc);
    forceD6(d);
    s[svc].musterBenefits(c, 0);
    vi.restoreAllMocks();
    rows[d] = diffState(c);
  }
  return rows;
}

function acquireSkillMatrix(svc: ServiceKey) {
  const out: Record<string, ReturnType<typeof diffState>> = {};
  for (let table = 1; table <= 4; table++) {
    for (let d = 1; d <= 6; d++) {
      const c = freshCharacter(svc);
      c.muster.forceTable = true;
      c.muster.forceTableIndex = table;
      forceD6(d);
      s[svc].acquireSkill(c);
      vi.restoreAllMocks();
      out[`table${table}-d${d}`] = diffState(c);
    }
  }
  return out;
}

function automaticSkills(svc: ServiceKey): string[] {
  // Pin randomness so cascade-based service skills (e.g., Flyer aircraft) are
  // deterministic in the snapshot.
  forceD6(1);
  const skills = s[svc].getServiceSkills(freshCharacter(svc));
  vi.restoreAllMocks();
  return skills;
}

describe.each(ALL)("%s — service snapshot", (svc) => {
  it("data + behavior matches snapshot", () => {
    expect({
      static: {
        serviceName: s[svc].serviceName,
        memberName: s[svc].memberName,
        enlistmentThrow: s[svc].enlistmentThrow,
        survivalThrow: s[svc].survivalThrow,
        commissionThrow: s[svc].commissionThrow,
        promotionThrow: s[svc].promotionThrow,
        reenlistThrow: s[svc].reenlistThrow,
        inverseReenlist: s[svc].inverseReenlist ?? false,
        ranks: s[svc].ranks,
        musterCash: s[svc].musterCash,
      },
      automaticSkills: automaticSkills(svc),
      enlistmentDM: dmSweep(svc),
      musterBenefits: musterBenefitsTable(svc),
      acquireSkill: acquireSkillMatrix(svc),
    }).toMatchSnapshot();
  });
});
