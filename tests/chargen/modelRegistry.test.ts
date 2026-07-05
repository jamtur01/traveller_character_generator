import { describe, it, expect } from "vitest";
import {
  registerModel,
  getChargenModel,
  listChargenModels,
} from "@/lib/traveller/chargen/modelRegistry";
import type { ChargenModel } from "@/lib/traveller/chargen/model";
import { Character } from "@/lib/traveller/character";

const fake: ChargenModel = {
  id: "fake-test-model",
  label: "Fake",
  entryPhase: () => "start",
  advance: (snap) => ({ snapshot: snap }),
  describePhase: () => ({ panel: "x", stepperLabel: "X" }),
};

describe("chargen model registry", () => {
  it("registers and resolves a model", () => {
    registerModel(fake);
    expect(getChargenModel("fake-test-model").id).toBe("fake-test-model");
    expect(listChargenModels()).toContain("fake-test-model");
  });

  it("throws with the available ids on an unknown id", () => {
    expect(() => getChargenModel("definitely-not-real")).toThrow(
      /unknown chargen model "definitely-not-real"/,
    );
  });

  it("Character defaults chargenModelId to classic", () => {
    expect(new Character().chargenModelId).toBe("classic");
  });
});
