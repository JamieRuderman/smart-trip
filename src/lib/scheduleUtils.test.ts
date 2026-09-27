import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getFirstInProgressTripIndex,
  getNextTripIndex,
  getScheduleMeta,
  getTodayScheduleType,
  setScheduleData,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import {
  bundledSchedulePayload,
  isSchedulePayload,
  type SchedulePayload,
} from "@/data/scheduleData";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

/** Minimal ProcessedTrip — these helpers only read departure/arrival times. */
function trip(departureTime: string, arrivalTime: string): ProcessedTrip {
  return { departureTime, arrivalTime } as ProcessedTrip;
}

describe("getNextTripIndex", () => {
  // 2026-06-18 09:00 local (TZ pinned to Pacific in setup).
  const now = new Date(2026, 5, 18, 9, 0);
  const trips = [
    trip("08:00", "08:45"),
    trip("08:30", "09:15"),
    trip("09:30", "10:15"),
    trip("10:00", "10:45"),
  ];

  it("returns the first trip that has not yet departed", () => {
    expect(getNextTripIndex(trips, now)).toBe(2); // 09:30 is the next departure
  });

  it("returns -1 when every trip has already departed", () => {
    const allPast = new Date(2026, 5, 18, 23, 0);
    expect(getNextTripIndex(trips, allPast)).toBe(-1);
  });

  it("returns 0 before the first departure", () => {
    const early = new Date(2026, 5, 18, 6, 0);
    expect(getNextTripIndex(trips, early)).toBe(0);
  });

  it("keeps a delayed trip as next past its scheduled slot until its live departure", () => {
    // 08:30 trip delayed to 09:10 — at 09:00 it has NOT departed yet, so it
    // (index 1), not the 09:30 trip, is next.
    const live = new Map([
      ["08:30", { liveDepartureTime: "09:10" } as TripRealtimeStatus],
    ]);
    expect(getNextTripIndex(trips, now, live)).toBe(1);
  });
});

describe("getFirstInProgressTripIndex", () => {
  const trips = [
    trip("08:00", "08:45"),
    trip("08:30", "09:15"),
    trip("09:30", "10:15"),
  ];

  it("finds a trip whose departure is past but arrival is not", () => {
    // 09:00: trip 1 (08:30→09:15) has departed but not arrived.
    const now = new Date(2026, 5, 18, 9, 0);
    expect(getFirstInProgressTripIndex(trips, now)).toBe(1);
  });

  it("returns -1 in a gap between trips", () => {
    // 09:20: trip 1 arrived (09:15), trip 2 not departed (09:30).
    const now = new Date(2026, 5, 18, 9, 20);
    expect(getFirstInProgressTripIndex(trips, now)).toBe(-1);
  });

  it("returns -1 before any trip starts", () => {
    const now = new Date(2026, 5, 18, 7, 0);
    expect(getFirstInProgressTripIndex(trips, now)).toBe(-1);
  });

  it("keeps a delayed trip in progress past its scheduled arrival until its live arrival", () => {
    // 08:30→09:15 trip running late, live arrival 09:40 — at 09:20 it is
    // still in progress even though its scheduled arrival has passed.
    const now = new Date(2026, 5, 18, 9, 20);
    const live = new Map([
      ["08:30", { liveArrivalTime: "09:40" } as TripRealtimeStatus],
    ]);
    expect(getFirstInProgressTripIndex(trips, now, live)).toBe(1);
  });
});

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

describe("bundled schedule generatedAt", () => {
  afterEach(() => {
    setScheduleData(bundledSchedulePayload);
  });

  it("stamps a valid ISO generatedAt into the bundled payload", () => {
    // Regression guard: a missing generatedAt makes an offline cold-launch
    // surface "Schedule timestamp unavailable" in the footer.
    expect(bundledSchedulePayload.generatedAt).toBeTruthy();
    const parsed = new Date(bundledSchedulePayload.generatedAt as string);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("surfaces a non-null generatedAt when the bundled payload is applied", () => {
    setScheduleData(bundledSchedulePayload, "bundled");
    const meta = getScheduleMeta();
    expect(meta.source).toBe("bundled");
    expect(meta.generatedAt).toBeInstanceOf(Date);
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
