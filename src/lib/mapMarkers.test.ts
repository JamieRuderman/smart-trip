// @vitest-environment node
import { describe, expect, it } from "vitest";
import { trainMarkerSignature } from "./mapMarkers";
import { DELAY_MINUTES_THRESHOLD } from "./realtimeConstants";
import type { MapTrain } from "@/hooks/useMapTrains";

const base = {
  key: "t1",
  latitude: 38.4,
  longitude: -122.7,
  bearing: 0,
  directionId: 0,
  tripNumber: 7,
  isCanceled: false,
  delayMinutes: 0,
} as unknown as MapTrain;

describe("trainMarkerSignature", () => {
  it("is unchanged when only position changes (no DOM rebuild needed)", () => {
    const a = trainMarkerSignature(base, false);
    const moved = { ...base, latitude: 38.5, longitude: -122.8 } as MapTrain;
    expect(trainMarkerSignature(moved, false)).toBe(a);
  });

  it("changes when the delayed state crosses the threshold", () => {
    const onTime = trainMarkerSignature({ ...base, delayMinutes: 0 } as MapTrain, false);
    const delayed = trainMarkerSignature(
      { ...base, delayMinutes: DELAY_MINUTES_THRESHOLD } as MapTrain,
      false,
    );
    expect(onTime).not.toBe(delayed);
    // A slip under the threshold must NOT flip the marker.
    const underThreshold = trainMarkerSignature(
      { ...base, delayMinutes: DELAY_MINUTES_THRESHOLD - 1 } as MapTrain,
      false,
    );
    expect(underThreshold).toBe(onTime);
  });

  it("changes on selection, cancellation, heading, and trip number", () => {
    const a = trainMarkerSignature(base, false);
    expect(trainMarkerSignature(base, true)).not.toBe(a);
    expect(trainMarkerSignature({ ...base, isCanceled: true } as MapTrain, false)).not.toBe(a);
    expect(trainMarkerSignature({ ...base, bearing: 90 } as MapTrain, false)).not.toBe(a);
    expect(trainMarkerSignature({ ...base, tripNumber: 9 } as MapTrain, false)).not.toBe(a);
  });
});
