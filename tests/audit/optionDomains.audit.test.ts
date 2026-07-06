// Option-domain audit-lock — PILOT for "option-domain promotion".
//
// Re-architecture goal: every player decision domain in chargen becomes a
// first-class, $rule-cited enumerable JSON array, read through ONE accessor
//
//     optionDomain(editionId, decisionId) -> { field, values }
//
// where `decisionId` is a dotted key (e.g. "acg.navy.fleet"), `field` is the
// character property the choice writes into (e.g. "acgFleet"), and `values`
// is the declared, order-significant enumerable sourced from the edition JSON.
//
// THE LOCK PATTERN (copy this shape for the ~19 domains that follow):
//   A domain is only trustworthy if its DECLARED JSON list can never silently
//   drift from the AUTHORITATIVE CONSUMER KEYS the engine actually reads. So
//   each lock pins the declared `values` against every independent consumer of
//   that same set, each source read SEPARATELY (never re-derived from the
//   accessor under test):
//     1. exact `field` name — which character property this domain drives.
//     2. exact `values` in DECLARATION ORDER — the golden enumerable (UI order,
//        $rule ordering) as a literal, so a reorder or typo reddens the suite.
//     3. `values` set == an authoritative consumer's key set (order-insensitive)
//        — here `Object.keys(navy.rankCaps)`, read straight from the edition
//        JSON. Rename a fleet in one place but not the other -> RED.
//     4. every declared value is a present key in a second consumer — here the
//        `navy.enlistment` fleet entries. A declared fleet with no enlistment
//        row -> RED.
//   The two consumer sources (rankCaps, enlistment) are loaded from the raw
//   edition JSON, NOT from optionDomain(), so the two sides of the equality are
//   genuinely independent — that independence is what gives the lock its teeth.
//
// TEETH: mutate the declared list, the field name, a rankCaps key, or an
// enlistment fleet key in isolation and exactly one assertion here fails,
// naming the drift. Keep all four in sync and it stays green.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import { getEnlistableServices } from "@/lib/traveller/services";
import { listEditions } from "@/lib/traveller/editions";
import { Character } from "@/lib/traveller/character";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { availableTables } from "@/lib/traveller/engine/mongoose/skillsTraining";

// Consumer side: read the authoritative consumer keys/values straight from the
// edition JSON, using the house audit pattern (see
// editions.structural.audit.test.ts). This deliberately does NOT go through
// optionDomain() — each lock compares two independent sources.
const MT_PATH = resolve(__dirname, "../../data/editions/mt-megatraveller.json");
const mt = JSON.parse(readFileSync(MT_PATH, "utf8")) as {
  advancedCharacterGeneration: {
    mercenary: {
      reenlistment: Record<string, unknown>;
      combatArmEligibility: Record<string, unknown>;
    };
    navy: {
      enlistment: Record<string, unknown>;
      rankCaps: Record<string, number>;
    };
    scout: {
      skillTables: Record<string, unknown>;
      officeAssignment: { columns: readonly string[] };
    };
    merchantPrince: { enlistment: { rows: ReadonlyArray<{ typeOfLine: string }> } };
  };
  homeworld: { techCodeOrder: readonly string[] };
};
const acg = mt.advancedCharacterGeneration;
const navy = acg.navy;

describe("option-domain audit-locks", () => {
  it("navy.fleets declared list === enlistment fleet keys === rankCaps keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.navy.fleet");

    // (1) field — the character property this decision writes into.
    expect(domain.field).toBe("acgFleet");

    // (2) declared enumerable, in declaration order (golden literal).
    expect(domain.values).toEqual([
      "imperialNavy",
      "reserveFleet",
      "systemSquadron",
    ]);

    // (3) same SET as the rankCaps consumer keys (order-insensitive).
    const rankCapKeys = Object.keys(navy.rankCaps);
    expect([...domain.values].sort()).toEqual([...rankCapKeys].sort());

    // (4) every declared fleet is a present key in the enlistment consumer.
    for (const fleet of domain.values) {
      expect(
        Object.prototype.hasOwnProperty.call(navy.enlistment, fleet),
        `navy.enlistment is missing declared fleet "${fleet}"`,
      ).toBe(true);
    }
  });

  // acg.mercenary.service — the two mercenary services chosen at enlistment.
  // Independent consumers (both raw JSON, never via the accessor):
  //   - PM pp. 50-51 — advancedCharacterGeneration.mercenary.reenlistment holds
  //     one per-service target block keyed EXACTLY by {army, marines}. (Its
  //     sibling `enlistment` adds a "draft" key and `combatArmEligibility` adds
  //     "$rule"/"armGates", so reenlistment is the only clean 2-key set.)
  //   - PM p. 50 — mercenary.combatArmEligibility gates each service's combat
  //     arms; every declared service must be a present whitelist key there.
  it("acg.mercenary.service declared list === mercenary.reenlistment per-service keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.mercenary.service");

    expect(domain.field).toBe("acgService");
    expect(domain.values).toEqual(["army", "marines"]);

    const reenlistKeys = Object.keys(acg.mercenary.reenlistment);
    expect([...domain.values].sort()).toEqual([...reenlistKeys].sort());

    for (const service of domain.values) {
      expect(
        Object.prototype.hasOwnProperty.call(acg.mercenary.combatArmEligibility, service),
        `combatArmEligibility is missing declared service "${service}"`,
      ).toBe(true);
    }
  });

  // acg.navy.subsectorTech — the subsector tech ceiling offered at navy
  // enlistment. The leading "" is the "use the homeworld tech code as-is"
  // sentinel (PM p. 52, navy.enlistment.$ruleSubsectorTechMinimum: "the
  // subsector tech code is the homeworld tech code, at minimum Early Stellar");
  // it has NO tech-order entry, so the lock pins ONLY the non-empty subset.
  // Independent consumers (both raw JSON):
  //   - PM p. 52 — homeworld.techCodeOrder, the full tech-code ladder.
  //   - PM p. 52 — navy.enlistment.subsectorTechMinimum ("Early Stellar"), the
  //     floor at which the offered contiguous top-slice begins.
  it("acg.navy.subsectorTech non-empty subset === techCodeOrder top-slice", () => {
    const domain = optionDomain("mt-megatraveller", "acg.navy.subsectorTech");

    expect(domain.field).toBe("acgSubsectorTech");
    expect(domain.values).toEqual([
      "",
      "Early Stellar",
      "Avg Stellar",
      "High Stellar",
    ]);

    // "" is the homeworld-default sentinel, not a tech-order code; lock only
    // the non-empty options against the ladder read from raw JSON.
    const nonEmpty = domain.values.filter((v) => v !== "");
    const techOrder = mt.homeworld.techCodeOrder;

    for (const tech of nonEmpty) {
      expect(techOrder, `techCodeOrder is missing offered tech "${tech}"`).toContain(tech);
    }
    // ...and they are the CONTIGUOUS TOP slice, in tech-order order.
    expect(nonEmpty).toEqual(techOrder.slice(techOrder.length - nonEmpty.length));
    // the slice begins exactly at the navy enlistment floor (PM p. 52).
    const floor = navy.enlistment.subsectorTechMinimum as string;
    expect(techOrder.indexOf(floor)).toBe(techOrder.length - nonEmpty.length);
  });

  // acg.scout.division — the two scout divisions (Field vs Bureaucracy).
  // Independent consumers (both raw JSON):
  //   - PM pp. 58-59 — advancedCharacterGeneration.scout.skillTables holds one
  //     skill table per division, keyed EXACTLY by {field, bureaucracy}.
  //   - PM p. 56 — scout.officeAssignment.columns minus the "die" roll column
  //     resolves to the same two divisions.
  it("acg.scout.division declared list === scout.skillTables keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.scout.division");

    expect(domain.field).toBe("acgDivision");
    expect(domain.values).toEqual(["field", "bureaucracy"]);

    const skillTableKeys = Object.keys(acg.scout.skillTables);
    expect([...domain.values].sort()).toEqual([...skillTableKeys].sort());

    const officeDivisions = acg.scout.officeAssignment.columns.filter((c) => c !== "die");
    expect([...domain.values].sort()).toEqual([...officeDivisions].sort());
  });

  // acg.merchant.lineType — the six merchant line types joined at enlistment.
  // Independent consumer: PM p. 60 — advancedCharacterGeneration.merchantPrince
  // .enlistment.rows[].typeOfLine, one enlistment row per line type, declared in
  // the same order as the offered enumerable (raw JSON, never via the accessor).
  it("acg.merchant.lineType declared list === enlistment typeOfLine set", () => {
    const domain = optionDomain("mt-megatraveller", "acg.merchant.lineType");

    expect(domain.field).toBe("acgLineType");
    expect(domain.values).toEqual([
      "Megacorp",
      "Sector-wide",
      "Subsector-wide",
      "Interface",
      "Fledgling",
      "Free Trader",
    ]);

    const rowLineTypes = acg.merchantPrince.enlistment.rows.map((r) => r.typeOfLine);
    expect([...domain.values].sort()).toEqual([...rowLineTypes].sort());
  });

  // acg.pathway — the four ACG pathways the character enlists into.
  // Independent consumer: PM pp. 48-63 — Object.keys(advancedCharacterGeneration)
  // minus the non-pathway meta keys {common, source, coverage, homeworld,
  // pathways}, exactly mirroring listAcgPathways() in
  // lib/traveller/engine/acg.ts:39-42. Read straight from raw JSON.
  it("acg.pathway declared list === advancedCharacterGeneration pathway keys", () => {
    const domain = optionDomain("mt-megatraveller", "acg.pathway");

    expect(domain.field).toBe("acgPathway");
    expect(domain.values).toEqual(["mercenary", "navy", "scout", "merchantPrince"]);

    const NON_PATHWAY_KEYS: Record<string, true> = {
      common: true,
      source: true,
      coverage: true,
      homeworld: true,
      pathways: true,
    };
    const pathwayKeys = Object.keys(acg).filter((k) => !NON_PATHWAY_KEYS[k]);
    expect([...domain.values].sort()).toEqual([...pathwayKeys].sort());
  });
});

// ---------------------------------------------------------------------------
// classic.service — the CT (Classic Traveller) / MT (MegaTraveller, non-ACG)
// BASIC service-selection domain, and the biggest branch domain (CT registers
// 18 services). Unlike the MT-ACG domains above, its enumerable does not live
// in a pathway block: `serviceOrder` is a NEW top-level JSON array giving the
// presentation/enlistment order of ALL of an edition's services (CT: the
// service-selection table, TTB p. 18), and `optionDomain("classic.service")`
// returns the ENLISTABLE subset — serviceOrder minus every service whose
// checks.enlistment.automaticIf gate is set. In CT that drops the nobles:
// per Citizens of the Imperium a Soc 10+ character is auto-enrolled as a noble
// rather than voluntarily enlisting, so nobles never appear in the enlistment
// pool. The enlistable subset is therefore exactly getEnlistableServices(ed),
// today's authoritative runtime list (lib/traveller/services.ts).
//
// Parameterized over every ACTIVE edition carrying the "classic" chargen model,
// mirroring data.validation.test.ts's ACTIVE_EDITIONS filter, so a new classic
// edition is locked automatically.
//
// Independent sources (each read SEPARATELY, never re-derived from the accessor
// under test — that independence is the lock's teeth):
//   - `serviceOrder`, read raw from the edition JSON.
//   - Object.keys(services), read raw from the edition JSON.
//   - getEnlistableServices(ed), the current authoritative runtime enlistable
//     list computed in lib/traveller/services.ts.
//   - the automaticIf-gated service set, read raw from each service's
//     checks.enlistment.automaticIf.
//
// TEETH: rename/reorder a service key, add or drop a serviceOrder entry, flip a
// service's automaticIf gate, or change getEnlistableServices, and exactly one
// assertion below reddens, naming the drift.
const CLASSIC_EDITIONS = listEditions().filter(
  (e) => e.status === "active" && e.chargenModels.includes("classic"),
);
if (CLASSIC_EDITIONS.length === 0) {
  throw new Error(
    "No active classic editions registered — classic.service lock cannot run",
  );
}

describe("option-domain audit-locks — classic.service", () => {
  for (const meta of CLASSIC_EDITIONS) {
    const ed = meta.id;
    it(`${ed}: serviceOrder covers all services && optionDomain(classic.service)===getEnlistableServices`, () => {
      // Consumer side: the edition JSON, read raw (never via the accessor).
      const raw = JSON.parse(
        readFileSync(
          resolve(__dirname, `../../data/editions/${ed}.json`),
          "utf8",
        ),
      ) as {
        serviceOrder: readonly string[];
        services: Record<
          string,
          { checks: { enlistment: { automaticIf?: unknown } } }
        >;
      };

      const domain = optionDomain(ed, "classic.service");

      // (a) field — the character property this decision writes into.
      expect(domain.field).toBe("preferredService");

      // (b) declared serviceOrder SET === services key SET: the order lists
      // every service (none missing) and names no phantom (none extra).
      const serviceKeys = Object.keys(raw.services);
      expect([...raw.serviceOrder].sort()).toEqual([...serviceKeys].sort());

      // (c) enlistable subset, in order === the authoritative runtime list.
      expect(domain.values).toEqual(getEnlistableServices(ed));

      // (d) teeth: the services serviceOrder drops from the enlistable subset
      // are EXACTLY those carrying an enlistment automaticIf gate (CT nobles,
      // auto-enrolled per Citizens of the Imperium). serviceOrder and the
      // automaticIf set come from raw JSON; the enlistable list from the
      // runtime — three independent sources reconciled here.
      const enlistable = new Set<string>(getEnlistableServices(ed));
      const excluded = raw.serviceOrder.filter((k) => !enlistable.has(k));
      const automaticIf = serviceKeys.filter(
        (k) => raw.services[k]?.checks.enlistment.automaticIf != null,
      );
      expect([...excluded].sort()).toEqual([...automaticIf].sort());
    });
  }
});

// ---------------------------------------------------------------------------
// mongoose.career — the Mongoose-2e voluntary-career domain, and a BRANCH
// domain the Phase-2 harness enumerates (it drives each career). Unlike the
// enlist-form field domains above, this is an IN-FLOW pending choice: the
// engine raises it as a `pickOrDefer` of kind "mongooseCareer"
// (mongoose.ts:116-123, pickCareerNormally), NOT a field the enlist form
// writes. So this domain OMITS `field` and the lock asserts
// `.field === undefined`.
//
// The voluntary-career enumerable is DERIVED, not a second JSON array: it is
// the cited `careers` map minus every career flagged `forcedOnly`. MgT2 Core
// p.20 (careers/draft): a Traveller chooses a career to attempt each term; a
// career flagged force-only is never offered as a voluntary choice (the
// Prisoner career, Core p.52, forcedOnly — entered only when a mishap/event
// forces it). The engine derivation is
// Object.keys(data.careers).filter((id) => !careers[id].forcedOnly)
// (mongoose.ts:116-123, feeding the mongooseCareer pickOrDefer).
//
// Independent source (raw JSON, never via the accessor — that independence is
// the lock's teeth): the `mongoose.careers` map read straight from
// mongoose-2e.json, with each entry's forcedOnly flag.
describe("option-domain audit-locks — mongoose.career", () => {
  it("mongoose.career === careers minus forcedOnly, field omitted (in-flow)", () => {
    // Consumer side: the edition JSON, read raw (never via the accessor).
    const raw = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../data/editions/mongoose-2e.json"),
        "utf8",
      ),
    ) as {
      mongoose: { careers: Record<string, { forcedOnly?: boolean }> };
    };
    const careers = raw.mongoose.careers;

    const domain = optionDomain("mongoose-2e", "mongoose.career");

    // (a) field OMITTED — this is an in-flow pending choice (pickOrDefer kind
    //     "mongooseCareer"), not an enlist-form field.
    expect(domain.field).toBeUndefined();

    // (b) declared enumerable SET === the independent raw-JSON derivation:
    //     every career minus those flagged forcedOnly (order-insensitive).
    const voluntary = Object.keys(careers).filter((id) => !careers[id]?.forcedOnly);
    expect([...domain.values].sort()).toEqual([...voluntary].sort());

    // (c) teeth: the careers the domain drops are EXACTLY the forcedOnly set —
    //     two sources reconciled (accessor values vs raw forcedOnly flags).
    //     Prisoner (Core p.52) is force-only and excluded; a normal career
    //     like Navy is voluntary and included.
    const offered = new Set<string>(domain.values);
    const excluded = Object.keys(careers).filter((id) => !offered.has(id));
    const forcedOnly = Object.keys(careers).filter((id) => careers[id]?.forcedOnly);
    expect([...excluded].sort()).toEqual([...forcedOnly].sort());
    expect(offered.has("prisoner")).toBe(false);
    expect(offered.has("navy")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// acg.merchant.department — the Merchant Academy department pick (MT-ACG), an
// IN-FLOW pending choice: the engine raises it as a `pickOrDefer` of kind
// "merchantDepartment" (preCareer.ts:732-774, applyMerchantDepartmentSkills),
// NOT a field the enlist form writes. So this domain OMITS `field` and the
// lock asserts `.field === undefined`, like mongoose.career.
//
// The department enumerable is exactly what the Academy pick offers: the
// non-"die" columns of the merchant department SKILL table
// (preCareer.ts:738 — `dept.columns.filter((col) => col !== "die")`, feeding
// the merchantDepartment pickOrDefer options; the picked column key is stored
// as ch.acgState.department and later indexes the skill row). PM p. 47
// (Merchant Academy: "select the department to which he will be assigned") /
// PM p. 63 (the department skill table). Grounded set, in column-declaration
// order (mt-megatraveller.json merchantPrince.skillTables.department.columns):
//   deck, engineer, purser, medic, admin
// Free Trader is NOT among them — Free Traders are assigned to their own
// department and cannot change positions
// (merchantPrince.departmentAssignment.notes) — and "Sales" is not a
// department skill column. NOTE the JSON carries three DIFFERENT "department"
// shapes: the skill-table columns above (5); availablePositions.rows[].department
// = Deck/Engineering/Purser/Administration/Sales (5, title-cased); and
// departmentAssignment values = Purser/Sales/Engineering/Deck (4). The
// authoritative IN-FLOW consumer — the set the Academy pickOrDefer actually
// offers — is the skill-table columns, so the lock pins that (tightest
// defensible form).
//
// Independent consumer (raw JSON, never via the accessor — that independence
// is the lock's teeth): merchantPrince.skillTables.department.columns minus
// "die", read straight from mt-megatraveller.json.
describe("option-domain audit-locks — acg.merchant.department", () => {
  it("acg.merchant.department === skillTables.department columns minus die, field omitted (in-flow)", () => {
    // Consumer side: the edition JSON, read raw (never via the accessor).
    const raw = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../data/editions/mt-megatraveller.json"),
        "utf8",
      ),
    ) as {
      advancedCharacterGeneration: {
        merchantPrince: {
          skillTables: { department: { columns: readonly string[] } };
        };
      };
    };
    const columns =
      raw.advancedCharacterGeneration.merchantPrince.skillTables.department.columns;

    const domain = optionDomain("mt-megatraveller", "acg.merchant.department");

    // (a) field OMITTED — in-flow pickOrDefer kind "merchantDepartment".
    expect(domain.field).toBeUndefined();

    // (b) declared enumerable, in declaration (column) order (golden literal).
    expect(domain.values).toEqual([
      "deck",
      "engineer",
      "purser",
      "medic",
      "admin",
    ]);

    // (c) same SET as the department skill-table columns minus the "die" roll
    //     column (order-insensitive) — the Academy pick's actual option source.
    const deptColumns = columns.filter((c) => c !== "die");
    expect([...domain.values].sort()).toEqual([...deptColumns].sort());
  });
});

// ---------------------------------------------------------------------------
// acg.merchant.skillTable — the per-year merchant skill-table pick (MT-ACG),
// an IN-FLOW pending choice: the engine raises it as a `pickOrDefer` of kind
// "merchantSkillTable" (merchantPrince.ts:530-551, merchantRollSkill), NOT a
// field the enlist form writes. So this domain OMITS `field`.
//
// Each assignment year the merchant rolls a skill "from one of the skill table
// columns available" (PM p. 63); merchantRollSkill's table universe is
// `Object.keys(data.skillTables)` (filtered per-year to tables exposing an
// available column). The full declared universe is the skillTables keys, in
// declaration order (mt-megatraveller.json merchantPrince.skillTables):
//   service, department, life
//
// Independent consumer (raw JSON, never via the accessor — that independence
// is the lock's teeth): Object.keys(merchantPrince.skillTables), read straight
// from mt-megatraveller.json.
describe("option-domain audit-locks — acg.merchant.skillTable", () => {
  it("acg.merchant.skillTable === skillTables keys, field omitted (in-flow)", () => {
    // Consumer side: the edition JSON, read raw (never via the accessor).
    const raw = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../data/editions/mt-megatraveller.json"),
        "utf8",
      ),
    ) as {
      advancedCharacterGeneration: {
        merchantPrince: { skillTables: Record<string, unknown> };
      };
    };
    const skillTables = raw.advancedCharacterGeneration.merchantPrince.skillTables;

    const domain = optionDomain("mt-megatraveller", "acg.merchant.skillTable");

    // (a) field OMITTED — in-flow pickOrDefer kind "merchantSkillTable".
    expect(domain.field).toBeUndefined();

    // (b) declared enumerable, in declaration order (golden literal).
    expect(domain.values).toEqual(["service", "department", "life"]);

    // (c) same SET as the declared skillTables keys (order-insensitive).
    const tableKeys = Object.keys(skillTables);
    expect([...domain.values].sort()).toEqual([...tableKeys].sort());
  });
});

// ---------------------------------------------------------------------------
// mongoose.skillTable — the per-term Skills-and-Training table pick (Mongoose
// 2e, Core pp.18-19), an IN-FLOW pending choice: the engine raises it as a
// `pickOrDefer` of kind "mongooseSkillTable" (skillsTraining.ts:41-56,
// rollSkillTraining), NOT a field the enlist form writes. So this domain OMITS
// `field`.
//
// The training-table set is FIXED (edition-level, not per-career): Personal
// Development, Service Skills, the chosen Assignment specialist table, Advanced
// Education (gated by EDU) and, once commissioned, the Officer table —
// enumerated in availableTables (skillsTraining.ts:21-37). Grounded key set,
// in push order:
//   personalDevelopment, serviceSkills, assignment, advancedEducation, officer
//
// Independent consumer (the runtime enumerator run DIRECTLY, never via the
// accessor — that independence is the lock's teeth): availableTables() on a
// commissioned Army character (Army has both the Officer and Advanced Education
// tables) with EDU above the Advanced-Education minimum (Army min 8), which
// exposes all five tables. Rename/drop/add a table key in availableTables and
// this reddens.
describe("option-domain audit-locks — mongoose.skillTable", () => {
  it("mongoose.skillTable === availableTables keys, field omitted (in-flow)", () => {
    // Consumer side: run the engine's table enumerator directly. A commissioned
    // Army character with high EDU exposes every fixed training table.
    const c = new Character({
      attributes: {
        strength: 7,
        dexterity: 7,
        endurance: 7,
        intelligence: 7,
        education: 12,
        social: 7,
      },
    });
    c.editionId = "mongoose-2e";
    c.choiceMode = "auto";
    c.mongooseState = freshMongooseState();
    c.mongooseState.career = "army";
    c.mongooseState.assignment = "support";
    c.mongooseState.commissioned = true;
    const consumerKeys = availableTables(c).map((t) => t.key);

    const domain = optionDomain("mongoose-2e", "mongoose.skillTable");

    // (a) field OMITTED — in-flow pickOrDefer kind "mongooseSkillTable".
    expect(domain.field).toBeUndefined();

    // (b) declared enumerable, in declaration (push) order (golden literal).
    expect(domain.values).toEqual([
      "personalDevelopment",
      "serviceSkills",
      "assignment",
      "advancedEducation",
      "officer",
    ]);

    // (c) same SET as the runtime availableTables keys (order-insensitive).
    expect([...domain.values].sort()).toEqual([...consumerKeys].sort());
  });
});

// ---------------------------------------------------------------------------
// ct.weaponType — the generic "Weapon" mustering-out benefit's type pick
// (Classic Traveller, Citizens of the Imperium), an IN-FLOW pending choice:
// the engine raises it as a `pickOrDefer` of kind "weaponType"
// (weaponBenefits.ts:115-126, doWeaponBenefit), reached from the muster cell
// resolver when a benefit cell reads "Weapon" (cellResolver.ts:250-253). So
// this domain OMITS `field`. Grounded value set (the two-stage type -> specific
// cascade): ["Blade", "Gun"].
//
// Edition scope: ct-classic. ct-classic's benefit tables carry the "Weapon"
// cell (ct-classic.json benefitDetails {Weapon,Blade,Gun} + several service
// musterOut rows), and the `ct.` decisionId scopes this lock there. The
// ["Blade","Gun"] literal is hard-coded in doWeaponBenefit, NOT sourced from
// edition JSON, so the value set is edition-agnostic; mt-megatraveller also
// declares a "Weapon" benefit (benefitDetails) and [INFERENCE] routes it
// through the same shared cellResolver muster path, but the tightest defensible
// lock is the ct-classic `ct.weaponType` domain.
//
// Independent consumer (the runtime picker exercised DIRECTLY, never via the
// accessor — that independence is the lock's teeth): doWeaponBenefit() run in
// interactive mode queues a "weaponType" pending choice (unwinding via
// ChoicePendingError); its `options` are the engine's authoritative type list.
// Change the ["Blade","Gun"] literal or the choice kind and this reddens.
describe("option-domain audit-locks — ct.weaponType", () => {
  it("ct.weaponType === doWeaponBenefit picker options, field omitted (in-flow)", () => {
    // Consumer side: run the muster weapon-benefit picker directly. In
    // interactive mode pickOrDefer queues the choice and unwinds via
    // ChoicePendingError; the queued options are the engine's type list.
    const c = new Character({
      attributes: {
        strength: 7,
        dexterity: 7,
        endurance: 7,
        intelligence: 7,
        education: 7,
        social: 7,
      },
    });
    c.editionId = "ct-classic";
    c.choiceMode = "interactive";
    expect(() => c.doWeaponBenefit()).toThrow(ChoicePendingError);
    const picker = c.pendingChoices.find((p) => p.kind === "weaponType");
    const consumerOptions = picker?.options ?? [];

    const domain = optionDomain("ct-classic", "ct.weaponType");

    // (a) field OMITTED — in-flow pickOrDefer kind "weaponType".
    expect(domain.field).toBeUndefined();

    // (b) declared enumerable, in declaration order (golden literal).
    expect(domain.values).toEqual(["Blade", "Gun"]);

    // (c) same SET as the engine picker's options (order-insensitive).
    expect([...domain.values].sort()).toEqual([...consumerOptions].sort());
  });
});
