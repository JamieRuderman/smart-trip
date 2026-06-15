import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaveAlarmNativePlugin } from "./leaveAlarm";

const getPlatform = vi.fn(() => "ios");
const isAvailable = vi.fn(async () => ({ value: true }));
const checkAuthorization = vi.fn(async () => ({ status: "authorized" }));
const requestAuthorization = vi.fn(async () => ({ status: "authorized" }));
const schedule = vi.fn(
  async (opts: Parameters<LeaveAlarmNativePlugin["schedule"]>[0]) => {
    void opts;
    return { id: "alarm-1" };
  },
);
const cancel = vi.fn(async (opts: { id: string }) => {
  void opts;
});

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => getPlatform() },
  // The local LeaveAlarm plugin (registered natively per platform).
  registerPlugin: () => ({
    isAvailable: () => isAvailable(),
    checkAuthorization: () => checkAuthorization(),
    requestAuthorization: () => requestAuthorization(),
    schedule: (opts: Parameters<LeaveAlarmNativePlugin["schedule"]>[0]) =>
      schedule(opts),
    cancel: (opts: { id: string }) => cancel(opts),
  }),
}));

import {
  cancelLeaveAlarm,
  checkAlarmAuth,
  decideReminderChannel,
  scheduleLeaveAlarm,
} from "@/lib/native/leaveAlarm";

beforeEach(() => {
  getPlatform.mockReturnValue("ios");
  isAvailable.mockResolvedValue({ value: true });
  checkAuthorization.mockResolvedValue({ status: "authorized" });
  requestAuthorization.mockResolvedValue({ status: "authorized" });
  schedule.mockResolvedValue({ id: "alarm-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("decideReminderChannel", () => {
  it("uses an alarm on iOS when available and authorized", () => {
    expect(
      decideReminderChannel({
        platform: "ios",
        alarmAvailable: true,
        alarmStatus: "authorized",
      }),
    ).toBe("alarm");
  });

  it("uses an alarm on Android too (setAlarmClock parity)", () => {
    expect(
      decideReminderChannel({
        platform: "android",
        alarmAvailable: true,
        alarmStatus: "authorized",
      }),
    ).toBe("alarm");
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

describe("checkAlarmAuth", () => {
  it("maps notDetermined to denied so callers proceed to request", async () => {
    checkAuthorization.mockResolvedValue({ status: "notDetermined" });
    await expect(checkAlarmAuth()).resolves.toBe("denied");
  });

  it("is unavailable on web without touching the plugin", async () => {
    getPlatform.mockReturnValue("web");
    await expect(checkAlarmAuth()).resolves.toBe("unavailable");
    expect(checkAuthorization).not.toHaveBeenCalled();
  });
});

describe("scheduleLeaveAlarm", () => {
  const fireAt = new Date(2026, 5, 6, 8, 42, 0, 0).getTime();

  it("schedules a date-based AlarmKit alarm with the localized buttons", async () => {
    const result = await scheduleLeaveAlarm({
      label: "Leave for train",
      fireAt,
      buttons: { stop: "Stop", viewTrip: "View trip" },
    });
    expect(result).toEqual({ scheduled: true, alarmId: "alarm-1" });
    expect(schedule).toHaveBeenCalledWith({
      fireAtMs: fireAt,
      title: "Leave for train",
      stopButtonTitle: "Stop",
      openButtonTitle: "View trip",
    });
  });

  it("schedules for a date days out — no next-24h clock-time restriction", async () => {
    // A weekend trip focused on a weekday: the old hour/minute plugin had to
    // fall back to a notification here; date-based scheduling must not.
    const nextSaturday = new Date(2026, 5, 13, 8, 15, 0, 0).getTime();
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt: nextSaturday });
    expect(result.scheduled).toBe(true);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({ fireAtMs: nextSaturday }),
    );
  });

  it("requests authorization when not yet granted, then schedules", async () => {
    checkAuthorization.mockResolvedValue({ status: "notDetermined" });
    requestAuthorization.mockResolvedValue({ status: "authorized" });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(requestAuthorization).toHaveBeenCalledOnce();
    expect(result.scheduled).toBe(true);
  });

  it("does not schedule on web (no native alarm)", async () => {
    getPlatform.mockReturnValue("web");
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("schedules a real alarm on Android (setAlarmClock parity)", async () => {
    getPlatform.mockReturnValue("android");
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: true, alarmId: "alarm-1" });
    expect(schedule).toHaveBeenCalled();
  });

  it("does not schedule when AlarmKit is unavailable", async () => {
    isAvailable.mockResolvedValue({ value: false });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not schedule when authorization is denied", async () => {
    checkAuthorization.mockResolvedValue({ status: "denied" });
    requestAuthorization.mockResolvedValue({ status: "denied" });
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reports not scheduled when the plugin rejects", async () => {
    schedule.mockRejectedValue(new Error("native failure"));
    const result = await scheduleLeaveAlarm({ label: "Leave", fireAt });
    expect(result).toEqual({ scheduled: false });
  });
});

describe("cancelLeaveAlarm", () => {
  it("cancels the alarm by id", async () => {
    await cancelLeaveAlarm("alarm-1");
    expect(cancel).toHaveBeenCalledWith({ id: "alarm-1" });
  });

  it("swallows a plugin failure", async () => {
    cancel.mockRejectedValue(new Error("gone"));
    await expect(cancelLeaveAlarm("alarm-1")).resolves.toBeUndefined();
  });
});
