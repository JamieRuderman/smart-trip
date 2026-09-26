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
const endTripActivity = vi.fn<(id: string) => Promise<void>>(async () => {});
const updateTripActivity = vi.fn(async () => ({ updated: true }));
vi.mock("@/lib/native/liveActivity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/liveActivity")>()),
  listTripActivityRecords: () => listTripActivityRecords(),
  startTripActivity: () => startTripActivity(),
  endTripActivity: (id: string) => endTripActivity(id),
  updateTripActivity: () => updateTripActivity(),
}));

const isLiveActivityPushEnabled = vi.fn(() => false);
const registerPushActivity = vi.fn(async () => false);
const deregisterPushActivity = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock("@/lib/native/liveActivityPush", () => ({
  isLiveActivityPushEnabled: () => isLiveActivityPushEnabled(),
  configureLiveActivityTokenEndpoint: async () => {},
  deregisterPushActivity: (id: string) => deregisterPushActivity(id),
  registerPushActivity: () => registerPushActivity(),
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
  reRegisterPushForFocus,
  reconcileTripActivities,
  syncFocusedActivityContent,
} from "@/lib/liveActivityController";
import { LIVE_ACTIVITY_LEAD_MS } from "@/lib/liveActivityContent";
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

describe("content updates to a scheduled activity", () => {
  const scheduled = (id: string): FocusedTrip => ({
    ...FOCUS,
    liveActivityId: id,
    liveActivityScheduledFor: NOW + 10 * 60_000,
  });

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

describe("a dismissed activity", () => {
  const committed = (id = ID): FocusedTrip => ({
    ...FOCUS,
    liveActivityId: id,
    liveActivityCommittedAt: NOW,
  });
  const dismissed = (id = ID): FocusedTrip => ({ ...committed(id), liveActivityDismissed: true });

  beforeEach(() => isLiveActivityPushEnabled.mockReturnValue(true));
  afterEach(() => saveFocusedTrip.mockReset());

  it("is deregistered when a reconcile first sees it, without re-registering", async () => {
    loadFocusedTrip.mockReturnValue(committed());
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "dismissed" }]);
    await reconcileTripActivities();
    expect(deregisterPushActivity).toHaveBeenCalledTimes(1);
    expect(deregisterPushActivity).toHaveBeenCalledWith(ID);
    expect(registerPushActivity).not.toHaveBeenCalled();
  });

  it("is not deregistered off push builds", async () => {
    isLiveActivityPushEnabled.mockReturnValue(false);
    loadFocusedTrip.mockReturnValue(committed());
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "dismissed" }]);
    await reconcileTripActivities();
    expect(deregisterPushActivity).not.toHaveBeenCalled();
  });

  it("is deregistered only once when another pass already recorded it", async () => {
    loadFocusedTrip.mockReturnValue(dismissed());
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "dismissed" }]);
    await ensureActivityForFocus(committed());
    expect(deregisterPushActivity).not.toHaveBeenCalled();
  });

  it("gets no content refresh on the pass that notes the dismissal", async () => {
    const id = "trip-7-dismissed-noted";
    loadFocusedTrip.mockReturnValue(committed(id));
    listTripActivityRecords.mockResolvedValue([{ id, state: "dismissed" }]);
    await ensureActivityForFocus(committed(id));
    expect(updateTripActivity).not.toHaveBeenCalled();
  });

  it("gets no content refresh when the inventory read fails", async () => {
    listTripActivityRecords.mockResolvedValue(null);
    await ensureActivityForFocus(dismissed("trip-7-dismissed-refresh"));
    expect(updateTripActivity).not.toHaveBeenCalled();
  });

  it("is not re-registered by the launch heal after the OS purges it", async () => {
    loadFocusedTrip.mockReturnValue(dismissed());
    await reconcileTripActivities();
    expect(registerPushActivity).not.toHaveBeenCalled();
    expect(startTripActivity).not.toHaveBeenCalled();
  });

  it("gets no registration or content from the sync tick", async () => {
    loadFocusedTrip.mockReturnValue(dismissed("trip-7-dismissed-sync"));
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
    listTripActivityRecords.mockResolvedValue([{ id: ID, state: "dismissed" }]);
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
