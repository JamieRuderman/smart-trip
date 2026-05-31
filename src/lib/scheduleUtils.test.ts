import { afterEach, describe, expect, it, vi } from "vitest";

import { getTodayScheduleType, setScheduleData } from "@/lib/scheduleUtils";
import {
  bundledSchedulePayload,
  isSchedulePayload,
  type SchedulePayload,
} from "@/data/scheduleData";

describe("getTodayScheduleType", () => {
  afterEach(() => {
    // Reset to the bundled payload so other tests aren't affected.
    setScheduleData(bundledSchedulePayload);
  });

  it("returns 'weekday' for a regular Wednesday", () => {
    const wed = new Date(2026, 4, 20); // 2026-05-20
    expect(getTodayScheduleType(wed)).toBe("weekday");
  });

  it("returns 'weekend' for a regular Saturday", () => {
    const sat = new Date(2026, 4, 23); // 2026-05-23
    expect(getTodayScheduleType(sat)).toBe("weekend");
  });

  it("applies a holiday override that maps a weekday Monday to weekend", () => {
    // Use a synthetic far-future date so the test doesn't depend on whether
    // any specific holiday is still inside the build-time minDate floor.
    setScheduleData({
      ...bundledSchedulePayload,
      scheduleOverrides: { "2099-05-25": "weekend" },
    });
    expect(getTodayScheduleType(new Date(2099, 4, 25))).toBe("weekend"); // Mon
  });

  it("uses overrides from a refreshed schedule payload", () => {
    const payload: SchedulePayload = {
      ...bundledSchedulePayload,
      scheduleOverrides: { "2099-07-04": "weekday" },
    };
    setScheduleData(payload);
    // Sat 2099-07-04 — refreshed payload tells us it's a weekday schedule.
    expect(getTodayScheduleType(new Date(2099, 6, 4))).toBe("weekday");
    // Untouched dates still follow day-of-week.
    expect(getTodayScheduleType(new Date(2099, 6, 5))).toBe("weekend");
  });

  it("clears stale overrides when a refreshed payload omits the field", () => {
    // First load a payload that defines a synthetic override.
    setScheduleData({
      ...bundledSchedulePayload,
      scheduleOverrides: { "2099-08-10": "weekend" },
    });
    expect(getTodayScheduleType(new Date(2099, 7, 10))).toBe("weekend"); // Mon

    // Then load a payload without the field (e.g. older cached JSON).
    // We must drop the stale "2099-08-10" override and revert to the
    // bundled build-time map.
    const payloadWithoutOverrides: SchedulePayload = {
      trainSchedules: bundledSchedulePayload.trainSchedules,
      ferrySchedules: bundledSchedulePayload.ferrySchedules,
    };
    setScheduleData(payloadWithoutOverrides);
    expect(getTodayScheduleType(new Date(2099, 7, 10))).toBe("weekday");
  });

  it("defaults to new Date() when no argument is passed", () => {
    // Just confirm it returns one of the valid values without throwing.
    expect(["weekday", "weekend"]).toContain(getTodayScheduleType());
  });

  it("uses local-time date keys, not UTC", () => {
    setScheduleData({
      ...bundledSchedulePayload,
      scheduleOverrides: { "2099-05-25": "weekend" },
    });
    // 2099-05-25 23:30 local time should match the override even when UTC
    // has already rolled to 2099-05-26.
    const lateMonday = new Date(2099, 4, 25, 23, 30);
    expect(getTodayScheduleType(lateMonday)).toBe("weekend");
  });

  it("ignores a vitest fake clock by reading the provided Date directly", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 4, 23)); // a Saturday
      const explicitWed = new Date(2026, 4, 20);
      expect(getTodayScheduleType(explicitWed)).toBe("weekday");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isSchedulePayload override validation", () => {
  function basePayload(): Record<string, unknown> {
    return {
      trainSchedules: bundledSchedulePayload.trainSchedules,
      ferrySchedules: bundledSchedulePayload.ferrySchedules,
    };
  }

  it("accepts a payload with no scheduleOverrides field", () => {
    expect(isSchedulePayload(basePayload())).toBe(true);
  });

  it("accepts a payload with a valid scheduleOverrides map", () => {
    expect(
      isSchedulePayload({
        ...basePayload(),
        scheduleOverrides: { "2099-05-25": "weekend" },
      }),
    ).toBe(true);
  });

  it("rejects an override value that isn't a known schedule type", () => {
    expect(
      isSchedulePayload({
        ...basePayload(),
        scheduleOverrides: { "2099-05-25": "garbage" },
      }),
    ).toBe(false);
  });

  it("rejects scheduleOverrides that isn't a plain object", () => {
    expect(
      isSchedulePayload({ ...basePayload(), scheduleOverrides: [] }),
    ).toBe(false);
  });
});

describe("tripServesLeg", () => {
  it("returns true for a trip number that runs on the given leg", async () => {
    const { tripServesLeg, getFilteredTrips } = await import("@/lib/scheduleUtils");
    const stations = (await import("@/data/stations")).default;
    const from = stations[0];
    const to = stations[stations.length - 1];
    const sample = getFilteredTrips(from, to, "weekday")[0];
    expect(tripServesLeg(sample.trip, from, to, "weekday")).toBe(true);
  });

  it("returns false for a trip number not on the leg", async () => {
    const { tripServesLeg } = await import("@/lib/scheduleUtils");
    const stations = (await import("@/data/stations")).default;
    expect(
      tripServesLeg(999999, stations[0], stations[stations.length - 1], "weekday"),
    ).toBe(false);
  });
});
