// Self-check for the coverage-universe foundation (tests/_coverageUniverse.ts +
// tests/_coverageRecorder.ts). Two contracts:
//
//   1. The UNIVERSE is registry-derived, non-empty, and carries the expected
//      element KINDS per edition — with rough cardinalities (ranges/presence,
//      not brittle exact counts) — and its playerChoice/label metadata is real.
//      Cross-checks (svc == getEnlistableServices, cascade == cascadePoolByKey)
//      prove the enumeration is sourced from the registries, not a hardcoded
//      list: swap an accessor for a literal and these redden.
//
//   2. The RECORDER derives touched tags POST-HOC from finished characters
//      (seeded walkBasic / walkAcg / walkMongoose) and every tag it returns is
//      in the universe (touchedTags asserts the subset internally, so a walk
//      that produced an unenumerated tag throws). An aggregate over a fixed
//      walk spread asserts the recorder actually reaches every major namespace
//      with real tag CONTENTS (anti-theatre — not just sizes).

import { afterEach, describe, expect, it, vi } from "vitest";
import { coverageUniverse, type TagMeta } from "@/tests/_coverageUniverse";
import { touchedTags } from "@/tests/_coverageRecorder";
import { walkAcg, walkBasic, walkMongoose } from "@/tests/_walker";
import { getDraftServices, getEnlistableServices } from "@/lib/traveller/services";
import { getEdition } from "@/lib/traveller/editions";
import { cascadePoolByKey } from "@/lib/traveller/engine/cascadeMap";
import { Character } from "@/lib/traveller/character";
import { musterChoice } from "@/lib/traveller/chargen/session";
import { applyCell } from "@/lib/traveller/engine/cellResolver";

const universe = coverageUniverse();

/** Tags of a given namespace scoped to an edition (edition null = model-wide). */
function tagsOf(ns: string, edition: string | null): string[] {
  const out: string[] = [];
  for (const [tag, meta] of universe) {
    if (meta.ns === ns && meta.edition === edition) out.push(tag);
  }
  return out;
}

describe("coverageUniverse — registry-derived path-element enumeration", () => {
  it("is non-empty with plausible per-edition cardinality", () => {
    // Fail-loud already guarantees non-empty; the ranges catch a whole element
    // kind silently dropping out (they are wide on purpose — presence, not exact
    // counts). Current build: ct 376, mt 492, mongoose 275, model-wide 9 (the
    // ct/mt totals include the auto-enrolled Nobility service).
    expect(universe.size).toBeGreaterThan(800);
    const perEdition = new Map<string, number>();
    for (const meta of universe.values()) {
      const key = meta.edition ?? "(model)";
      perEdition.set(key, (perEdition.get(key) ?? 0) + 1);
    }
    expect(perEdition.get("ct-classic") ?? 0).toBeGreaterThanOrEqual(200);
    expect(perEdition.get("mt-megatraveller") ?? 0).toBeGreaterThanOrEqual(300);
    expect(perEdition.get("mongoose-2e") ?? 0).toBeGreaterThanOrEqual(150);
  });

  it("gives every edition its mandatory element kinds", () => {
    for (const ed of ["ct-classic", "mt-megatraveller"]) {
      expect(tagsOf("svc", ed).length).toBeGreaterThanOrEqual(1);
      expect(tagsOf("skilltable", ed).length).toBeGreaterThanOrEqual(4);
      expect(tagsOf("cascade", ed).length).toBeGreaterThanOrEqual(6);
      expect(tagsOf("muster.benefit", ed).length).toBeGreaterThanOrEqual(1);
      expect(tagsOf("muster.cash", ed).length).toBeGreaterThanOrEqual(1);
    }
    // Only MT declares ACG pre-career + pathways.
    expect(tagsOf("precareer", "mt-megatraveller").length).toBeGreaterThanOrEqual(1);
    expect(tagsOf("acg.pathway", "mt-megatraveller").length).toBeGreaterThanOrEqual(1);
    expect(tagsOf("acg.pathway", "ct-classic")).toHaveLength(0);
    // Only mongoose declares careers + their assignment/event/mishap rows.
    expect(tagsOf("mgt.career", "mongoose-2e").length).toBeGreaterThanOrEqual(10);
    expect(tagsOf("mgt.assignment", "mongoose-2e").length).toBeGreaterThanOrEqual(10);
    expect(tagsOf("mgt.event", "mongoose-2e").length).toBeGreaterThanOrEqual(10);
    expect(tagsOf("mgt.mishap", "mongoose-2e").length).toBeGreaterThanOrEqual(10);
    // Terminal outcomes are model-scoped (edition null).
    expect(tagsOf("outcome", null).length).toBeGreaterThanOrEqual(3);
  });

  it("sources svc tags from the registry (enlistable ∪ draft ∪ auto-enrolled)", () => {
    for (const ed of ["ct-classic", "mt-megatraveller"]) {
      const autoEnrolled = Object.entries(getEdition(ed).data.services)
        .filter(([, svc]) => svc?.checks.enlistment.automaticIf)
        .map(([key]) => key);
      const expected = new Set(
        [...getEnlistableServices(ed), ...getDraftServices(ed), ...autoEnrolled]
          .map((s) => `svc:${ed}:${s}`),
      );
      const actual = new Set(tagsOf("svc", ed));
      // Every registry-reachable service is enumerated and the universe adds
      // nothing beyond enlistable ∪ draft ∪ auto-enrolled — proving svc tags are
      // sourced from the accessors, not a hardcoded list.
      for (const tag of expected) expect(actual.has(tag)).toBe(true);
      expect(actual.size).toBe(expected.size);
      // nobles carries an enlistment automaticIf (Soc 10+, CotI/PM): auto-enrolled,
      // never in the enlistable pool, yet a real served career — so it IS enumerated.
      expect(actual.has(`svc:${ed}:nobles`)).toBe(true);
    }
  });

  it("sources cascade tags from cascadePoolByKey members", () => {
    // Blade Combat is a stable CT/MT cascade; every declared member is a tag.
    for (const ed of ["ct-classic", "mt-megatraveller"]) {
      for (const member of cascadePoolByKey("bladeCombat", ed)) {
        expect(universe.has(`cascade:${ed}:bladeCombat:${member}`)).toBe(true);
      }
    }
  });

  it("tags carry a label and correct playerChoice classification", () => {
    for (const meta of universe.values()) {
      expect(meta.label.length).toBeGreaterThan(0);
    }
    const meta = (tag: string): TagMeta => {
      const m = universe.get(tag);
      if (!m) throw new Error(`expected universe tag ${tag}`);
      return m;
    };
    // Player decisions are playerChoice; dice-selected rows are not.
    expect(meta("svc:ct-classic:scouts").playerChoice).toBe(true);
    expect(meta("acg.pathway:mt-megatraveller:scout").playerChoice).toBe(true);
    expect(meta("muster.benefit:ct-classic:navy:1").playerChoice).toBe(false);
    expect(meta("mgt.event:mongoose-2e:scout:2").playerChoice).toBe(false);
  });

  it("tags forced-only mongoose careers as non-player-choice", () => {
    // Prisoner (Core p.52) is reachable only via a forced-career reference.
    const prisoner = universe.get("mgt.career:mongoose-2e:prisoner");
    expect(prisoner).toBeDefined();
    expect(prisoner?.playerChoice).toBe(false);
    // A voluntary career is a player choice.
    expect(universe.get("mgt.career:mongoose-2e:scout")?.playerChoice).toBe(true);
  });
});

describe("touchedTags — post-hoc recorder", () => {
  afterEach(() => vi.restoreAllMocks());

  it("CT scouts character touches its service + a terminal outcome, ⊆ universe", () => {
    const ch = walkBasic({ edition: "ct-classic", service: "scouts", seed: 12345 }).character;
    const touched = touchedTags(ch); // throws if any tag escapes the universe
    expect(touched.size).toBeGreaterThan(0);
    expect(touched.has("svc:ct-classic:scouts")).toBe(true);
    expect(touched.has("edition:ct-classic")).toBe(true);
    expect(touched.has("model:ct-classic:classic")).toBe(true);
    expect([...touched].some((t) => t.startsWith("outcome:classic:"))).toBe(true);
    for (const tag of touched) expect(universe.has(tag)).toBe(true);
  });

  it("CT army (seeded) records the tables that granted a skill", () => {
    // Army seed 3 rolls Personal Development and Advanced Education cells that
    // resolve to plain skills (PD die 4/6 = Gambling/Brawling), so those tables'
    // skill grants are attributed back to (army, table) via skillLearned.source.
    const ch = walkBasic({ edition: "ct-classic", service: "army", seed: 3 }).character;
    const touched = touchedTags(ch);
    expect(ch.service).toBe("army");
    expect(touched.has("skilltable:ct-classic:army:personalDevelopment")).toBe(true);
    expect(touched.has("skilltable:ct-classic:army:advancedEducation")).toBe(true);
  });

  it("attribute-only skill-table roll records its skilltable tag", () => {
    // CT navy's Personal Development table is ENTIRELY attribute cells (+1 Stren,
    // +1 Dext, …) — it never grants a plain skill, so its skilltable tag is
    // derivable only from attributeChange.source (commit 0d5be16), never from a
    // skillLearned event. applyCell records the table on the attributeChange and
    // the recorder maps it back: the attribute-only path, red before 0d5be16 and
    // before the recorder's attributeChange branch.
    const c = new Character();
    c.editionId = "ct-classic";
    c.chargenModelId = "classic";
    c.service = "navy";
    const pdName = getEdition("ct-classic").data.skillTableMeta!.displayNames.personalDevelopment;
    applyCell(c, "+1 Stren", "skill", undefined, pdName);
    const touched = touchedTags(c);
    expect(touched.has("skilltable:ct-classic:navy:personalDevelopment")).toBe(true);
    for (const tag of touched) expect(universe.has(tag)).toBe(true);
  });

  it("CT cash muster records the cash row from the musterCash event", () => {
    // The walkers only ever take Benefit rolls; drive a Cash roll directly via
    // the session so the musterCash → muster.cash row derivation has teeth.
    const c = new Character();
    c.editionId = "ct-classic";
    c.chargenModelId = "classic";
    c.service = "navy";
    c.terms = 2;
    c.enterMustered();
    c.muster.musterRolls = 1;
    c.choiceMode = "auto";
    vi.spyOn(Math, "random").mockReturnValue(0.5); // d6 = 4 → cash row 4
    const snap = musterChoice({ character: c, phase: "muster" }, "cash");
    const touched = touchedTags(snap.character);
    expect([...touched].some((t) => t.startsWith("muster.cash:ct-classic:navy:"))).toBe(true);
    for (const tag of touched) expect(universe.has(tag)).toBe(true);
  });

  it("MT ACG pathways record pathway + role decisions, ⊆ universe", () => {
    const scout = touchedTags(walkAcg({ pathway: "scout", seed: 999 }).character);
    expect(scout.has("acg.pathway:mt-megatraveller:scout")).toBe(true);
    expect([...scout].some((t) => t.startsWith("acg.division:mt-megatraveller:"))).toBe(true);

    const navy = touchedTags(walkAcg({ pathway: "navy" }).character);
    expect(navy.has("acg.pathway:mt-megatraveller:navy")).toBe(true);
    expect([...navy].some((t) => t.startsWith("acg.fleet:mt-megatraveller:"))).toBe(true);

    const merc = touchedTags(walkAcg({ pathway: "mercenary", combatArm: "Infantry" }).character);
    expect(merc.has("acg.pathway:mt-megatraveller:mercenary")).toBe(true);
    expect(merc.has("acg.combatArm:mt-megatraveller:Infantry")).toBe(true);

    const trader = touchedTags(walkAcg({ pathway: "merchantPrince", lineType: "Free Trader" }).character);
    expect(trader.has("acg.pathway:mt-megatraveller:merchantPrince")).toBe(true);
    expect(trader.has("acg.lineType:mt-megatraveller:Free Trader")).toBe(true);
  });

  it("a mustered-out ACG character records outcome:acg:retired", () => {
    // ACG always ends a completed career via endChargenRetired (endGeneration
    // reason "retired"), even on a voluntary muster — never "mustered".
    const ch = walkAcg({ pathway: "scout", seed: 1 }).character;
    const touched = touchedTags(ch);
    expect(ch.chargenStatus.kind).toBe("mustered");
    expect(touched.has("outcome:acg:retired")).toBe(true);
  });

  it("MT ACG pre-career school is recorded from the preCareer event", () => {
    const ch = walkAcg({ pathway: "scout", preCareer: "college", seed: 7 }).character;
    const touched = touchedTags(ch);
    expect(touched.has("precareer:mt-megatraveller:college")).toBe(true);
  });

  it("mongoose walk records career + assignment + event + outcome, ⊆ universe", () => {
    const ch = walkMongoose({ career: "scout", seed: 0x5eed }).character;
    const touched = touchedTags(ch);
    expect(touched.has("mgt.career:mongoose-2e:scout")).toBe(true);
    expect([...touched].some((t) => t.startsWith("mgt.assignment:mongoose-2e:scout:"))).toBe(true);
    expect([...touched].some((t) => t.startsWith("mgt.event:mongoose-2e:scout:"))).toBe(true);
    // Mongoose signals completion via the endGeneration event (chargenStatus
    // stays "active"); the recorder reads it, so mustered is still captured.
    expect(touched.has("outcome:mongoose:mustered")).toBe(true);
    for (const tag of touched) expect(universe.has(tag)).toBe(true);
  });

  it("aggregate over a fixed walk spread reaches every major namespace", () => {
    const characters: Character[] = [
      walkBasic({ edition: "ct-classic", service: "navy", seed: 1 }).character,
      walkBasic({ edition: "ct-classic", service: "marines", seed: 1 }).character,
      walkBasic({ edition: "ct-classic", service: "scouts", seed: 2 }).character,
      walkBasic({ edition: "mt-megatraveller", service: "navy", seed: 1 }).character,
      walkBasic({ edition: "mt-megatraveller", service: "army", seed: 3 }).character,
      walkAcg({ pathway: "navy" }).character,
      walkAcg({ pathway: "scout", seed: 1 }).character,
      walkAcg({ pathway: "mercenary", combatArm: "Infantry" }).character,
      walkAcg({ pathway: "merchantPrince", lineType: "Free Trader" }).character,
      walkAcg({ pathway: "scout", preCareer: "college", seed: 7 }).character,
      walkMongoose({ career: "scout", seed: 0x5eed }).character,
      walkMongoose({ career: "agent", seed: 0x1234 }).character,
      walkMongoose({ career: "army", seed: 0xabcd }).character,
    ];
    const seenNs = new Set<string>();
    for (const ch of characters) {
      for (const tag of touchedTags(ch)) seenNs.add(tag.slice(0, tag.indexOf(":")));
    }
    // Every element kind the walker-driven spread can reach must actually be
    // reached; a broken derivation drops its namespace. (muster.cash is omitted
    // — the walkers only take Benefit rolls; its derivation is covered by the
    // dedicated cash-muster case above.)
    for (const ns of [
      "edition", "model", "outcome",
      "svc", "skilltable", "cascade", "muster.benefit",
      "precareer", "acg.pathway", "acg.fleet", "acg.division", "acg.lineType", "acg.combatArm",
      "mgt.career", "mgt.assignment", "mgt.event",
    ]) {
      expect(seenNs.has(ns)).toBe(true);
    }
  });
});
