import { describe, expect, it } from "vitest";

import {
  getClosestStation,
  getClosestStationWithMargin,
  isClosestStationConfident,
} from "@/lib/stationUtils";

// Real SMART station coordinates (from the generated GTFS-derived data). The
// two Santa Rosa stations sit ~2.3 km apart along a line that runs NW→SE, which
// is exactly the pair a rider reported getting wrong.
const SANTA_ROSA_DOWNTOWN = { lat: 38.4376, lng: -122.7218 };
const SANTA_ROSA_NORTH = { lat: 38.4552, lng: -122.7365 };

describe("getClosestStationWithMargin", () => {
  it("picks the station you are standing at and reports a positive runner-up margin", () => {
    const result = getClosestStationWithMargin(
      SANTA_ROSA_DOWNTOWN.lat,
      SANTA_ROSA_DOWNTOWN.lng,
    );
    expect(result.station).toBe("Santa Rosa Downtown");
    expect(result.distanceKm).toBeLessThan(0.1);
    // Runner-up (North) is ~2.3 km further, so the margin is large.
    expect(result.marginKm).toBeGreaterThan(2);
  });

  it("does not mistake a downtown fix for the north station", () => {
    // Regression for the reported bug: standing next to Santa Rosa Downtown must
    // never resolve to Santa Rosa North.
    expect(
      getClosestStation(SANTA_ROSA_DOWNTOWN.lat, SANTA_ROSA_DOWNTOWN.lng),
    ).toBe("Santa Rosa Downtown");
    expect(
      getClosestStation(SANTA_ROSA_NORTH.lat, SANTA_ROSA_NORTH.lng),
    ).toBe("Santa Rosa North");
  });

  it("returns an Infinity distance and zero margin for non-finite coordinates", () => {
    const result = getClosestStationWithMargin(NaN, NaN);
    expect(result.distanceKm).toBe(Infinity);
    expect(result.marginKm).toBe(0);
  });
});

describe("isClosestStationConfident", () => {
  it("trusts a fix whose accuracy radius fits inside the runner-up margin", () => {
    // 50 m fix, 2.3 km margin → clearly confident.
    expect(isClosestStationConfident(2.3, 50)).toBe(true);
  });

  it("rejects a coarse fix that could straddle two stations", () => {
    // 800 m accuracy against a 500 m margin: the true position could sit nearer
    // the neighbor, so the pick is not trustworthy.
    expect(isClosestStationConfident(0.5, 800)).toBe(false);
  });

  it("treats an unknown accuracy as trustworthy so the guard never hard-blocks", () => {
    expect(isClosestStationConfident(0.1, null)).toBe(true);
  });

  it("accepts a fix exactly at the margin boundary", () => {
    // 750 m margin vs 750 m accuracy: equal → still confident.
    expect(isClosestStationConfident(0.75, 750)).toBe(true);
  });
});
