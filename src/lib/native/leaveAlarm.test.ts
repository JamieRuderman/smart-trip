import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPlatform = vi.fn(() => "ios");
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => getPlatform() },
}));

const getOSInfo = vi.fn(async () => ({ supportsNativeAlarms: true }));
const checkPermissions = vi.fn(async () => ({ granted: true }));
const requestPermissions = vi.fn(async () => ({ granted: true }));
const createAlarm = vi.fn(async (opts: unknown) => {
  void opts;
  return { success: true, id: "alarm-1" } as { success: boolean; id?: string };
});
const cancelAlarm = vi.fn(async (opts: unknown) => {
  void opts;
  return { success: true };
});
vi.mock("@capgo/capacitor-alarm", () => ({
  CapgoAlarm: {
    getOSInfo: () => getOSInfo(),
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
    createAlarm: (opts: unknown) => createAlarm(opts),
    cancelAlarm: (opts: unknown) => cancelAlarm(opts),
  },
}));

import {
  alarmFiresOnIntendedDay,
  cancelLeaveAlarm,
  decideReminderChannel,
  scheduleLeaveAlarm,
} from "@/lib/native/leaveAlarm";

// Fixed "now" so the date-safety guard (which compares against Date.now()) is
// deterministic: Sat 2026-06-06 07:00 local.
const NOW = new Date(2026, 5, 6, 7, 0, 0, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getPlatform.mockReturnValue("ios");
  getOSInfo.mockResolvedValue({ supportsNativeAlarms: true });
  checkPermissions.mockResolvedValue({ granted: true });
  requestPermissions.mockResolvedValue({ granted: true });
  createAlarm.mockResolvedValue({ success: true, id: "alarm-1" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("decideReminderChannel", () => {
  it("uses an alarm only on iOS when available and authorized", () => {
    expect(
      decideReminderChannel({
        platform: "ios",
        alarmAvailable: true,
        alarmStatus: "authorized",
      }),
    ).toBe("alarm");
  });

  it("falls back to notification on Android even when authorized", () => {
    expect(
      decideReminderChannel({
        platform: "android",
        alarmAvailable: true,
        alarmStatus: "authorized",
      }),
    ).toBe("notification");
  });

  it("falls back to notification on web", () => {
    expect(
      decideReminderChannel({
        platform: "web",
        alarmAvailable: false,
        alarmStatus: "unavailable",
      }),
    ).toBe("notification");
  });

  it.each(["denied", "unavailable"] as const)(
    "falls back to notification when iOS auth is %s",
    (status) => {
      expect(
        decideReminderChannel({
          platform: "ios",
          alarmAvailable: true,
          alarmStatus: status,
        }),
      ).toBe("notification");
    },
  );

  it("falls back to notification when AlarmKit is unavailable on iOS", () => {
    expect(
      decideReminderChannel({
        platform: "ios",
        alarmAvailable: false,
        alarmStatus: "unavailable",
      }),
    ).toBe("notification");
  });
});

describe("scheduleLeaveAlarm", () => {
  // 8:42 AM local — the hour/minute the plugin should receive.
  const fireAt = new Date(2026, 5, 6, 8, 42, 0, 0).getTime();

  it("schedules an AlarmKit alarm on iOS when authorized", async () => {
    const result = await scheduleLeaveAlarm({ label: "Leave for train", fireAt });
    expect(result).toEqual({ scheduled: true, alarmId: "alarm-1" });
    expect(createAlarm).toHaveBeenCalledWith({
      hour: 8,
      minute: 42,
      label: "Leave for train",
    });
  });

  it("requests authorization when not yet granted, then schedules", async () => {
    checkPermissions.mockResolvedValue({ granted: false });
    requestPermissions.mockResolvedValue({ granted: true });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(requestPermissions).toHaveBeenCalledOnce();
    expect(result.scheduled).toBe(true);
  });

  it("does not schedule on a non-iOS platform", async () => {
    getPlatform.mockReturnValue("android");
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
    expect(createAlarm).not.toHaveBeenCalled();
  });

  it("does not schedule when AlarmKit is unavailable", async () => {
    getOSInfo.mockResolvedValue({ supportsNativeAlarms: false });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
    expect(createAlarm).not.toHaveBeenCalled();
  });

  it("does not schedule when authorization is denied", async () => {
    checkPermissions.mockResolvedValue({ granted: false });
    requestPermissions.mockResolvedValue({ granted: false });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
    expect(createAlarm).not.toHaveBeenCalled();
  });

  it("reports not scheduled when the plugin returns no id", async () => {
    createAlarm.mockResolvedValue({ success: false });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
  });

  it("does not use an alarm when the fire time isn't the next occurrence of its clock time (wrong day)", async () => {
    // Tomorrow 10:00, but 10:00 still occurs later TODAY — a time-of-day alarm
    // would fire today, ~24h early, so it must fall back to the notification.
    const tomorrowLater = new Date(2026, 5, 7, 10, 0, 0, 0).getTime();
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt: tomorrowLater });
    expect(result).toEqual({ scheduled: false });
    expect(createAlarm).not.toHaveBeenCalled();
  });
});

describe("alarmFiresOnIntendedDay", () => {
  it("is true for a fire time later today", () => {
    expect(alarmFiresOnIntendedDay(new Date(2026, 5, 6, 8, 42).getTime(), NOW)).toBe(true);
  });

  it("is true for tomorrow when that clock time already passed today", () => {
    // now 07:00; 06:30 tomorrow is the next occurrence of 06:30.
    expect(alarmFiresOnIntendedDay(new Date(2026, 5, 7, 6, 30).getTime(), NOW)).toBe(true);
  });

  it("is false for tomorrow when that clock time still occurs today", () => {
    expect(alarmFiresOnIntendedDay(new Date(2026, 5, 7, 10, 0).getTime(), NOW)).toBe(false);
  });

  it("is false for a multi-day-out fire time (weekend trip on a weekday)", () => {
    expect(alarmFiresOnIntendedDay(new Date(2026, 5, 9, 8, 15).getTime(), NOW)).toBe(false);
  });
});

describe("cancelLeaveAlarm", () => {
  it("cancels the alarm by id", async () => {
    await cancelLeaveAlarm("alarm-1");
    expect(cancelAlarm).toHaveBeenCalledWith({ id: "alarm-1" });
  });
});
