import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "ios", isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));
vi.mock("@/lib/native/leaveAlarm", () => ({
  cancelLeaveAlarm: async () => {},
  scheduleLeaveAlarm: async () => null,
}));
vi.mock("@/lib/notificationScheduler", () => ({
  cancelNotification: async () => {},
  ensureNotificationPermission: async () => false,
  scheduleNotification: async () => {},
}));

const listTripActivityRecords = vi.fn(
  async (): Promise<{ id: string; state: string }[] | null> => [],
);
const startTripActivity = vi.fn(async () => ({ started: true }));
const endTripActivity = vi.fn(async () => {});
const updateTripActivity = vi.fn(async () => ({ updated: true }));
vi.mock("@/lib/native/liveActivity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/liveActivity")>()),
  listTripActivityRecords: () => listTripActivityRecords(),
  startTripActivity: () => startTripActivity(),
  endTripActivity: (id: string) => endTripActivity(id),
  updateTripActivity: () => updateTripActivity(),
}));

const isLiveActivityPushEnabled = vi.fn(() => false);
vi.mock("@/lib/native/liveActivityPush", () => ({
  isLiveActivityPushEnabled: () => isLiveActivityPushEnabled(),
  configureLiveActivityTokenEndpoint: async () => {},
  deregisterPushActivity: async () => {},
  registerPushActivity: async () => {},
  startAndRegisterPushActivity: async () => ({ started: true }),
}));

const NOW = new Date(2026, 5, 9, 8, 0, 0, 0).getTime();
const DEPARTURE = NOW + 20 * 60_000;
const ARRIVAL = NOW + 80 * 60_000;

const saveFocusedTrip = vi.fn();
const loadFocusedTrip = vi.fn((): FocusedTrip | null => FOCUS);
vi.mock("@/lib/focusedTrip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/focusedTrip")>()),
  focusedDepartureInstant: () => DEPARTURE,
  focusedArrivalInstant: () => ARRIVAL,
  loadFocusedTrip: () => loadFocusedTrip(),
  saveFocusedTrip: (trip: unknown) => saveFocusedTrip(trip),
}));

import {
  ensureActivityForFocus,
  syncFocusedActivityContent,
} from "@/lib/liveActivityController";
import type { FocusedTrip } from "@/lib/focusedTrip";

const FOCUS: FocusedTrip = {
  source: "user",
  tripNumber: 7,
  fromStation: "Petaluma Downtown",
  toStation: "Larkspur",
  scheduleType: "weekday",
  serviceDate: "2026-06-09",
  reminder: null,
};
const ID = "trip-7-2026-06-09-committed";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  listTripActivityRecords.mockResolvedValue([]);
  isLiveActivityPushEnabled.mockReturnValue(false);
  loadFocusedTrip.mockReturnValue(FOCUS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ensureActivityForFocus revive decision", () => {
  it("starts a fresh activity when the focus has no committed id", async () => {
    await ensureActivityForFocus(FOCUS);
    expect(startTripActivity).toHaveBeenCalledTimes(1);
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.objectContaining({ liveActivityId: expect.stringMatching(/^trip-7-2026-06-09-/) }),
    );
  });

  it("leaves a live activity alone and refreshes its content instead", async () => {
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "active" }]);
    await ensureActivityForFocus({ ...FOCUS, liveActivityId: ID });
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
  });

  it("ends a locally auto-dismissed `ended` activity and restarts it", async () => {
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "ended" }]);
    await ensureActivityForFocus({ ...FOCUS, liveActivityId: ID });
    expect(endTripActivity).toHaveBeenCalledWith(ID);
    expect(startTripActivity).toHaveBeenCalledTimes(1);
    expect(endTripActivity.mock.invocationCallOrder[0]).toBeLessThan(
      startTripActivity.mock.invocationCallOrder[0],
    );
  });

  it("treats `ended` as deliberate on push builds and does not restart", async () => {
    isLiveActivityPushEnabled.mockReturnValue(true);
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "ended" }]);
    await ensureActivityForFocus({ ...FOCUS, liveActivityId: ID });
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });

  it("trusts a just-committed id the OS inventory does not list yet", async () => {
    await ensureActivityForFocus({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW - 30_000,
    });
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(endTripActivity).not.toHaveBeenCalled();
  });

  it("replaces an activity that has been missing past the grace window", async () => {
    await ensureActivityForFocus({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW - 10 * 60_000,
    });
    expect(endTripActivity).toHaveBeenCalledWith(ID);
    expect(startTripActivity).toHaveBeenCalledTimes(1);
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.objectContaining({
        liveActivityId: expect.not.stringMatching(ID),
        liveActivityCommittedAt: NOW,
      }),
    );
  });

  it("replaces a missing activity whose commit time was never recorded", async () => {
    await ensureActivityForFocus({ ...FOCUS, liveActivityId: ID });
    expect(startTripActivity).toHaveBeenCalledTimes(1);
  });

  it("does not treat a failed inventory read as a missing activity", async () => {
    listTripActivityRecords.mockResolvedValue(null);
    await ensureActivityForFocus({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW - 10 * 60_000,
    });
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });

  it("does not respawn a missing activity the user dismissed", async () => {
    await ensureActivityForFocus({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW - 10 * 60_000,
      liveActivityDismissed: true,
    });
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(endTripActivity).not.toHaveBeenCalled();
  });

  it("records a dismissed record so a later purge does not respawn it", async () => {
    const focused = { ...FOCUS, liveActivityId: ID, liveActivityCommittedAt: NOW };
    loadFocusedTrip.mockReturnValue(focused);
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "dismissed" }]);
    await ensureActivityForFocus(focused);
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.objectContaining({ liveActivityId: ID, liveActivityDismissed: true }),
    );
  });

  it("clears a previous dismissal when a new activity is committed", async () => {
    loadFocusedTrip.mockReturnValue({ ...FOCUS, liveActivityDismissed: true });
    await ensureActivityForFocus(FOCUS);
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityDismissed: true }),
    );
  });
});

describe("content updates to a scheduled activity", () => {
  const scheduled = (id: string): FocusedTrip => ({
    ...FOCUS,
    liveActivityId: id,
    liveActivityScheduledFor: NOW + 10 * 60_000,
  });
  const sync = () =>
    syncFocusedActivityContent({ departureAt: DEPARTURE, arrivalAt: ARRIVAL, delayMinutes: 3 });

  it("skips the drift sync while iOS has not started the activity yet", async () => {
    loadFocusedTrip.mockReturnValue(scheduled("trip-7-sync-pending"));
    await sync();
    expect(updateTripActivity).not.toHaveBeenCalled();
  });

  it("syncs once the scheduled start instant has passed", async () => {
    loadFocusedTrip.mockReturnValue(scheduled("trip-7-sync-started"));
    vi.setSystemTime(NOW + 11 * 60_000);
    await sync();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
  });

  it("skips the reminder refresh when the inventory has not listed the pending activity", async () => {
    await ensureActivityForFocus({
      ...scheduled("trip-7-refresh-pending"),
      liveActivityCommittedAt: NOW,
    });
    expect(updateTripActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });
});
