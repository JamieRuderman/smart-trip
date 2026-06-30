import { describe, expect, it } from "vitest";
import { DELAY_MINUTES_THRESHOLD, isTrainDelayed } from "./realtimeConstants";

describe("isTrainDelayed", () => {
  it("is true only at or above the color threshold", () => {
    expect(
      isTrainDelayed({ isCanceled: false, delayMinutes: DELAY_MINUTES_THRESHOLD }),
    ).toBe(true);
    expect(
      isTrainDelayed({
        isCanceled: false,
        delayMinutes: DELAY_MINUTES_THRESHOLD - 1,
      }),
    ).toBe(false);
    expect(
      isTrainDelayed({
        isCanceled: false,
        delayMinutes: DELAY_MINUTES_THRESHOLD + 10,
      }),
    ).toBe(true);
  });

  it("treats a null delay (no realtime) as not delayed", () => {
    expect(isTrainDelayed({ isCanceled: false, delayMinutes: null })).toBe(false);
  });

  it("never reports a canceled train as delayed, even when very late", () => {
    expect(
      isTrainDelayed({ isCanceled: true, delayMinutes: 99 }),
    ).toBe(false);
  });
});
