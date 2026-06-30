import { describe, it, expect } from "vitest";
import { MIN_DELAY_SECONDS, delayMinutesFromSeconds } from "./tripDelay";

describe("delayMinutesFromSeconds", () => {
  it("treats early / on-time / sub-minute slips as on-time (null)", () => {
    expect(delayMinutesFromSeconds(-120)).toBeNull();
    expect(delayMinutesFromSeconds(0)).toBeNull();
    expect(delayMinutesFromSeconds(30)).toBeNull();
    expect(delayMinutesFromSeconds(MIN_DELAY_SECONDS - 1)).toBeNull();
  });

  it("reports rounded whole minutes once the threshold is reached", () => {
    expect(delayMinutesFromSeconds(MIN_DELAY_SECONDS)).toBe(1);
    expect(delayMinutesFromSeconds(89)).toBe(1);
    expect(delayMinutesFromSeconds(90)).toBe(2);
    expect(delayMinutesFromSeconds(5 * 60)).toBe(5);
  });
});
