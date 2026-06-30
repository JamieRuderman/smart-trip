import { describe, expect, it } from "vitest";
import { interpolateStationProgress } from "./trainMotion";

// A 4-station southbound corridor (indices 0..3) departing at 08:00, 08:10,
// 08:30, 08:40 (minutes-of-day). `order` ascends for southbound travel.
const ORDER = [0, 1, 2, 3];
const BASE = [480, 490, 510, 520]; // 08:00, 08:10, 08:30, 08:40

describe("interpolateStationProgress", () => {
  it("clamps to the origin before the first stop", () => {
    expect(interpolateStationProgress(BASE, ORDER, 470, 0)).toBe(0); // 07:50
  });

  it("clamps to the terminus after the last stop", () => {
    expect(interpolateStationProgress(BASE, ORDER, 600, 0)).toBe(3); // 10:00
  });

  it("interpolates the fractional index mid-segment", () => {
    // 08:20 is halfway between stop 1 (08:10) and stop 2 (08:30) → index 1.5.
    expect(interpolateStationProgress(BASE, ORDER, 500, 0)).toBeCloseTo(1.5);
    // 08:05 is halfway between stop 0 (08:00) and stop 1 (08:10) → index 0.5.
    expect(interpolateStationProgress(BASE, ORDER, 485, 0)).toBeCloseTo(0.5);
  });

  it("shifts the whole schedule by the delay offset", () => {
    // With +10 min delay, 08:20 is now at the un-delayed 08:10 position (1.0).
    expect(interpolateStationProgress(BASE, ORDER, 500, 10)).toBeCloseTo(1.0);
  });

  it("skips stations the trip does not serve (null base)", () => {
    // Station 1 not served: 08:20 brackets stop 0 (08:00) → stop 2 (08:30).
    const base = [480, null, 510, 520];
    // frac = (500-480)/(510-480) = 20/30; index 0 → 2 → 0 + 2*(2/3) = 1.333.
    expect(interpolateStationProgress(base, ORDER, 500, 0)).toBeCloseTo(1.3333, 3);
  });

  it("clamps to the upcoming stop on a zero-span segment (no divide-by-zero)", () => {
    const base = [480, 500, 500, 520]; // stops 1 and 2 share 08:20
    expect(interpolateStationProgress(base, ORDER, 500, 0)).toBe(2);
  });

  it("returns null when no station has a scheduled time", () => {
    expect(interpolateStationProgress([null, null, null, null], ORDER, 500, 0)).toBeNull();
  });

  it("walks northbound order (descending station indices)", () => {
    // Northbound: travel order is 3→0; times ascend along the travel order.
    const nbOrder = [3, 2, 1, 0];
    const nbBase = [520, 510, 490, 480]; // station 3 first (08:00) ... station 0 (08:40)
    // 08:20 brackets station 2 (08:10) → station 1 (08:30) → 2 + (1-2)*0.5 = 1.5
    expect(interpolateStationProgress(nbBase, nbOrder, 500, 0)).toBeCloseTo(1.5);
  });
});
