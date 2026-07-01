import { describe, expect, it } from "vitest";
import {
  agencyClockHHMM,
  agencyWallTimeToEpochSeconds,
  computeMinutesUntil,
  formatClockTime,
  isTimeInPast,
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

describe("isTimeInPast", () => {
  // 2026-06-18 14:30 local (TZ pinned to America/Los_Angeles in setup).
  const now = new Date(2026, 5, 18, 14, 30);

  it("is true for an earlier time today and false for a later one", () => {
    expect(isTimeInPast(now, "14:29")).toBe(true);
    expect(isTimeInPast(now, "14:31")).toBe(false);
  });

  it("treats the exact current minute boundary as not-yet-past", () => {
    // tripTime is set to HH:MM:00; now carries 0 seconds here, so 14:30 == now
    // and the strict `<` comparison reports it as not past.
    expect(isTimeInPast(now, "14:30")).toBe(false);
  });

  it("strips the * / ~ schedule markers before comparing", () => {
    expect(isTimeInPast(now, "14:29*")).toBe(true);
    expect(isTimeInPast(now, "~14:31")).toBe(false);
  });

  it("compares within the same calendar day only (documents overnight limit)", () => {
    // KNOWN LIMITATION: isTimeInPast anchors HH:MM to *today*, with no rollover.
    // A 00:10 trip evaluated at 23:50 is reported as already past. This is inert
    // for SMART (no post-midnight service) but is a real edge for any caller
    // that must reason across midnight.
    const lateEvening = new Date(2026, 5, 18, 23, 50);
    expect(isTimeInPast(lateEvening, "00:10")).toBe(true);
  });
});

describe("agency timezone conversions (Pacific, device-TZ independent)", () => {
  // Anchored to explicit UTC instants so these assert the agency-zone logic
  // regardless of the machine's timezone.
  it("formats a summer (PDT, UTC-7) epoch in Pacific", () => {
    const utc = Date.UTC(2026, 6, 1, 19, 0) / 1000; // 19:00Z = 12:00 PDT
    expect(agencyClockHHMM(utc)).toBe("12:00");
  });

  it("formats a winter (PST, UTC-8) epoch in Pacific", () => {
    const utc = Date.UTC(2026, 0, 15, 16, 30) / 1000; // 16:30Z = 08:30 PST
    expect(agencyClockHHMM(utc)).toBe("08:30");
  });

  it("converts a Pacific wall time to the correct epoch (summer)", () => {
    expect(agencyWallTimeToEpochSeconds("20260701", "12:00")).toBe(
      Date.UTC(2026, 6, 1, 19, 0) / 1000,
    );
  });

  it("converts a Pacific wall time to the correct epoch (winter)", () => {
    expect(agencyWallTimeToEpochSeconds("20260115", "08:30")).toBe(
      Date.UTC(2026, 0, 15, 16, 30) / 1000,
    );
  });

  it("round-trips wall time → epoch → wall time", () => {
    const epoch = agencyWallTimeToEpochSeconds("20260620", "17:45");
    expect(agencyClockHHMM(epoch)).toBe("17:45");
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
