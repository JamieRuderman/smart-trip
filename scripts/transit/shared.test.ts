import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsFeed,
  GtfsStopTime,
} from "../../src/types/gtfs.js";

import {
  buildTrainSchedules,
  deriveScheduleOverrides,
  deriveServiceTypes,
  type StationParent,
} from "./shared.js";

const WEEKDAY: GtfsCalendar = {
  service_id: "weekday",
  monday: "1",
  tuesday: "1",
  wednesday: "1",
  thursday: "1",
  friday: "1",
  saturday: "0",
  sunday: "0",
  start_date: "20260101",
  end_date: "20271231",
};

const WEEKEND: GtfsCalendar = {
  service_id: "weekend",
  monday: "0",
  tuesday: "0",
  wednesday: "0",
  thursday: "0",
  friday: "0",
  saturday: "1",
  sunday: "1",
  start_date: "20260101",
  end_date: "20271231",
};

const addWeekendRemoveWeekday = (date: string): GtfsCalendarDate[] => [
  { service_id: "weekend", date, exception_type: "1" },
  { service_id: "weekday", date, exception_type: "2" },
];

describe("deriveScheduleOverrides", () => {
  it("emits a weekend override for Memorial Day 2026 (Mon May 25)", () => {
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      addWeekendRemoveWeekday("20260525"),
    );
    expect(overrides).toEqual({ "2026-05-25": "weekend" });
  });

  it("returns weekend for a weekday that has no service at all (e.g. Christmas)", () => {
    // Christmas 2026 falls on a Friday — calendar_dates only removes weekday
    // service. We fall back to weekend so the user sees reduced trips.
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      [{ service_id: "weekday", date: "20261225", exception_type: "2" }],
    );
    expect(overrides).toEqual({ "2026-12-25": "weekend" });
  });

  it("does not emit anything when the effective schedule matches the natural day", () => {
    // 2026-04-04 is a Saturday — natural and effective both "weekend".
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      [{ service_id: "weekend", date: "20260404", exception_type: "1" }],
    );
    expect(overrides).toEqual({});
  });

  it("filters out dates earlier than minDate", () => {
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      [
        ...addWeekendRemoveWeekday("20260525"),
        ...addWeekendRemoveWeekday("20270525"),
      ],
      { minDate: new Date(2027, 0, 1) },
    );
    expect(overrides).toEqual({ "2027-05-25": "weekend" });
  });

  it("ignores malformed dates", () => {
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      [{ service_id: "weekend", date: "BADDATE", exception_type: "1" }],
    );
    expect(overrides).toEqual({});
  });

  it("does not emit an override when weekday and weekend service both run", () => {
    // A weekday Monday where extra weekend-pattern service is added but the
    // regular weekday service is NOT removed — the natural weekday schedule
    // is still in effect, so we must not downgrade to weekend.
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      [{ service_id: "weekend", date: "20260518", exception_type: "1" }],
    );
    expect(overrides).toEqual({});
  });

  it("defers to natural day-of-week when a date-only service is added", () => {
    // Friday 2026-05-22: regular weekday service removed, an unknown
    // date-only service_id added (no calendar.txt row). We can't classify
    // it, so we must NOT emit a weekend override — the user is left with
    // the natural weekday view rather than a guessed downgrade.
    const overrides = deriveScheduleOverrides(
      [WEEKDAY, WEEKEND],
      [
        { service_id: "weekday", date: "20260522", exception_type: "2" },
        { service_id: "special-event", date: "20260522", exception_type: "1" },
      ],
    );
    expect(overrides).toEqual({});
  });
});

describe("deriveServiceTypes", () => {
  // Regression for issue #43: 511 republished the Golden Gate Ferry bundle
  // with weekend service 76504 starting 2026-05-23. The Friday 2026-05-22
  // refresh saw no weekend service "active today" and the sanity floor
  // tripped. The look-ahead window must classify the upcoming weekend
  // service so the refresh succeeds.
  it("classifies a service whose start_date is a few days in the future", () => {
    const calendar: GtfsCalendar[] = [
      { ...WEEKDAY, service_id: "wk", start_date: "20260518", end_date: "20260612" },
      { ...WEEKEND, service_id: "we", start_date: "20260523", end_date: "20260613" },
    ];
    const result = deriveServiceTypes(calendar, new Date(2026, 4, 22));
    expect(result.get("wk")).toBe("weekday");
    expect(result.get("we")).toBe("weekend");
  });

  it("ignores services whose end_date is before today", () => {
    const calendar: GtfsCalendar[] = [
      { ...WEEKEND, service_id: "stale", start_date: "20260101", end_date: "20260301" },
    ];
    const result = deriveServiceTypes(calendar, new Date(2026, 4, 22));
    expect(result.has("stale")).toBe(false);
  });

  it("ignores services whose start_date is beyond the look-ahead window", () => {
    const calendar: GtfsCalendar[] = [
      { ...WEEKEND, service_id: "far", start_date: "20260801", end_date: "20260901" },
    ];
    const result = deriveServiceTypes(calendar, new Date(2026, 4, 22));
    expect(result.has("far")).toBe(false);
  });

  // Memorial Day Monday: calendar_dates removes the weekday service and
  // adds the weekend one. We deliberately ignore those today-only
  // exceptions during static classification — the SPA's runtime
  // getTodayScheduleType() handles "show weekend on holidays" instead.
  // Without this, the sanity floor in transform.ts trips on 0 weekday
  // trips every time a federal holiday falls on a Monday-Friday.
  it("classifies by canonical day pattern even on holiday exception dates", () => {
    // Memorial Day Monday: calendar_dates removes the weekday service and
    // adds the weekend one. We deliberately ignore those today-only
    // exceptions during static classification — the SPA's runtime
    // getTodayScheduleType() handles "show weekend on holidays" instead.
    // Without this, the sanity floor in transform.ts trips on 0 weekday
    // trips every time a federal holiday falls on a Monday-Friday.
    const calendar: GtfsCalendar[] = [
      { ...WEEKDAY, service_id: "wk" },
      { ...WEEKEND, service_id: "we" },
    ];
    // Exceptions are present in the raw GTFS feed but no longer affect
    // classification — they're consumed elsewhere (scheduleOverrides) and
    // by the SPA's runtime getTodayScheduleType().
    const result = deriveServiceTypes(calendar, new Date(2026, 4, 25));
    expect(result.get("wk")).toBe("weekday");
    expect(result.get("we")).toBe("weekend");
  });
});

// ── buildTrainSchedules — Memorial Day end-to-end regression ────────────────
//
// deriveServiceTypes tests above prove the classification step survives
// holiday exceptions. This test goes one layer down: through the full
// buildTrainSchedules pipeline that classify-then-filters trips, with a
// mocked system clock fixed to Memorial Day. It's the most direct test
// that the sanity floor in transform.ts can't trip on a holiday because
// of this codepath again.
describe("buildTrainSchedules", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits weekday trips on a US federal holiday Monday (Memorial Day)", () => {
    // Pin "today" to Memorial Day 2026 (Mon May 25). buildTrainSchedules
    // calls deriveServiceTypes() with no reference date, so it reads
    // new Date() — hence the system-clock mock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 25, 12, 0, 0));

    // Minimal 2-station feed: Alpha (north) → Bravo (south). Northbound
    // would mean Bravo → Alpha. Both trips travel A → B = southbound.
    const stations: StationParent[] = [
      { stopId: "STA_A", name: "Alpha", lat: 0, lng: 0, zone: 1 },
      { stopId: "STA_B", name: "Bravo", lat: 0, lng: 0, zone: 2 },
    ];
    const stopToStation = new Map<string, string>([
      ["STA_A", "Alpha"],
      ["STA_B", "Bravo"],
    ]);

    const feed: GtfsFeed = {
      schemaVersion: 1,
      operatorId: "SA",
      fetchedAt: "2026-05-24T00:00:00Z",
      sourceUrl: "",
      agency: [],
      routes: [],
      stops: [],
      stopTimes: [],
      shapes: null,
      calendar: [
        { ...WEEKDAY, service_id: "wk" },
        { ...WEEKEND, service_id: "we" },
      ],
      // Memorial Day exception: removes weekday, adds weekend. Pre-fix,
      // this would have caused deriveServiceTypes to drop the weekday
      // service, and trip T1 below would be skipped → 0 weekday trips.
      calendarDates: addWeekendRemoveWeekday("20260525"),
      trips: [
        {
          route_id: "R",
          service_id: "wk",
          trip_id: "T1",
          trip_short_name: "101",
        },
        {
          route_id: "R",
          service_id: "we",
          trip_id: "T2",
          trip_short_name: "202",
        },
      ],
    };

    const stopTimesByTrip = new Map<string, GtfsStopTime[]>([
      [
        "T1",
        [
          {
            trip_id: "T1",
            stop_id: "STA_A",
            stop_sequence: "1",
            departure_time: "08:00:00",
            arrival_time: "08:00:00",
          },
          {
            trip_id: "T1",
            stop_id: "STA_B",
            stop_sequence: "2",
            departure_time: "08:30:00",
            arrival_time: "08:30:00",
          },
        ],
      ],
      [
        "T2",
        [
          {
            trip_id: "T2",
            stop_id: "STA_A",
            stop_sequence: "1",
            departure_time: "10:00:00",
            arrival_time: "10:00:00",
          },
          {
            trip_id: "T2",
            stop_id: "STA_B",
            stop_sequence: "2",
            departure_time: "10:30:00",
            arrival_time: "10:30:00",
          },
        ],
      ],
    ]);

    const result = buildTrainSchedules(
      feed,
      stopTimesByTrip,
      stations,
      stopToStation,
    );

    // The user-visible bug: weekday counts dropped to 0 on Memorial Day,
    // tripping the sanity floor. Assert they survive the new pipeline.
    expect(result.weekday.southbound).toHaveLength(1);
    expect(result.weekday.southbound[0].trip).toBe(101);
    expect(result.weekend.southbound).toHaveLength(1);
    expect(result.weekend.southbound[0].trip).toBe(202);
  });
});
