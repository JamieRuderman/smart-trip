// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  registerPlugin: () => ({}),
}));
const notifyChange = vi.fn();
vi.mock("@/lib/liveActivityController", () => ({ notifyChange: () => notifyChange() }));
const scheduleLeaveAlarm = vi.fn(
  async (): Promise<{ scheduled: boolean; alarmId?: string }> => ({
    scheduled: true,
    alarmId: "alarm-new",
  }),
);
const cancelLeaveAlarm = vi.fn(async (id: string) => {
  void id;
});
vi.mock("@/lib/native/leaveAlarm", () => ({
  scheduleLeaveAlarm: () => scheduleLeaveAlarm(),
  cancelLeaveAlarm: (id: string) => cancelLeaveAlarm(id),
}));
const ensureNotificationPermission = vi.fn(async () => true);
const cancelNotification = vi.fn(async (id: number) => {
  void id;
});
vi.mock("@/lib/notificationScheduler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notificationScheduler")>()),
  ensureNotificationPermission: () => ensureNotificationPermission(),
  scheduleNotification: async () => {},
  cancelNotification: (id: number) => cancelNotification(id),
}));

import {
  clearGetOffAlarm,
  GET_OFF_MAX_LEAD_MINUTES,
  getOffAlarmTiming,
  rescheduleGetOffAlarm,
  setGetOffAlarm,
  stopBefore,
} from "./getOffAlarm";
import {
  focusedArrivalInstant,
  loadFocusedTrip,
  saveFocusedTrip,
  FOCUSED_TRIP_STORAGE_KEY,
  type FocusedTrip,
} from "./focusedTrip";
import { getOffAlarmIdFor, reminderIdFor } from "./notificationId";
import { getFilteredTrips, type ProcessedTrip } from "./scheduleUtils";
import stations from "@/data/stations";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

const FIRST = stations[0];
const LAST = stations[stations.length - 1];
const SAMPLE = getFilteredTrips(FIRST, LAST, "weekday")[0];

function makeFocused(overrides: Partial<FocusedTrip> = {}): FocusedTrip {
  return {
    source: "user",
    tripNumber: SAMPLE.trip,
    fromStation: FIRST,
    toStation: LAST,
    scheduleType: "weekday",
    serviceDate: "2099-01-01",
    reminder: null,
    ...overrides,
  };
}

function syntheticTrip(times: Record<number, string>): ProcessedTrip {
  return {
    trip: 1,
    times: Array.from(stations.keys(), (i) => times[i] ?? "~~"),
    departureTime: "",
    arrivalTime: "",
    fromStation: FIRST,
    toStation: LAST,
    isValid: true,
  };
}

const TEXT = { title: "Next stop", body: "Get ready" };

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("stopBefore", () => {
  it("finds the last served stop before the destination, southbound", () => {
    const trip = syntheticTrip({ 0: "8:00", 1: "8:05", 2: "8:10", 4: "8:20" });
    expect(stopBefore(trip, stations[0], stations[4])).toEqual({
      station: stations[2],
      minutes: 8 * 60 + 10,
    });
  });

  it("walks the other way northbound", () => {
    const trip = syntheticTrip({ 4: "8:00", 3: "8:05", 1: "8:15" });
    expect(stopBefore(trip, stations[4], stations[1])?.station).toBe(stations[3]);
  });

  it("passes over a stop the live feed says the train skips", () => {
    const trip = syntheticTrip({ 0: "8:00", 1: "8:05", 2: "8:10", 3: "8:15" });
    expect(stopBefore(trip, stations[0], stations[3], [stations[2]])?.station).toBe(
      stations[1],
    );
  });

  it("falls back to the boarding station on a one-stop ride", () => {
    const trip = syntheticTrip({ 0: "8:00", 1: "8:05" });
    expect(stopBefore(trip, stations[0], stations[1])?.station).toBe(stations[0]);
  });
});

describe("getOffAlarmTiming", () => {
  it("rings before the scheduled arrival, by at most the lead cap", () => {
    const focused = makeFocused();
    const timing = getOffAlarmTiming(focused, null)!;
    expect(timing.arrivalAt).toBe(focusedArrivalInstant(focused));
    const lead = timing.arrivalAt - timing.fireAt;
    expect(lead).toBeGreaterThanOrEqual(60_000);
    expect(lead).toBeLessThanOrEqual(GET_OFF_MAX_LEAD_MINUTES * 60_000);
  });

  it("follows the live arrival", () => {
    const focused = makeFocused();
    const scheduled = getOffAlarmTiming(focused, null)!;
    const late = new Date(scheduled.arrivalAt + 7 * 60_000);
    const live = {
      isCanceled: false,
      liveArrivalTime: `${late.getHours()}:${String(late.getMinutes()).padStart(2, "0")}`,
    } satisfies TripRealtimeStatus;
    const timing = getOffAlarmTiming(focused, live)!;
    expect(timing.fireAt - scheduled.fireAt).toBe(7 * 60_000);
  });
});

describe("get-off alarm storage", () => {
  it("never shares a notification id with the leave reminder", () => {
    expect(getOffAlarmIdFor(123, "2026-11-25")).not.toBe(reminderIdFor(123, "2026-11-25"));
  });

  it("round-trips an armed alarm and rejects a malformed one", () => {
    const armed = makeFocused({
      getOffAlarm: { reminderAt: 1, notificationId: 2, title: "t", body: "b", alarmId: "a" },
    });
    saveFocusedTrip(armed);
    expect(loadFocusedTrip()).toEqual(armed);

    localStorage.setItem(
      FOCUSED_TRIP_STORAGE_KEY,
      JSON.stringify({ ...armed, getOffAlarm: { reminderAt: "soon" } }),
    );
    expect(loadFocusedTrip()).toBeNull();
  });
});

describe("setGetOffAlarm / clearGetOffAlarm", () => {
  const FIRE_AT = new Date(2099, 0, 1, 9, 0).getTime();

  it("arms the alarm and stores it on the focused trip", async () => {
    saveFocusedTrip(makeFocused());
    expect(await setGetOffAlarm(FIRE_AT, TEXT)).toEqual({ ok: true });
    expect(loadFocusedTrip()?.getOffAlarm).toEqual({
      reminderAt: FIRE_AT,
      notificationId: getOffAlarmIdFor(SAMPLE.trip, "2099-01-01"),
      ...TEXT,
      alarmId: "alarm-new",
    });
    expect(notifyChange).toHaveBeenCalled();
  });

  it("reports a refused permission without storing anything", async () => {
    saveFocusedTrip(makeFocused());
    scheduleLeaveAlarm.mockResolvedValueOnce({ scheduled: false });
    ensureNotificationPermission.mockResolvedValueOnce(false);
    expect(await setGetOffAlarm(FIRE_AT, TEXT)).toEqual({ ok: false, reason: "permission" });
    expect(loadFocusedTrip()?.getOffAlarm).toBeUndefined();
  });

  it("rolls the alarm back when the rider switched trains meanwhile", async () => {
    saveFocusedTrip(makeFocused());
    scheduleLeaveAlarm.mockImplementationOnce(async () => {
      saveFocusedTrip(makeFocused({ serviceDate: "2099-01-02" }));
      return { scheduled: true, alarmId: "alarm-new" };
    });
    expect(await setGetOffAlarm(FIRE_AT, TEXT)).toEqual({ ok: false, reason: "schedule-failed" });
    expect(cancelLeaveAlarm).toHaveBeenCalledWith("alarm-new");
    expect(loadFocusedTrip()?.getOffAlarm).toBeUndefined();
  });

  it("cancels and forgets the alarm when turned off", async () => {
    const armed = { reminderAt: FIRE_AT, notificationId: 5, ...TEXT, alarmId: "a1" };
    saveFocusedTrip(makeFocused({ getOffAlarm: armed }));
    await clearGetOffAlarm();
    expect(cancelLeaveAlarm).toHaveBeenCalledWith("a1");
    expect(cancelNotification).toHaveBeenCalledWith(5);
    expect(loadFocusedTrip()?.getOffAlarm).toBeUndefined();
  });
});

describe("rescheduleGetOffAlarm", () => {
  const FIRE_AT = new Date(2099, 0, 1, 9, 0).getTime();
  const armed = { reminderAt: FIRE_AT, notificationId: 5, ...TEXT, alarmId: "old" };

  it("does nothing when the time and text are unchanged", async () => {
    saveFocusedTrip(makeFocused({ getOffAlarm: armed }));
    await rescheduleGetOffAlarm(FIRE_AT, TEXT);
    expect(scheduleLeaveAlarm).not.toHaveBeenCalled();
  });

  it("moves the alarm and retires the old one when the train runs late", async () => {
    saveFocusedTrip(makeFocused({ getOffAlarm: armed }));
    await rescheduleGetOffAlarm(FIRE_AT + 4 * 60_000, TEXT);
    expect(cancelLeaveAlarm).toHaveBeenCalledWith("old");
    expect(loadFocusedTrip()?.getOffAlarm).toMatchObject({
      reminderAt: FIRE_AT + 4 * 60_000,
      alarmId: "alarm-new",
    });
  });

  it("leaves an alarm that has already rung alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIRE_AT + 60_000);
    saveFocusedTrip(makeFocused({ getOffAlarm: armed }));
    await rescheduleGetOffAlarm(FIRE_AT + 4 * 60_000, TEXT);
    expect(scheduleLeaveAlarm).not.toHaveBeenCalled();
  });

  it("rolls back a re-arm when the rider turned the alarm off meanwhile", async () => {
    saveFocusedTrip(makeFocused({ getOffAlarm: armed }));
    scheduleLeaveAlarm.mockImplementationOnce(async () => {
      saveFocusedTrip(makeFocused());
      return { scheduled: true, alarmId: "alarm-new" };
    });
    await rescheduleGetOffAlarm(FIRE_AT + 4 * 60_000, TEXT);
    expect(cancelLeaveAlarm).toHaveBeenCalledWith("alarm-new");
    expect(loadFocusedTrip()?.getOffAlarm).toBeUndefined();
  });

  it("retires every superseded alarm when re-arms overlap", async () => {
    saveFocusedTrip(makeFocused({ getOffAlarm: armed }));
    scheduleLeaveAlarm
      .mockResolvedValueOnce({ scheduled: true, alarmId: "a1" })
      .mockResolvedValueOnce({ scheduled: true, alarmId: "a2" });
    await Promise.all([
      rescheduleGetOffAlarm(FIRE_AT + 2 * 60_000, TEXT),
      rescheduleGetOffAlarm(FIRE_AT + 4 * 60_000, TEXT),
    ]);
    expect(cancelLeaveAlarm).toHaveBeenCalledWith("old");
    expect(cancelLeaveAlarm).toHaveBeenCalledWith("a1");
    expect(loadFocusedTrip()?.getOffAlarm).toMatchObject({
      reminderAt: FIRE_AT + 4 * 60_000,
      alarmId: "a2",
    });
  });
});
