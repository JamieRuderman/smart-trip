import { describe, expect, it } from "vitest";
import { DOUBLE_TRACK_SEGMENTS } from "@/data/smartLineLayout";
import { doubleTrackOffset, keepLeftOnDoubleTrack } from "./doubleTrack";

describe("double-track train positioning", () => {
  const first = DOUBLE_TRACK_SEGMENTS[0];
  const middle = (first.northProgress + first.southProgress) / 2;

  it("only offsets trains inside a passing section", () => {
    expect(doubleTrackOffset(first.northProgress - 0.01)).toBe(0);
    expect(doubleTrackOffset(middle)).toBeGreaterThan(0);
  });

  it("eases back to the center at each switch", () => {
    expect(doubleTrackOffset(first.northProgress)).toBe(0);
    expect(doubleTrackOffset(first.southProgress)).toBe(0);
  });

  it("places trains on the left relative to their bearing", () => {
    const northbound = keepLeftOnDoubleTrack(
      { x: 10, y: 10, bearing: 0 },
      middle,
    );
    const southbound = keepLeftOnDoubleTrack(
      { x: 10, y: 10, bearing: 180 },
      middle,
    );
    expect(northbound.x).toBeLessThan(10);
    expect(southbound.x).toBeGreaterThan(10);
  });
});
