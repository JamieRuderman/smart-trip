import { describe, expect, it } from "vitest";
import { isLegSkipped } from "./legSkip";

describe("isLegSkipped", () => {
  const status = { skippedStations: ["Santa Rosa Downtown"] };

  it("is true when the leg starts or ends at a station the run skips", () => {
    expect(isLegSkipped(status, "Santa Rosa Downtown", "Windsor")).toBe(true);
    expect(isLegSkipped(status, "Larkspur", "Santa Rosa Downtown")).toBe(true);
  });

  it("ignores skips between or beyond the leg's ends", () => {
    expect(isLegSkipped(status, "Larkspur", "Windsor")).toBe(false);
    expect(isLegSkipped({}, "Larkspur", "Windsor")).toBe(false);
    expect(isLegSkipped(null, "Larkspur", "Windsor")).toBe(false);
  });
});
