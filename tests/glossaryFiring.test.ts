// Firing / logging locks for the nine narrative-glossary commits
// (fa7c7d4..933a185). Each glossary is DISPLAY-only, so the contract it must
// keep is exactly: the cited verbose line fires at its emission point, with the
// cited text, the right number of times. These are the red-green locks — each
// was confirmed to redden when its glossary entry or hook is removed (see the
// yielded report) — so a dropped hook or drifted string can never ship green.
//
// Each test drives the real emission function (or the model init / muster path)
// with a deterministic setup and asserts the EXACT verbose line. Expected text
// is read from the shipped JSON so the assertion pins the cited wording without
// duplicating it. The skill lock additionally proves the once-at-first-learn /
// never-on-bump contract and the 05aab36 regression (Mongoose logs exactly once
// through the central Character.addSkill, no resurrected per-wrapper logger).

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { getEditionServices } from "@/lib/traveller/services";
import { classicModel } from "@/lib/traveller/chargen/models/classic";
import { mongooseModel } from "@/lib/traveller/chargen/models/mongoose";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { freshAcgState } from "@/lib/traveller/engine/acg/state";
import { logConnection } from "@/lib/traveller/engine/mongoose/connections";
import { promote, commission } from "@/lib/traveller/engine/mongoose/ranks";
import { applyReductions } from "@/lib/traveller/engine/mongoose/effects";
import { grantSkillFloor } from "@/lib/traveller/engine/mongoose/skills";
import { musterOut } from "@/lib/traveller/engine/mongoose/muster";
import {
  logDecorationMeaning, logSchoolMeaning, awardBrownie, runCourtMartial,
} from "@/lib/traveller/engine/acg/awards";
import { generateAndApplyHomeworld } from "@/lib/traveller/engine/homeworld";
import { applyCell } from "@/lib/traveller/engine/cellResolver";
import { commissionStep } from "@/lib/traveller/engine/steps/commission";
import type { Attributes } from "@/lib/traveller/types";
import type { AcgPathwayId } from "@/lib/traveller/engine/acg/state";

afterEach(() => {
  vi.restoreAllMocks();
});

const ATTRS: Attributes = {
  strength: 10, dexterity: 10, endurance: 10,
  intelligence: 10, education: 10, social: 10,
};

// One d6 face -> the Math.random value that produces it (roll = floor(x*6+1)).
const d6 = (v: number): number => (v - 1) / 6 + 0.001;

interface Json { [k: string]: unknown }
function load(id: string): Json {
  return JSON.parse(readFileSync(resolve(__dirname, `../data/editions/${id}.json`), "utf8")) as Json;
}
const CT = load("ct-classic");
const MT = load("mt-megatraveller");
const MG = (load("mongoose-2e").mongoose ?? {}) as Json;
const MT_COMMON = ((MT.advancedCharacterGeneration as Json).common ?? {}) as Json;
const MT_HOMEWORLD = (MT.homeworld ?? {}) as Json;

/** How many raw history events carry exactly this text. Verbose glossary lines
 *  are ev.raw(text, "verbose") -> {kind:"raw", text}; stored in ch.events
 *  regardless of showHistory (which filters only at render). */
function count(ch: Character, text: string): number {
  return ch.events.filter((e) => e.kind === "raw" && e.text === text).length;
}

function mkChar(editionId: string): Character {
  const c = new Character({ attributes: { ...ATTRS } });
  c.editionId = editionId;
  c.showHistory = "none";
  c.choiceMode = "auto";
  c.skills = [];
  return c;
}

function mkMongoose(): Character {
  const c = mkChar("mongoose-2e");
  c.mongooseState = freshMongooseState();
  return c;
}

function mkAcg(pathway: AcgPathwayId): Character {
  const c = mkChar("mt-megatraveller");
  c.acgState = freshAcgState(pathway);
  return c;
}

// ===========================================================================
// Skills — central Character.addSkill: log once at first learn, never on bump.
// ===========================================================================

describe("skill definitions log once at first acquisition, never on a level bump", () => {
  const cases = [
    { id: "ct-classic", defs: CT.skillDefinitions as Json },
    { id: "mt-megatraveller", defs: MT.skillDefinitions as Json },
    { id: "mongoose-2e", defs: MG.skillDefinitions as Json },
  ];
  for (const { id, defs } of cases) {
    it(`${id}: Admin logs its cited meaning exactly once, and never again on improve`, () => {
      const c = mkChar(id);
      if (id === "mongoose-2e") c.mongooseState = freshMongooseState();
      const line = `Admin: ${String(defs.Admin)}`;
      c.addSkill("Admin", 1, "table");
      expect(count(c, line), "def must log at first acquisition").toBe(1);
      c.addSkill("Admin", 1, "table"); // level bump 1 -> 2
      expect(count(c, line), "def must NOT re-log on a level bump").toBe(1);
      expect(c.skills.find(([n]) => n === "Admin")?.[1]).toBe(2);
    });
  }

  it("Mongoose grantSkillFloor routes through the central logger — exactly one def line (05aab36)", () => {
    // The centralization removed the per-wrapper Mongoose logger; grantSkillFloor
    // now logs solely via Character.addSkill. A resurrected wrapper logger would
    // double this to 2.
    const c = mkMongoose();
    const line = `Admin: ${String((MG.skillDefinitions as Json).Admin)}`;
    grantSkillFloor(c, "Admin", 1, "Rank 1");
    expect(count(c, line), "grantSkillFloor must log the def exactly once").toBe(1);
    grantSkillFloor(c, "Admin", 2, "Rank 2"); // raise -> improve, no def line
    expect(count(c, line), "raising must not re-log the def").toBe(1);
  });
});

// ===========================================================================
// Mongoose (Core rulebook) — connections, material/ship benefits, ageing,
// rank/commission, characteristics.
// ===========================================================================

describe("Mongoose glossary lines fire at their emission points (fa7c7d4, 61e7292)", () => {
  it("a formed connection narrates its cited meaning (Core pp.20-21)", () => {
    const c = mkMongoose();
    logConnection(c, "ally");
    expect(count(c, `Ally: ${String((MG.connections as Json).ally)}.`)).toBe(1);
  });

  it("a material benefit narrates its cited meaning at muster (Core pp.47-48)", () => {
    const c = mkMongoose();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    c.mongooseState!.termsInCareer = 1;
    c.mongooseState!.rank = 1;
    c.mongooseState!.cashRollsUsed = Number(MG.cashRollCap); // force the Material Benefits column
    vi.spyOn(Math, "random").mockReturnValue(d6(1)); // agent musterOut roll 1 -> Scientific Equipment
    musterOut(c);
    const gloss = String((MG.materialBenefits as Json)["Scientific Equipment"]);
    expect(count(c, `Benefit (Scientific Equipment): ${gloss}.`)).toBeGreaterThanOrEqual(1);
  });

  it("mustering out on a pension narrates the ship-share / pension glossary (Core p.49)", () => {
    const c = mkMongoose();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    c.mongooseState!.termsInCareer = 5; // 5+ terms -> pension
    c.mongooseState!.rank = 1;
    c.mongooseState!.cashRollsUsed = Number(MG.cashRollCap);
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    musterOut(c);
    const g = MG.benefitGlossary as Json;
    expect(count(c, `Pensions: ${String(g.pension)}.`)).toBe(1);
    expect(count(c, `Ship Shares: ${String(g.shipShares)}.`)).toBe(1);
    expect(count(c, `Ships With Benefits: ${String(g.shipsWithBenefits)}.`)).toBe(1);
  });

  it("an ageing crisis narrates its cited meaning (Core p.49)", () => {
    const c = mkMongoose();
    c.attributes.strength = 1;
    applyReductions(c, [{ count: 1, amount: 1, pool: ["strength"] }]);
    expect(count(c, `Ageing crisis: ${String(MG.agingCrisisGlossary)}.`)).toBe(1);
  });
});

// ===========================================================================
// MT (Players' Manual) — UWP codes, decoration, court-martial, brownie,
// school, muster benefit, characteristics.
// ===========================================================================

describe("MT glossary lines fire at their emission points (2480589, ab0ae1a, fb22216)", () => {
  it("the rolled UWP profile is translated with the cited code tables (PM p.13)", () => {
    const c = mkChar("mt-megatraveller");
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const hw = generateAndApplyHomeworld(c);
    expect(hw, "homeworld must roll").not.toBeNull();
    const code = hw!.starport;
    const desc = (MT_HOMEWORLD.starportTypes as Json)[code];
    expect(typeof desc, `starportTypes must define code ${code}`).toBe("string");
    expect(count(c, `Starport ${code}: ${String(desc)}`)).toBe(1);
  });

  it("a decoration narrates its cited meaning once per character (PM pp.46/49/57)", () => {
    const c = mkAcg("mercenary");
    const def = String((MT_COMMON.decorationDefinitions as Json).MCUF);
    logDecorationMeaning(c, "MCUF");
    expect(count(c, `MCUF: ${def}.`)).toBe(1);
    logDecorationMeaning(c, "MCUF"); // repeat award -> narratedDecorations dedup
    expect(count(c, `MCUF: ${def}.`)).toBe(1);
  });

  it("a school / special assignment narrates its cited meaning (PM pp.44-63)", () => {
    const c = mkAcg("mercenary");
    const schools = (MT_COMMON.schoolDefinitions as Json).mercenary as Json;
    const def = String(schools["Cross-Training"]);
    logSchoolMeaning(c, "mercenary", "Cross-Training");
    expect(count(c, `Cross-Training: ${def}.`)).toBe(1);
  });

  it("the first brownie-point award narrates the concept once (PM p.46)", () => {
    const c = mkAcg("mercenary");
    const note = String((MT_COMMON.browniePoints as Json).rule);
    awardBrownie(c, 1, "Finish each 4-year term");
    expect(count(c, note)).toBe(1);
    awardBrownie(c, 2, "Decoration MCUF"); // second award -> concept dedup
    expect(count(c, note)).toBe(1);
  });

  it("a court martial narrates the concept once per character (PM p.47)", () => {
    const c = mkAcg("mercenary");
    c.acgState!.isOfficer = true; // officer avoids on a 12, so no rank/jail mutation
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const concept = String((MT_COMMON.courtMartial as Json).concept);
    runCourtMartial(c);
    expect(count(c, `Court martial: ${concept}.`)).toBe(1);
    runCourtMartial(c); // second court martial -> courtMartialConceptNarrated dedup
    expect(count(c, `Court martial: ${concept}.`)).toBe(1);
  });

  it("a muster benefit narrates its cited meaning (PM p.19)", () => {
    const c = mkChar("mt-megatraveller");
    applyCell(c, "Instruments", "muster");
    const def = String((MT.musterBenefitDefinitions as Json).Instruments);
    expect(count(c, `Benefit (Instruments): ${def}.`)).toBe(1);
  });
});

// ===========================================================================
// CT (The Traveller Book + Citizens of the Imperium) — muster benefit,
// position/commission, characteristics.
// ===========================================================================

describe("CT glossary lines fire at their emission points (83da80e, 933a185)", () => {
  it("a muster benefit narrates its cited meaning (TTB pp.29-30 / CotI pp.13-15)", () => {
    const c = mkChar("ct-classic");
    applyCell(c, "Instruments", "muster");
    const def = String((CT.musterBenefitDefinitions as Json).Instruments);
    expect(count(c, `Benefit (Instruments): ${def}.`)).toBe(1);
  });
});

// ===========================================================================
// Negative lock — the characteristics-intro glossary (all editions) was removed
// as filler. No model's init may re-emit the intro header at generation start.
// Teeth: restore logCharacteristicsIntro to either model init and the matching
// header line reappears, reddening the row.
// ===========================================================================

describe("removed characteristics-intro glossary never re-fires at generation start", () => {
  const INTRO_HEADERS = ["Characteristics:", "Characteristics (Core p.9):"];
  const cases = [
    { id: "mongoose-2e", model: mongooseModel },
    { id: "ct-classic", model: classicModel },
    { id: "mt-megatraveller", model: classicModel },
  ];
  for (const { id, model } of cases) {
    it(`${id}: model init emits no characteristics-intro header`, () => {
      const c = id === "mongoose-2e" ? mkMongoose() : mkChar(id);
      model.init?.(c);
      for (const header of INTRO_HEADERS) {
        expect(count(c, header), `${id} init must not emit "${header}"`).toBe(0);
      }
    });
  }
});

// ===========================================================================
// Negative lock — the Rank/Commission (Mongoose) and Position/Commission (CT)
// advancement glossaries were removed as filler. Their emission points still
// run the rank/commission MECHANIC, but must emit no `Rank: `/`Commission: `/
// `Position: ` verbose glossary line. Teeth: restore any removed ev.raw block
// (and its JSON) and the matching prefix reappears.
// ===========================================================================

describe("removed advancement/position glossaries never re-fire at their emission points", () => {
  const rawWithPrefix = (c: Character, prefix: string): number =>
    c.events.filter((e) => e.kind === "raw" && e.text.startsWith(prefix)).length;

  it("Mongoose promotion to rank 1 runs the mechanic but emits no `Rank: ` line", () => {
    const c = mkMongoose();
    c.mongooseState!.career = "agent";
    c.mongooseState!.assignment = "lawEnforcement";
    c.mongooseState!.rank = 0;
    promote(c);
    expect(c.mongooseState!.rank, "rank mechanic intact").toBe(1);
    expect(rawWithPrefix(c, "Rank: "), "no Rank: glossary line").toBe(0);
  });

  it("Mongoose commission runs the mechanic but emits no `Commission: ` line", () => {
    const c = mkMongoose();
    c.mongooseState!.career = "army";
    c.mongooseState!.assignment = "support";
    commission(c);
    expect(c.mongooseState!.commissioned, "commission mechanic intact").toBe(true);
    expect(rawWithPrefix(c, "Commission: "), "no Commission: glossary line").toBe(0);
  });

  it("CT commission (Commission-label service) emits no `Commission: ` line", () => {
    const c = mkChar("ct-classic");
    c.service = "navy";
    c.rank = 0;
    c.terms = 1;
    c.commissioned = false;
    c.drafted = false;
    const edition = getEdition("ct-classic");
    const service = getEditionServices("ct-classic").navy!;
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    commissionStep({ ch: c, edition, service, config: {} });
    expect(c.commissioned, "commission mechanic intact").toBe(true);
    expect(rawWithPrefix(c, "Commission: "), "no Commission: glossary line").toBe(0);
  });

  it("CT commission (Position-label service) emits no `Position: ` line", () => {
    const c = mkChar("ct-classic");
    c.service = "pirates";
    c.rank = 0;
    c.terms = 1;
    c.commissioned = false;
    c.drafted = false;
    const edition = getEdition("ct-classic");
    const service = getEditionServices("ct-classic").pirates!;
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    commissionStep({ ch: c, edition, service, config: {} });
    expect(c.commissioned, "commission mechanic intact").toBe(true);
    expect(rawWithPrefix(c, "Position: "), "no Position: glossary line").toBe(0);
  });
});

// ===========================================================================
// Streetwise reword lock — the Streetwise skill definition was reworded to one
// agreed wording across all three editions. Each edition's skillDefinitions
// must carry EXACTLY that text, and its cited history line must render it
// verbatim at first learn. Teeth: drift the wording in any edition JSON and
// that row reddens on both the data value and the logged line.
// ===========================================================================

describe("Streetwise skill definition reads the agreed reworded text (all editions)", () => {
  const STREETWISE =
    "understanding urban society and power structures; knowing criminal contacts and underworld fixers";
  const cases = [
    { id: "ct-classic", defs: CT.skillDefinitions as Json },
    { id: "mt-megatraveller", defs: MT.skillDefinitions as Json },
    { id: "mongoose-2e", defs: MG.skillDefinitions as Json },
  ];
  for (const { id, defs } of cases) {
    it(`${id}: Streetwise glosses the reworded text and logs it verbatim at first learn`, () => {
      expect(defs.Streetwise, `${id} Streetwise data text`).toBe(STREETWISE);
      const c = mkChar(id);
      if (id === "mongoose-2e") c.mongooseState = freshMongooseState();
      c.addSkill("Streetwise", 1, "table");
      expect(count(c, `Streetwise: ${STREETWISE}`), `${id} logs reworded Streetwise once`).toBe(1);
    });
  }
});
