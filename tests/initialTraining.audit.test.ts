// MT initial-training audit (PM pp. 50, 52, 58).
//
// Mercenary (PM p. 50): Gun Combat + 1 MOS roll.
// Navy (PM p. 52): 2 Branch Skills (enlisted) or 2 Branch/Officer Staff
//   Skills (academy/NOTC officers).
// Scout (PM p. 58): 1 Initial Training skill per office (Survey/Exploration/
//   Communications → Pilot; Detached Duty/Administration → Admin;
//   Technical → Computer; Operations → Leader).
// Merchant Prince (PM p. 60): "There is no initial training in the Merchants."

import { describe, expect, it } from "vitest";
import { getEdition } from "../lib/traveller/editions";

const acg = () =>
  getEdition("mt-megatraveller").data.advancedCharacterGeneration!;

describe("Mercenary initial training (PM p. 50)", () => {
  it("Two slots: Gun Combat + 1 MOS roll", () => {
    const merc = acg().mercenary as unknown as { initialTraining?: string[] };
    const slots = merc.initialTraining ?? [];
    expect(slots.length).toBe(2);
    expect(slots[0]).toBe("Gun Combat");
    expect(slots[1]).toMatch(/MOS|combat arm/i);
  });
});

describe("Navy initial training (PM p. 52)", () => {
  it("Enlisted: two Branch Skills rolls", () => {
    const navy = acg().navy as unknown as {
      initialTraining?: { enlisted?: string; officer?: string };
    };
    expect(navy.initialTraining?.enlisted ?? "").toMatch(
      /two|2.*Branch Skills/i);
  });

  it("Officer: two rolls on Branch Skills or Officer Staff Skills", () => {
    const navy = acg().navy as unknown as {
      initialTraining?: { officer?: string };
    };
    expect(navy.initialTraining?.officer ?? "").toMatch(
      /Branch Skills|Officer Staff Skills/i);
  });
});

describe("Scout initial training per office (PM p. 58)", () => {
  const scout = acg().scout as unknown as {
    initialTraining?: Record<string, string>;
  };
  const train = scout.initialTraining ?? {};

  it("Field offices (Survey/Exploration/Communications): Pilot", () => {
    expect(train.Survey).toBe("Pilot");
    expect(train.Exploration).toBe("Pilot");
    expect(train.Communications).toBe("Pilot");
  });

  it("Detached Duty + Administration: Admin", () => {
    expect(train["Detached Duty"]).toBe("Admin");
    expect(train.Administration).toBe("Admin");
  });

  it("Technical: Computer", () => {
    expect(train.Technical).toBe("Computer");
  });

  it("Operations: Leader", () => {
    expect(train.Operations).toBe("Leader");
  });
});

describe("Merchant Prince initial training (PM p. 60)", () => {
  it("No initial training declared in JSON (PM: 'There is no initial training in the Merchants.')", () => {
    const merch = acg().merchantPrince as unknown as { initialTraining?: unknown };
    // The JSON may omit the field entirely OR declare an empty value.
    // Either way, the engine treats it as no-op.
    const value = merch.initialTraining;
    if (value !== undefined) {
      const isEmpty = Array.isArray(value) ? value.length === 0
        : typeof value === "object" && value !== null
          ? Object.keys(value as object).length === 0 : true;
      expect(isEmpty).toBe(true);
    }
  });
});
