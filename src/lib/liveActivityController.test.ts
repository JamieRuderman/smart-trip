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
const startTripActivityWithPush = vi.fn(async (id: string) => {
  void id;
  return { started: true };
});
const endTripActivity = vi.fn<(id: string) => Promise<void>>(async () => {});
const updateTripActivity = vi.fn(async () => ({ updated: true }));
vi.mock("@/lib/native/liveActivity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/liveActivity")>()),
  listTripActivityRecords: () => listTripActivityRecords(),
  startTripActivity: () => startTripActivity(),
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
  syncFocusedActivityContent,
} from "@/lib/liveActivityController";
import { LIVE_ACTIVITY_LEAD_MS } from "@/lib/liveActivityContent";
import type { LiveActivityRegistration } from "@/lib/liveActivityPushTypes";
import type { FocusedTrip } from "@/lib/focusedTrip";
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
    expect(updateTripActivity).toHaveBeenCalledTimes(1);
  });

  it("replaces a missing activity whose commit time is in the future", async () => {
    await ensureActivityForFocus({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityCommittedAt: NOW + 60 * 60_000,
    });
    expect(startTripActivity).toHaveBeenCalledTimes(1);
  });

  it("replaces a pending activity whose start instant moved", async () => {
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "pending" }]);
    await ensureActivityForFocus({
      ...FOCUS,
      liveActivityId: ID,
      liveActivityScheduledFor: NOW + 5 * 60_000,
    });
    expect(endTripActivity).toHaveBeenCalledWith(ID);
    expect(startTripActivity).toHaveBeenCalledTimes(1);
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
    await ensureActivityForFocus({
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
    const reconciled = reconcileTripActivities();
    await vi.waitFor(() => expect(stored).toMatchObject({ liveActivityDismissed: true }));
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
