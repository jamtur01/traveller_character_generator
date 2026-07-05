import { describe, it, expect } from "vitest";
import { event as ev, formatEvent } from "@/lib/traveller/history";

describe("Mongoose history event render", () => {
  it("renders career events and mishaps with their table roll", () => {
    expect(formatEvent(ev.mongooseEvent(7, "Life Event. Roll on the Life Events table.")))
      .toBe("Event (7): Life Event. Roll on the Life Events table.");
    expect(formatEvent(ev.mongooseMishap(4, "Injured. Roll on the Injury table.")))
      .toBe("Mishap (4): Injured. Roll on the Injury table.");
  });

  it("renders connections with the correct article and casing", () => {
    expect(formatEvent(ev.mongooseConnection("ally"))).toBe("Gained an Ally.");
    expect(formatEvent(ev.mongooseConnection("enemy"))).toBe("Gained an Enemy.");
    expect(formatEvent(ev.mongooseConnection("contact"))).toBe("Gained a Contact.");
    expect(formatEvent(ev.mongooseConnection("rival", "corporate broker")))
      .toBe("Gained a Rival (corporate broker).");
  });

  it("renders promotions, commissions, and title-less advancement", () => {
    expect(formatEvent(ev.mongooseRank(1, "Corporal", false)))
      .toBe("Promoted to Corporal (rank 1).");
    expect(formatEvent(ev.mongooseRank(1, "Lieutenant", true)))
      .toBe("Commissioned as Lieutenant (officer rank 1).");
    expect(formatEvent(ev.mongooseRank(2, null, false)))
      .toBe("Advanced to rank 2.");
  });

  it("emits WinAnsi-safe output (no characters above CP1252)", () => {
    const lines = [
      formatEvent(ev.mongooseEvent(2, "Disaster! Roll on the Mishap table -> not ejected.")),
      formatEvent(ev.mongooseConnection("rival")),
      formatEvent(ev.mongooseRank(6, "Commissioner", false)),
    ];
    for (const line of lines) {
      for (const ch of line) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0xff);
    }
  });
});
