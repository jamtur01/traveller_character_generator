import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { rollEvent } from "@/lib/traveller/engine/mongoose/events";
import { getCareer } from "@/lib/traveller/engine/mongoose/core";

const d6 = (v: number) => (v - 1) / 6 + 0.001;
const ATTRS: Attributes = {
  strength: 7, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function agentChar(): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement";
  return c;
}

describe("rollEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the career event with its 2D roll and printed text", () => {
    const c = agentChar();
    const seq = [d6(2), d6(2)]; // 2D = 4
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    rollEvent(c);
    const expected = getCareer(c, "agent").events.find((e) => e.roll === 4)!.text;
    const logged = c.events.find((e) => e.kind === "mongooseEvent");
    expect(logged).toMatchObject({ roll: 4, text: expected });
  });

  it("an event roll of 7 chains into a Life Event (shared table)", () => {
    const c = agentChar();
    // Career event 2D = 7 (Life Event), then Life Event 2D = 7 (New Contact).
    const seq = [d6(3), d6(4), d6(3), d6(4)];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    rollEvent(c);
    expect(c.events.find((e) => e.kind === "mongooseEvent")).toMatchObject({ roll: 7 });
    expect(c.events.some((e) => e.kind === "raw" && /Life Event \(7\)/.test(e.text))).toBe(true);
    expect(c.mongooseState!.connections).toContainEqual(
      { relation: "contact", note: "New Contact: you gain a new Contact." },
    );
  });
});
