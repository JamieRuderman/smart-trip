import { describe, expect, it } from "vitest";

import type { GtfsCalendar, GtfsCalendarDate } from "../../src/types/gtfs.js";

import { deriveScheduleOverrides } from "./shared.js";

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
