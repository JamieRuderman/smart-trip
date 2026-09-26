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
const startTripActivityWithPush = vi.fn(async (id: string) => {
  void id;
  return { started: true };
});
const endTripActivity = vi.fn<(id: string) => Promise<void>>(async () => {});
const updateTripActivity = vi.fn(async () => ({ updated: true }));
vi.mock("@/lib/native/liveActivity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/liveActivity")>()),
  listTripActivityRecords: () => listTripActivityRecords(),
  startTripActivity: (...args: unknown[]) => startTripActivity(...args),
  startTripActivityWithPush: (id: string) => startTripActivityWithPush(id),
  endTripActivity: (id: string) => endTripActivity(id),
  updateTripActivity: () => updateTripActivity(),
}));

const isLiveActivityPushEnabled = vi.fn(() => false);
const registerPushActivity = vi.fn<
  (registration: LiveActivityRegistration) => Promise<boolean>
>(async () => false);
const deregisterPushActivity = vi.fn<(id: string) => Promise<boolean>>(async () => true);
vi.mock("@/lib/native/liveActivityPush", () => ({
  isLiveActivityPushEnabled: () => isLiveActivityPushEnabled(),
  configureLiveActivityTokenEndpoint: async () => {},
  deregisterPushActivity: (id: string) => deregisterPushActivity(id),
  registerPushActivity: (registration: LiveActivityRegistration) =>
    registerPushActivity(registration),
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
  reconstructFocusedTrip: () => TRIP,
  loadFocusedTrip: () => loadFocusedTrip(),
  saveFocusedTrip: (trip: unknown) => saveFocusedTrip(trip),
}));

import {
  ensureActivityForFocus,
  reRegisterPushForFocus,
  reconcileTripActivities,
  replaceFocus,
  syncFocusedActivityContent,
} from "@/lib/liveActivityController";
import { LIVE_ACTIVITY_LEAD_MS } from "@/lib/liveActivityContent";
import type { LiveActivityRegistration } from "@/lib/liveActivityPushTypes";
import { FOCUSED_TRIP_CHANGED_EVENT, type FocusedTrip } from "@/lib/focusedTrip";
import type { ProcessedTrip } from "@/lib/scheduleUtils";

const FOCUS: FocusedTrip = {
  source: "user",
  tripNumber: 7,
  fromStation: "Petaluma Downtown",
  toStation: "Larkspur",
  scheduleType: "weekday",
  serviceDate: "2026-06-09",
  reminder: null,
};
const TRIP: ProcessedTrip = {
  trip: 7,
  tripId: "gtfs-trip-7",
  times: [],
  departureTime: "08:20",
  arrivalTime: "09:20",
  fromStation: "Petaluma Downtown",
  toStation: "Larkspur",
  isValid: true,
};
const ID = "trip-7-2026-06-09-committed";
const sync = () =>
  syncFocusedActivityContent({ departureAt: DEPARTURE, arrivalAt: ARRIVAL, delayMinutes: 3 });

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

describe("push registration", () => {
  it("carries the static schedule's GTFS trip id", async () => {
    isLiveActivityPushEnabled.mockReturnValue(true);
    await ensureActivityForFocus(FOCUS);
    expect(registerPushActivity).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: TRIP.tripId }),
    );
  });
});

describe("content updates to a scheduled activity", () => {
  const scheduled = (id: string): FocusedTrip => ({
    ...FOCUS,
    liveActivityId: id,
    liveActivityScheduledFor: NOW + 10 * 60_000,
  });
  const sync = (delayMinutes = 3) =>
    syncFocusedActivityContent({ departureAt: DEPARTURE, arrivalAt: ARRIVAL, delayMinutes });
  const pastStart = NOW + 11 * 60_000;
  const lateStart = (id: string, records: { id: string; state: string }[] | null) => {
    loadFocusedTrip.mockReturnValue(scheduled(id));
    listTripActivityRecords.mockResolvedValue(records);
    vi.setSystemTime(pastStart);
  };

  it("skips the drift sync while iOS has not started the activity yet", async () => {
    loadFocusedTrip.mockReturnValue(scheduled("trip-7-sync-pending"));
    await sync();
    expect(updateTripActivity).not.toHaveBeenCalled();
    expect(listTripActivityRecords).not.toHaveBeenCalled();
  });

  it("syncs, then drops the start instant, once the inventory shows the activity running", async () => {
    const id = "trip-7-sync-started";
    lateStart(id, [{ id, state: "active" }]);
    await sync();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityScheduledFor: expect.anything() }),
    );
    expect(updateTripActivity.mock.invocationCallOrder[0]).toBeLessThan(
      saveFocusedTrip.mock.invocationCallOrder[0],
    );

    loadFocusedTrip.mockReturnValue(saveFocusedTrip.mock.lastCall![0] as FocusedTrip);
    vi.setSystemTime(pastStart + 5 * 60_000);
    await sync(5);
    expect(updateTripActivity).toHaveBeenCalledTimes(2);
    expect(listTripActivityRecords).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["lists it as pending", (id: string) => [{ id, state: "pending" }]],
    ["does not list it", () => []],
    ["cannot be read", () => null],
  ])("holds content past the start instant while the inventory %s", async (label, records) => {
    const id = `trip-7-sync-held-${label}`;
    lateStart(id, records(id));
    await sync();
    expect(updateTripActivity).not.toHaveBeenCalled();
    expect(saveFocusedTrip).not.toHaveBeenCalled();
  });

  it("reads the inventory at most once a minute while the start is late", async () => {
    const id = "trip-7-sync-backoff";
    lateStart(id, [{ id, state: "pending" }]);
    await sync();
    vi.setSystemTime(pastStart + 30_000);
    await sync();
    expect(listTripActivityRecords).toHaveBeenCalledTimes(1);

    listTripActivityRecords.mockResolvedValue([{ id, state: "active" }]);
    vi.setSystemTime(pastStart + 60_000);
    await sync();
    expect(listTripActivityRecords).toHaveBeenCalledTimes(2);
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
  });

  it("re-reads the inventory when the clock steps back past the last read", async () => {
    const id = "trip-7-sync-clock";
    lateStart(id, [{ id, state: "pending" }]);
    vi.setSystemTime(pastStart + 10 * 60_000);
    await sync();
    vi.setSystemTime(pastStart);
    await sync();
    expect(listTripActivityRecords).toHaveBeenCalledTimes(2);
  });

  it("refreshes a started scheduled activity on ensure and drops its start instant", async () => {
    const id = "trip-7-refresh-started";
    lateStart(id, [{ id, state: "active" }]);
    await ensureActivityForFocus(scheduled(id));
    expect(startTripActivity).not.toHaveBeenCalled();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityScheduledFor: expect.anything() }),
    );
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

  it("drops the start instant once the OS has started the scheduled activity", async () => {
    loadFocusedTrip.mockReturnValue({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityScheduledFor: NOW - 60_000,
    });
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "active" }]);
    await reconcileTripActivities();
    expect(saveFocusedTrip).toHaveBeenCalledTimes(1);
    expect(saveFocusedTrip).toHaveBeenCalledWith(
      expect.not.objectContaining({ liveActivityScheduledFor: expect.anything() }),
    );
    expect(endTripActivity).not.toHaveBeenCalled();
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

describe("a dismissed activity", () => {
  // The controller's dedup/teardown state is module-level, so each test gets an
  // activity id no earlier test has registered, deregistered or closed.
  let seq = 0;
  let id = "";
  const committed = (activityId = id): FocusedTrip => ({
    ...FOCUS,
    liveActivityId: activityId,
    liveActivityCommittedAt: NOW,
  });
  const dismissed = (activityId = id): FocusedTrip => ({
    ...committed(activityId),
    liveActivityDismissed: true,
  });
  const listedDismissed = () =>
    listTripActivityRecords.mockResolvedValue([{ id, state: "dismissed" }]);
  const holdNextRegistration = () => {
    let land!: (accepted: boolean) => void;
    registerPushActivity.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (land = resolve)),
    );
    return (accepted: boolean) => land(accepted);
  };
  const noted = () =>
    vi.waitFor(() =>
      expect(saveFocusedTrip).toHaveBeenCalledWith(
        expect.objectContaining({ liveActivityDismissed: true }),
      ),
    );

  beforeEach(() => {
    id = `trip-7-2026-06-09-dismissed-${++seq}`;
    isLiveActivityPushEnabled.mockReturnValue(true);
  });
  afterEach(() => saveFocusedTrip.mockReset());

  it("is deregistered when a reconcile first sees it, without re-registering", async () => {
    loadFocusedTrip.mockReturnValue(committed());
    listedDismissed();
    await reconcileTripActivities();
    expect(deregisterPushActivity).toHaveBeenCalledTimes(1);
    expect(deregisterPushActivity).toHaveBeenCalledWith(id);
    expect(registerPushActivity).not.toHaveBeenCalled();
  });

  it("is deregistered only after an in-flight registration lands", async () => {
    const land = holdNextRegistration();
    loadFocusedTrip.mockReturnValue(committed());
    await sync();
    listedDismissed();
    const reconciled = reconcileTripActivities();
    await noted();
    expect(deregisterPushActivity).not.toHaveBeenCalled();
    land(true);
    await reconciled;
    expect(deregisterPushActivity).toHaveBeenCalledWith(id);
  });

  it("gets no registration from a stale caller while the deregistration waits", async () => {
    const land = holdNextRegistration();
    loadFocusedTrip.mockReturnValue(committed());
    await sync();
    listedDismissed();
    const reconciled = reconcileTripActivities();
    await noted();
    const stale = reRegisterPushForFocus({ ...committed(), liveActivityScheduledFor: NOW - 1 });
    land(true);
    await Promise.all([reconciled, stale]);
    expect(registerPushActivity).toHaveBeenCalledTimes(1);
  });

  it("is deregistered only after the start's registration lands, and stays dismissed", async () => {
    let stored: FocusedTrip | null = { ...FOCUS };
    loadFocusedTrip.mockImplementation(() => stored);
    saveFocusedTrip.mockImplementation((trip: FocusedTrip | null) => {
      stored = trip;
    });
    const land = holdNextRegistration();
    const starting = ensureActivityForFocus(stored);
    await vi.waitFor(() => expect(registerPushActivity).toHaveBeenCalled());
    id = startTripActivityWithPush.mock.calls[0][0];

    listedDismissed();
    // Queued behind the in-flight start, so nothing is recorded or deregistered yet.
    const reconciled = reconcileTripActivities();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored).not.toMatchObject({ liveActivityDismissed: true });
    expect(deregisterPushActivity).not.toHaveBeenCalled();
    land(true);
    await Promise.all([starting, reconciled]);
    expect(deregisterPushActivity).toHaveBeenCalledWith(id);
    expect(stored).toMatchObject({ liveActivityId: id, liveActivityDismissed: true });
  });

  it("is not deregistered off push builds", async () => {
    isLiveActivityPushEnabled.mockReturnValue(false);
    loadFocusedTrip.mockReturnValue(committed());
    listedDismissed();
    await reconcileTripActivities();
    expect(deregisterPushActivity).not.toHaveBeenCalled();
  });

  it("is not deregistered again once the backend confirmed it", async () => {
    loadFocusedTrip.mockReturnValue(committed());
    listedDismissed();
    await reconcileTripActivities();
    loadFocusedTrip.mockReturnValue(dismissed());
    listTripActivityRecords.mockResolvedValue([]);
    await reconcileTripActivities();
    expect(deregisterPushActivity).toHaveBeenCalledTimes(1);
  });

  it("retries a deregistration the backend did not confirm", async () => {
    deregisterPushActivity.mockResolvedValueOnce(false);
    loadFocusedTrip.mockReturnValue(committed());
    listedDismissed();
    await reconcileTripActivities();
    loadFocusedTrip.mockReturnValue(dismissed());
    listTripActivityRecords.mockResolvedValue([]);
    await reconcileTripActivities();
    expect(deregisterPushActivity).toHaveBeenCalledTimes(2);
  });

  it("does not re-save a dismissal another pass already recorded", async () => {
    loadFocusedTrip.mockReturnValue(dismissed());
    listedDismissed();
    await ensureActivityForFocus(committed());
    expect(saveFocusedTrip).not.toHaveBeenCalled();
  });

  it("gets no content refresh on the pass that notes the dismissal", async () => {
    loadFocusedTrip.mockReturnValue(committed());
    listedDismissed();
    await ensureActivityForFocus(committed());
    expect(updateTripActivity).not.toHaveBeenCalled();
  });

  it("gets no content refresh when the inventory read fails", async () => {
    listTripActivityRecords.mockResolvedValue(null);
    await ensureActivityForFocus(dismissed());
    expect(updateTripActivity).not.toHaveBeenCalled();
  });

  it("is not re-registered by the launch heal after the OS purges it", async () => {
    loadFocusedTrip.mockReturnValue(dismissed());
    await reconcileTripActivities();
    expect(registerPushActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });

  it("gets no registration or content from the sync tick", async () => {
    loadFocusedTrip.mockReturnValue(dismissed());
    await sync();
    expect(registerPushActivity).not.toHaveBeenCalled();
    expect(updateTripActivity).not.toHaveBeenCalled();
  });

  it("is not re-registered when a reminder changes", async () => {
    await reRegisterPushForFocus(dismissed());
    expect(registerPushActivity).not.toHaveBeenCalled();
  });

  it("does not quiet a new activity for a new focus", async () => {
    let stored: FocusedTrip | null = committed();
    loadFocusedTrip.mockImplementation(() => stored);
    saveFocusedTrip.mockImplementation((trip: FocusedTrip | null) => {
      stored = trip;
    });
    listedDismissed();
    await reconcileTripActivities();
    expect(stored).toMatchObject({ liveActivityDismissed: true });

    stored = { ...FOCUS };
    listTripActivityRecords.mockResolvedValue([]);
    await ensureActivityForFocus(stored);
    expect(stored).not.toHaveProperty("liveActivityDismissed");
    await sync();
    expect(registerPushActivity).toHaveBeenCalled();
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
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

  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
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
      const deregister = deferred<boolean>();
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

      deregister.resolve(true);
      await replacing;
      expect(stored).toMatchObject({ tripNumber: 7, liveActivityId: expect.stringMatching(/^trip-7-/) });
      expect(seen.every((s) => s.focus != null)).toBe(true);
    });

    it("dispatches every teardown call before yielding", async () => {
      stored = PREV;
      const replacing = replaceFocus(NEXT);
      expect(cancelNotification).toHaveBeenCalledWith(505);
      expect(cancelLeaveAlarm).toHaveBeenCalledWith("alarm-5");
      expect(endTripActivity).toHaveBeenCalledWith(PREV_ID);
      await replacing;
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
