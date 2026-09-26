import { describe, it, expect } from "vitest";
import { MIN_DELAY_SECONDS, delayMinutesFromSeconds } from "./tripDelay";

describe("delayMinutesFromSeconds", () => {
  it("treats early / on-time / under-threshold slips as on-time (null)", () => {
    expect(delayMinutesFromSeconds(-120)).toBeNull();
    expect(delayMinutesFromSeconds(0)).toBeNull();
    expect(delayMinutesFromSeconds(30)).toBeNull();
    expect(delayMinutesFromSeconds(90)).toBeNull();
    expect(delayMinutesFromSeconds(MIN_DELAY_SECONDS - 1)).toBeNull();
  });

  it("reports rounded whole minutes once the threshold is reached", () => {
    expect(delayMinutesFromSeconds(MIN_DELAY_SECONDS)).toBe(
      Math.round(MIN_DELAY_SECONDS / 60),
    );
    expect(delayMinutesFromSeconds(125)).toBe(2);
    expect(delayMinutesFromSeconds(160)).toBe(3);
    expect(delayMinutesFromSeconds(5 * 60)).toBe(5);
  });
});
