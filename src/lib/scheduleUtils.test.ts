import { afterEach, describe, expect, it, vi } from "vitest";

import { getTodayScheduleType, setScheduleData } from "@/lib/scheduleUtils";
import {
  bundledSchedulePayload,
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

  it("applies the bundled holiday override for Memorial Day 2026", () => {
    const memorialDay = new Date(2026, 4, 25); // Mon 2026-05-25
    expect(getTodayScheduleType(memorialDay)).toBe("weekend");
  });

  it("uses overrides from a refreshed schedule payload", () => {
    const payload: SchedulePayload = {
      ...bundledSchedulePayload,
      scheduleOverrides: { "2026-07-04": "weekday" },
    };
    setScheduleData(payload);
    // Sat 2026-07-04 — refreshed payload tells us it's a weekday schedule.
    expect(getTodayScheduleType(new Date(2026, 6, 4))).toBe("weekday");
    // Untouched dates still follow day-of-week.
    expect(getTodayScheduleType(new Date(2026, 6, 5))).toBe("weekend");
  });

  it("defaults to new Date() when no argument is passed", () => {
    // Just confirm it returns one of the valid values without throwing.
    expect(["weekday", "weekend"]).toContain(getTodayScheduleType());
  });

  it("uses local-time date keys, not UTC", () => {
    // 2026-05-25 23:30 local time should still match the Memorial Day override
    // even if UTC has already rolled to 2026-05-26.
    const lateMemorialDay = new Date(2026, 4, 25, 23, 30);
    expect(getTodayScheduleType(lateMemorialDay)).toBe("weekend");
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
