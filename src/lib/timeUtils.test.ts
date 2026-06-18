import { describe, expect, it } from "vitest";
import { computeMinutesUntil } from "./timeUtils";

// June 18 2026 is arbitrary — computeMinutesUntil only reads the time of day.
const at = (h: number, m: number, s = 0, ms = 0) =>
  new Date(2026, 5, 18, h, m, s, ms);

describe("computeMinutesUntil", () => {
  it("rounds the remaining time UP to whole minutes", () => {
    // 1m30s until 10:21 → 2 min remaining (don't under-promise)
    expect(computeMinutesUntil(at(10, 19, 30), "10:21")).toBe(2);
    // 15s remaining → still shows 1
    expect(computeMinutesUntil(at(10, 20, 45), "10:21")).toBe(1);
    // a hair under a minute out → rounds up, never down to 0 early
    expect(computeMinutesUntil(at(10, 19, 59), "10:21")).toBe(2);
  });

  it("hits exact boundaries cleanly", () => {
    expect(computeMinutesUntil(at(10, 20, 0), "10:21")).toBe(1); // exactly 1 min
    expect(computeMinutesUntil(at(10, 21, 0), "10:21")).toBe(0); // departing now
  });

  it("goes negative only once the minute has fully elapsed", () => {
    // Within the first minute past the target it stays 0 (mirrors the Live
    // Activity's "NOW"), flipping to -1 only at the next minute boundary.
    expect(computeMinutesUntil(at(10, 21, 30), "10:21")).toBe(0);
    expect(computeMinutesUntil(at(10, 22, 0), "10:21")).toBe(-1);
  });

  it("does not let seconds-of-now leak into the result", () => {
    // Whatever the seconds, the number reflects true time remaining, not a
    // difference of truncated clock minutes.
    expect(computeMinutesUntil(at(10, 0, 0), "10:05")).toBe(5);
    expect(computeMinutesUntil(at(10, 0, 1), "10:05")).toBe(5);
    expect(computeMinutesUntil(at(10, 0, 59), "10:05")).toBe(5);
    expect(computeMinutesUntil(at(10, 1, 0), "10:05")).toBe(4);
  });

  it("prefers the live time over the static time when provided", () => {
    expect(computeMinutesUntil(at(10, 20, 0), "10:21", "10:25")).toBe(5);
  });
});
