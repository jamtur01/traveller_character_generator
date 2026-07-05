import { describe, it, expect } from "vitest";
import { getEdition } from "@/lib/traveller/editions";

describe("edition chargen models", () => {
  it("CT offers only the classic model", () => {
    expect(getEdition("ct-classic").meta.chargenModels).toEqual(["classic"]);
  });

  it("MT offers classic and acg", () => {
    expect(getEdition("mt-megatraveller").meta.chargenModels).toEqual([
      "classic",
      "acg",
    ]);
  });
});
