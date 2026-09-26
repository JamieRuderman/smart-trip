import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "ios", isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));
const cancelLeaveAlarm = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock("@/lib/native/leaveAlarm", () => ({
  cancelLeaveAlarm: (id: string) => cancelLeaveAlarm(id),
  scheduleLeaveAlarm: async () => null,
}));
const cancelNotification = vi.fn<(id: number) => Promise<void>>(async () => {});
vi.mock("@/lib/notificationScheduler", () => ({
  cancelNotification: (id: number) => cancelNotification(id),
  ensureNotificationPermission: async () => false,
  scheduleNotification: async () => {},
}));

const listTripActivityRecords = vi.fn(
  async (): Promise<{ id: string; state: string }[] | null> => [],
);
const startTripActivity = vi.fn<(...args: unknown[]) => Promise<{ started: boolean }>>(
  async () => ({ started: true }),
);
const endTripActivity = vi.fn<(id: string) => Promise<void>>(async () => {});
const updateTripActivity = vi.fn(async () => ({ updated: true }));
vi.mock("@/lib/native/liveActivity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/liveActivity")>()),
  listTripActivityRecords: () => listTripActivityRecords(),
  startTripActivity: (...args: unknown[]) => startTripActivity(...args),
  endTripActivity: (id: string) => endTripActivity(id),
  updateTripActivity: () => updateTripActivity(),
}));

const isLiveActivityPushEnabled = vi.fn(() => false);
const deregisterPushActivity = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock("@/lib/native/liveActivityPush", () => ({
  isLiveActivityPushEnabled: () => isLiveActivityPushEnabled(),
  configureLiveActivityTokenEndpoint: async () => {},
  deregisterPushActivity: (id: string) => deregisterPushActivity(id),
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
  reconcileTripActivities,
  replaceFocus,
  syncFocusedActivityContent,
} from "@/lib/liveActivityController";
import { LIVE_ACTIVITY_LEAD_MS } from "@/lib/liveActivityContent";
import { FOCUSED_TRIP_CHANGED_EVENT, type FocusedTrip } from "@/lib/focusedTrip";

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

const ensureStored = (focused: FocusedTrip) => {
  loadFocusedTrip.mockReturnValue(focused);
  return ensureActivityForFocus(focused);
};

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
    await ensureStored({ ...FOCUS, liveActivityId: ID });
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
  });

  it("ends a locally auto-dismissed `ended` activity and restarts it", async () => {
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "ended" }]);
    await ensureStored({ ...FOCUS, liveActivityId: ID });
    expect(endTripActivity).toHaveBeenCalledWith(ID);
    expect(startTripActivity).toHaveBeenCalledTimes(1);
    expect(endTripActivity.mock.invocationCallOrder[0]).toBeLessThan(
      startTripActivity.mock.invocationCallOrder[0],
    );
  });

  it("treats `ended` as deliberate on push builds and does not restart", async () => {
    isLiveActivityPushEnabled.mockReturnValue(true);
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "ended" }]);
    await ensureStored({ ...FOCUS, liveActivityId: ID });
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });

  it("trusts a just-committed id the OS inventory does not list yet", async () => {
    await ensureStored({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW - 30_000,
    });
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(endTripActivity).not.toHaveBeenCalled();
  });

  it("replaces an activity that has been missing past the grace window", async () => {
    await ensureStored({
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

  it("releases a vanished id when its replacement does not start", async () => {
    const focused = { ...FOCUS, liveActivityId: ID, liveActivityCommittedAt: NOW - 10 * 60_000 };
    loadFocusedTrip.mockReturnValue(focused);
    startTripActivity.mockResolvedValueOnce({ started: false });
    await ensureActivityForFocus(focused);
    expect(saveFocusedTrip).toHaveBeenCalledTimes(1);
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityId: expect.anything() }),
    );
  });

  it("replaces a missing activity whose commit time was never recorded", async () => {
    await ensureStored({ ...FOCUS, liveActivityId: ID });
    expect(startTripActivity).toHaveBeenCalledTimes(1);
  });

  it("does not treat a failed inventory read as a missing activity", async () => {
    listTripActivityRecords.mockResolvedValue(null);
    await ensureStored({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW - 10 * 60_000,
    });
    expect(endTripActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
  });

  it("replaces a missing activity whose commit time is in the future", async () => {
    await ensureStored({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW + 60 * 60_000,
    });
    expect(startTripActivity).toHaveBeenCalledTimes(1);
  });

  it("replaces a pending activity whose start instant moved", async () => {
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "pending" }]);
    await ensureStored({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityScheduledFor: NOW + 5 * 60_000,
    });
    expect(endTripActivity).toHaveBeenCalledWith(ID);
    expect(startTripActivity).toHaveBeenCalledTimes(1);
  });

  it("does not respawn a missing activity the user dismissed", async () => {
    await ensureStored({
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
    await ensureStored({
      ...scheduled("trip-7-refresh-pending"),
      liveActivityCommittedAt: NOW,
    });
    expect(updateTripActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });
});

describe("reconcileTripActivities adoption", () => {
  it("keeps the scheduled start when adopting an uncommitted pending activity", async () => {
    listTripActivityRecords.mockResolvedValue([
      { id: "trip-7-2026-06-09-adopted", state: "pending" },
    ]);
    await reconcileTripActivities();
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.objectContaining({
        liveActivityId: "trip-7-2026-06-09-adopted",
        liveActivityScheduledFor: DEPARTURE - LIVE_ACTIVITY_LEAD_MS,
      }),
    );
  });

  it("does not carry a previous activity's dismissal onto an adopted one", async () => {
    loadFocusedTrip.mockReturnValue({
      ...FOCUS,
      liveActivityId: "trip-7-2026-06-09-gone",
      liveActivityDismissed: true,
    });
    listTripActivityRecords.mockResolvedValue([
      { id: "trip-7-2026-06-09-running", state: "active" },
    ]);
    await reconcileTripActivities();
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.objectContaining({ liveActivityId: "trip-7-2026-06-09-running" }),
    );
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityDismissed: true }),
    );
  });

  it("adopts a running activity without a scheduled start", async () => {
    listTripActivityRecords.mockResolvedValue([
      { id: "trip-7-2026-06-09-running", state: "active" },
    ]);
    await reconcileTripActivities();
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityScheduledFor: expect.anything() }),
    );
  });
});

describe("focus switching", () => {
  let stored: FocusedTrip | null = null;

  const NEXT = FOCUS;
  const PREV_ID = "trip-5-2026-06-09-previous";
  const PREV: FocusedTrip = {
    ...NEXT,
    tripNumber: 5,
    liveActivityId: PREV_ID,
    reminder: {
      leadMinutes: 5,
      reminderAt: NOW + 10 * 60_000,
      notificationId: 505,
      alarmId: "alarm-5",
      title: "Leave for train 5",
      body: "",
    },
  };
  const SAME_RUN_ID = "trip-7-2026-06-09-previous";
  const SAME_RUN_PREV: FocusedTrip = {
    ...NEXT,
    toStation: "San Rafael",
    liveActivityId: SAME_RUN_ID,
  };

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function holdTeardownOf(prev: FocusedTrip) {
    stored = prev;
    const end = deferred();
    endTripActivity.mockReturnValueOnce(end.promise);
    return end;
  }

  function holdNextStart() {
    const start = deferred();
    startTripActivity.mockReturnValueOnce(start.promise.then(() => ({ started: true })));
    return start;
  }

  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubGlobal("window", new EventTarget());
    stored = null;
    loadFocusedTrip.mockImplementation(() => stored);
    saveFocusedTrip.mockImplementation((trip: FocusedTrip | null) => {
      stored = trip;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe("replaceFocus", () => {
    it("announces the new focus before tearing down the previous one", async () => {
      isLiveActivityPushEnabled.mockReturnValue(true);
      const deregister = deferred();
      deregisterPushActivity.mockReturnValue(deregister.promise);
      stored = PREV;
      const seen: { focus: FocusedTrip | null; tornDown: boolean }[] = [];
      window.addEventListener(FOCUSED_TRIP_CHANGED_EVENT, () => {
        seen.push({
          focus: stored,
          tornDown:
            cancelNotification.mock.calls.length > 0 || endTripActivity.mock.calls.length > 0,
        });
      });

      const replacing = replaceFocus(NEXT);
      expect(seen).toEqual([{ focus: NEXT, tornDown: false }]);

      await flush();
      expect(cancelNotification).toHaveBeenCalledWith(505);
      expect(cancelLeaveAlarm).toHaveBeenCalledWith("alarm-5");
      expect(endTripActivity).toHaveBeenCalledWith(PREV_ID);
      expect(deregisterPushActivity).toHaveBeenCalledWith(PREV_ID);
      expect(stored).toBe(NEXT);

      deregister.resolve();
      await replacing;
      expect(stored).toMatchObject({ tripNumber: 7, liveActivityId: expect.stringMatching(/^trip-7-/) });
      expect(seen.every((s) => s.focus != null)).toBe(true);
    });

    it("starts the new activity only after the previous one is ended", async () => {
      stored = PREV;
      await replaceFocus(NEXT);
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(endTripActivity.mock.invocationCallOrder[0]).toBeLessThan(
        startTripActivity.mock.invocationCallOrder[0],
      );
    });

    it("starts from the re-read focus so a reminder armed meanwhile is included", async () => {
      const end = holdTeardownOf(PREV);
      const replacing = replaceFocus(NEXT);
      const reminder = { ...PREV.reminder!, notificationId: 707, reminderAt: NOW + 12 * 60_000 };
      stored = { ...NEXT, reminder };
      end.resolve();
      await replacing;
      expect(startTripActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({ reminderSet: true, reminderEpochMs: reminder.reminderAt }),
      );
      expect(stored).toMatchObject({ reminder });
    });

    it("does not start an activity for a focus replaced during the teardown", async () => {
      const end = holdTeardownOf(PREV);
      const first = replaceFocus(NEXT);
      await replaceFocus({ ...NEXT, tripNumber: 9 });
      end.resolve();
      await first;
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(stored).toMatchObject({ tripNumber: 9, liveActivityId: expect.stringMatching(/^trip-9-/) });
    });

    it("clears before tearing down, and a clear still tearing down keeps a newer focus", async () => {
      const end = holdTeardownOf(PREV);
      const clearing = replaceFocus(null);
      expect(stored).toBeNull();

      await replaceFocus(NEXT);
      end.resolve();
      await clearing;
      expect(cancelNotification).toHaveBeenCalledWith(505);
      expect(endTripActivity).toHaveBeenCalledWith(PREV_ID);
      expect(stored).toMatchObject({ tripNumber: 7, liveActivityId: expect.stringMatching(/^trip-7-/) });
    });
  });

  describe("concurrent activity starts", () => {
    it("joins a reminder-arm start still in flight when the teardown finishes", async () => {
      const end = holdTeardownOf(PREV);
      const replacing = replaceFocus(NEXT);
      const start = holdNextStart();
      const ensuring = ensureActivityForFocus(NEXT);
      await flush();
      expect(startTripActivity).toHaveBeenCalledTimes(1);

      end.resolve();
      await flush();
      start.resolve();
      await Promise.all([replacing, ensuring]);
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(stored?.liveActivityId).toMatch(/^trip-7-/);
    });

    it("refreshes rather than restarts when a reminder armed mid-start queues behind it", async () => {
      listTripActivityRecords.mockImplementation(async () =>
        stored?.liveActivityId ? [{ id: stored.liveActivityId, state: "active" }] : [],
      );
      const start = holdNextStart();
      const replacing = replaceFocus(NEXT);
      await flush();
      stored = { ...NEXT, reminder: PREV.reminder };
      const ensuring = ensureActivityForFocus(stored);
      await flush();

      start.resolve();
      await Promise.all([replacing, ensuring]);
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(updateTripActivity).toHaveBeenCalledTimes(1);
      expect(stored).toMatchObject({ reminder: PREV.reminder, liveActivityId: expect.stringMatching(/^trip-7-/) });
    });
  });

  describe("reconcile during a focus switch", () => {
    it("queues behind the switch's start instead of starting its own", async () => {
      listTripActivityRecords.mockImplementation(async () =>
        stored?.liveActivityId ? [{ id: stored.liveActivityId, state: "active" }] : [],
      );
      const start = holdNextStart();
      const replacing = replaceFocus(NEXT);
      await flush();
      const reconciling = reconcileTripActivities();
      await flush();

      start.resolve();
      await Promise.all([replacing, reconciling]);
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(endTripActivity).not.toHaveBeenCalled();
    });

    it("does not adopt the old activity of a same-run re-focus", async () => {
      const end = holdTeardownOf(SAME_RUN_PREV);
      listTripActivityRecords.mockResolvedValue([{ id: SAME_RUN_ID, state: "active" }]);
      const replacing = replaceFocus(NEXT);
      await flush();

      await reconcileTripActivities();
      expect(saveFocusedTrip).not.toHaveBeenCalledWith(
        expect.objectContaining({ liveActivityId: SAME_RUN_ID }),
      );
      expect(endTripActivity).toHaveBeenCalledTimes(2);
      expect(endTripActivity).toHaveBeenLastCalledWith(SAME_RUN_ID);

      end.resolve();
      await replacing;
      expect(stored?.liveActivityId).toMatch(/^trip-7-2026-06-09-/);
      expect(stored?.liveActivityId).not.toBe(SAME_RUN_ID);
    });

    it("does not start a second activity when the reconcile already started one", async () => {
      const end = holdTeardownOf(PREV);
      listTripActivityRecords.mockResolvedValue([{ id: PREV_ID, state: "active" }]);
      const replacing = replaceFocus(NEXT);
      await flush();
      expect(endTripActivity).toHaveBeenCalledWith(PREV_ID);

      await reconcileTripActivities();
      const committed = stored?.liveActivityId;
      expect(committed).toMatch(/^trip-7-/);

      end.resolve();
      await replacing;
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(stored?.liveActivityId).toBe(committed);
    });

    it("still adopts a same-run activity that was not retired", async () => {
      const fresh = "trip-7-2026-06-09-fresh";
      listTripActivityRecords.mockResolvedValue([{ id: fresh, state: "active" }]);
      stored = NEXT;
      await reconcileTripActivities();
      expect(stored?.liveActivityId).toBe(fresh);
      expect(endTripActivity).not.toHaveBeenCalled();
      expect(startTripActivity).not.toHaveBeenCalled();
    });

    it("does not save the old focus back when the switch lands during its inventory read", async () => {
      const list = deferred();
      listTripActivityRecords.mockImplementationOnce(async () => {
        await list.promise;
        return [{ id: PREV_ID, state: "active" }];
      });
      stored = { ...PREV, liveActivityScheduledFor: NOW - 60_000 };
      const reconciling = reconcileTripActivities();
      await flush();
      const replacing = replaceFocus(NEXT);
      list.resolve();
      await Promise.all([reconciling, replacing]);
      expect(stored?.tripNumber).toBe(7);
      expect(startTripActivity).toHaveBeenCalledTimes(1);
      expect(saveFocusedTrip).not.toHaveBeenCalledWith(
        expect.objectContaining({ tripNumber: 5 }),
      );
    });
  });
});
