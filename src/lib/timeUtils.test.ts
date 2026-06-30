import { describe, expect, it } from "vitest";
import {
  computeMinutesUntil,
  formatClockTime,
  parseServiceDate,
  parseTimeToMinutes,
  serviceDateWeekdayLabel,
  toLocalDateKey,
} from "./timeUtils";

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

describe("parseTimeToMinutes", () => {
  it("parses HH:MM into minutes since midnight", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("08:45")).toBe(525);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });

  it("strips the * (estimated) and ~ (approximate) schedule markers", () => {
    expect(parseTimeToMinutes("08:45*")).toBe(525);
    expect(parseTimeToMinutes("~08:45")).toBe(525);
    expect(parseTimeToMinutes("8:4~5*")).toBe(525);
  });
});

describe("toLocalDateKey", () => {
  it("formats a Date as a zero-padded local YYYY-MM-DD", () => {
    expect(toLocalDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toLocalDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses the LOCAL calendar day, not UTC", () => {
    // 30 min past local midnight: a UTC-based key (toISOString) would roll back
    // to the previous day in any timezone west of UTC. The local key must not.
    const justAfterMidnight = new Date(2026, 5, 18, 0, 30);
    expect(toLocalDateKey(justAfterMidnight)).toBe("2026-06-18");
  });

  it("round-trips through parseServiceDate", () => {
    const key = "2026-06-18";
    expect(toLocalDateKey(parseServiceDate(key))).toBe(key);
  });
});

describe("serviceDateWeekdayLabel", () => {
  it("returns the localized weekday name for a service date", () => {
    // 2026-06-18 is a Thursday.
    expect(serviceDateWeekdayLabel("2026-06-18", "en-US")).toBe("Thursday");
  });
});

describe("formatClockTime", () => {
  // 2026-06-18 14:05 local.
  const epoch = new Date(2026, 5, 18, 14, 5).getTime();

  it("uses 12-hour format with AM/PM when timeFormat is 12h", () => {
    expect(formatClockTime(epoch, "12h", "en-US")).toBe("2:05 PM");
  });

  it("uses 24-hour format when timeFormat is 24h", () => {
    expect(formatClockTime(epoch, "24h", "en-US")).toBe("14:05");
  });
});
