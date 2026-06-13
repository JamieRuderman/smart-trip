import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPlatform = vi.fn(() => "ios");
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => getPlatform() },
}));

const getInfo = vi.fn(async () => ({ osVersion: "17.4" }));
vi.mock("@capacitor/device", () => ({
  Device: { getInfo: () => getInfo() },
}));

const isAvailable = vi.fn(async () => ({ value: true }));
const startActivity = vi.fn(async (opts: unknown) => {
  void opts;
});
const updateActivity = vi.fn(async (opts: unknown) => {
  void opts;
});
const endActivity = vi.fn(async (opts: unknown) => {
  void opts;
});
const listActivities = vi.fn(async () => ({
  items: [{ id: "trip-7-2026-06-09", activityId: "sys-1", state: "active" }],
}));
vi.mock("capacitor-live-activity", () => ({
  LiveActivity: {
    isAvailable: () => isAvailable(),
    startActivity: (opts: unknown) => startActivity(opts),
    updateActivity: (opts: unknown) => updateActivity(opts),
    endActivity: (opts: unknown) => endActivity(opts),
    listActivities: () => listActivities(),
  },
}));

import {
  buildContentState,
  canStartActivity,
  derivePhase,
  deriveStatusText,
  encodeAttributes,
  encodeContentState,
  endTripActivity,
  isLiveActivityAvailable,
  listTripActivities,
  startTripActivity,
  tripActivityId,
  updateTripActivity,
  type TripActivityAttributes,
  type TripActivityContentState,
} from "@/lib/native/liveActivity";
import {
  shouldShowLiveActivity,
  LIVE_ACTIVITY_WINDOW_MS,
} from "@/lib/liveActivityContent";

// Fixed "now": Tue 2026-06-09 08:00 local.
const NOW = new Date(2026, 5, 9, 8, 0, 0, 0).getTime();
const DEP = new Date(2026, 5, 9, 8, 30, 0, 0).getTime(); // 30 min out
const ARR = new Date(2026, 5, 9, 9, 15, 0, 0).getTime(); // 75 min out

const ATTRS: TripActivityAttributes = {
  tripNumber: 7,
  fromStation: "A",
  toStation: "B",
  routeName: "SMART",
  direction: "southbound",
};

function content(over: Partial<TripActivityContentState> = {}): TripActivityContentState {
  return {
    phase: "pre-departure",
    departureEpochMs: DEP,
    arrivalEpochMs: ARR,
    delayMinutes: 0,
    nextStop: null,
    remainingStops: null,
    statusText: "On time",
    isCanceled: false,
    isEnded: false,
    reminderSet: false,
    staleAfterEpochMs: DEP,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getPlatform.mockReturnValue("ios");
  getInfo.mockResolvedValue({ osVersion: "17.4" });
  isAvailable.mockResolvedValue({ value: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("tripActivityId", () => {
  it("is trip/service-date scoped with an unguessable random slug", () => {
    const id = tripActivityId(7, "2026-06-09");
    // Debuggable prefix + ≥10 chars of base36 entropy. The id is a server-side
    // capability (public register/deregister endpoints key on it), so it must
    // not be derivable from the trip + date alone.
    expect(id).toMatch(/^trip-7-2026-06-09-[a-z0-9]{10,}$/);
    expect(tripActivityId(7, "2026-06-09")).not.toBe(id);
  });
});

describe("canStartActivity", () => {
  const base = { platform: "ios", iosMajor: 17, iosMinor: 4, targetEpochMs: DEP, now: NOW };
  it("allows iOS 16.2+ with a future target", () => {
    expect(canStartActivity(base)).toBe(true);
    expect(canStartActivity({ ...base, iosMajor: 16, iosMinor: 2 })).toBe(true);
  });
  it("rejects iOS < 16.2", () => {
    expect(canStartActivity({ ...base, iosMajor: 16, iosMinor: 1 })).toBe(false);
    expect(canStartActivity({ ...base, iosMajor: 15, iosMinor: 9 })).toBe(false);
  });
  it("rejects non-iOS", () => {
    expect(canStartActivity({ ...base, platform: "android" })).toBe(false);
  });
  it("rejects a target already in the past", () => {
    expect(canStartActivity({ ...base, targetEpochMs: NOW - 1 })).toBe(false);
  });
});

describe("shouldShowLiveActivity", () => {
  const base = {
    hasReminder: false,
    departureEpochMs: DEP, // 30 min after NOW → inside the window
    arrivalEpochMs: ARR,
    now: NOW,
  };
  const farFromDeparture = DEP - (LIVE_ACTIVITY_WINDOW_MS + 60_000); // just past the window

  it("shows within the window before departure", () => {
    expect(shouldShowLiveActivity(base)).toBe(true);
  });
  it("hides a far-ahead focus with no reminder", () => {
    expect(shouldShowLiveActivity({ ...base, now: farFromDeparture })).toBe(false);
  });
  it("an armed reminder overrides the window", () => {
    expect(
      shouldShowLiveActivity({ ...base, hasReminder: true, now: farFromDeparture }),
    ).toBe(true);
  });
  it("shows once en route, then stops after arrival", () => {
    expect(shouldShowLiveActivity({ ...base, now: DEP + 1 })).toBe(true);
    expect(shouldShowLiveActivity({ ...base, now: ARR })).toBe(false);
    expect(
      shouldShowLiveActivity({ ...base, hasReminder: true, now: ARR }),
    ).toBe(false);
  });
});

describe("derivePhase", () => {
  it("is pre-departure before departure, en-route after", () => {
    expect(derivePhase({ departureEpochMs: DEP, now: NOW })).toBe("pre-departure");
    expect(derivePhase({ departureEpochMs: DEP, now: DEP })).toBe("en-route");
    expect(derivePhase({ departureEpochMs: DEP, now: DEP + 1 })).toBe("en-route");
  });
});

describe("deriveStatusText", () => {
  it("prioritizes cancelled > ended > delayed > on-time", () => {
    expect(deriveStatusText({ delayMinutes: 5, isCanceled: true, isEnded: false })).toBe("Cancelled");
    expect(deriveStatusText({ delayMinutes: 5, isCanceled: false, isEnded: true })).toBe("Arrived");
    expect(deriveStatusText({ delayMinutes: 4, isCanceled: false, isEnded: false })).toBe("Delayed");
  });
  it("is 'On time' when not late", () => {
    expect(deriveStatusText({ delayMinutes: 0, isCanceled: false, isEnded: false })).toBe("On time");
    expect(deriveStatusText({ delayMinutes: null, isCanceled: false, isEnded: false })).toBe("On time");
  });
});

describe("buildContentState", () => {
  it("derives phase, normalizes null delay, sets the active staleness target", () => {
    const c = buildContentState({
      departureEpochMs: DEP,
      arrivalEpochMs: ARR,
      delayMinutes: null,
      nextStop: "C",
      remainingStops: 3,
      isCanceled: false,
      isEnded: false,
      now: NOW,
    });
    expect(c.phase).toBe("pre-departure");
    expect(c.delayMinutes).toBe(0);
    expect(c.statusText).toBe("On time");
    expect(c.staleAfterEpochMs).toBe(DEP); // pre-departure → departure target
  });
  it("uses the arrival target once en-route", () => {
    const c = buildContentState({
      departureEpochMs: DEP,
      arrivalEpochMs: ARR,
      delayMinutes: 6,
      nextStop: null,
      remainingStops: null,
      isCanceled: false,
      isEnded: false,
      now: DEP + 60_000,
    });
    expect(c.phase).toBe("en-route");
    expect(c.statusText).toBe("Delayed");
    expect(c.staleAfterEpochMs).toBe(ARR);
  });
});

describe("encodeAttributes / encodeContentState", () => {
  it("serializes attributes to a string record", () => {
    expect(encodeAttributes(ATTRS)).toEqual({
      tripNumber: "7",
      fromStation: "A",
      toStation: "B",
      routeName: "SMART",
      direction: "southbound",
    });
  });
  it("serializes content state, mapping null → empty string", () => {
    expect(encodeContentState(content({ nextStop: null, remainingStops: null }))).toMatchObject({
      phase: "pre-departure",
      departureEpochMs: String(DEP),
      arrivalEpochMs: String(ARR),
      delayMinutes: "0",
      nextStop: "",
      remainingStops: "",
      isCanceled: "false",
      isEnded: "false",
      reminderSet: "false",
      staleAfterEpochMs: String(DEP),
    });
    expect(encodeContentState(content({ reminderSet: true }))).toMatchObject({
      reminderSet: "true",
    });
  });
  it("omits staleAfterEpochMs when absent", () => {
    const encoded = encodeContentState(content({ staleAfterEpochMs: undefined }));
    expect(encoded).not.toHaveProperty("staleAfterEpochMs");
  });
});

describe("isLiveActivityAvailable", () => {
  it("is true on iOS when the plugin reports enabled", async () => {
    await expect(isLiveActivityAvailable()).resolves.toBe(true);
  });
  it("is false off-iOS without calling the plugin", async () => {
    getPlatform.mockReturnValue("android");
    await expect(isLiveActivityAvailable()).resolves.toBe(false);
    expect(isAvailable).not.toHaveBeenCalled();
  });
  it("is false when the plugin throws", async () => {
    isAvailable.mockRejectedValue(new Error("boom"));
    await expect(isLiveActivityAvailable()).resolves.toBe(false);
  });
});

describe("startTripActivity", () => {
  const id = tripActivityId(7, "2026-06-09");

  it("starts the activity on iOS with encoded payloads", async () => {
    const c = content();
    const result = await startTripActivity(id, ATTRS, c);
    expect(result).toEqual({ started: true });
    expect(startActivity).toHaveBeenCalledWith({
      id,
      attributes: encodeAttributes(ATTRS),
      contentState: encodeContentState(c),
    });
  });

  it("does not start on a non-iOS platform", async () => {
    getPlatform.mockReturnValue("web");
    const result = await startTripActivity(id, ATTRS, content());
    expect(result).toEqual({ started: false });
    expect(startActivity).not.toHaveBeenCalled();
  });

  it("does not start on iOS < 16.2", async () => {
    getInfo.mockResolvedValue({ osVersion: "15.7" });
    const result = await startTripActivity(id, ATTRS, content());
    expect(result).toEqual({ started: false });
    expect(startActivity).not.toHaveBeenCalled();
  });

  it("does not start when the active target is already past", async () => {
    const past = content({
      phase: "pre-departure",
      departureEpochMs: NOW - 60_000,
    });
    const result = await startTripActivity(id, ATTRS, past);
    expect(result).toEqual({ started: false });
    expect(startActivity).not.toHaveBeenCalled();
  });

  it("does not start when Live Activities are disabled", async () => {
    isAvailable.mockResolvedValue({ value: false });
    const result = await startTripActivity(id, ATTRS, content());
    expect(result).toEqual({ started: false });
    expect(startActivity).not.toHaveBeenCalled();
  });

  it("reports not started when the plugin throws", async () => {
    startActivity.mockRejectedValue(new Error("boom"));
    const result = await startTripActivity(id, ATTRS, content());
    expect(result).toEqual({ started: false });
  });
});

describe("updateTripActivity", () => {
  it("updates with encoded content on iOS", async () => {
    const c = content({ phase: "en-route", delayMinutes: 3, statusText: "Delayed" });
    const result = await updateTripActivity("trip-7-2026-06-09", c);
    expect(result).toEqual({ updated: true });
    expect(updateActivity).toHaveBeenCalledWith({
      id: "trip-7-2026-06-09",
      contentState: encodeContentState(c),
    });
  });
  it("no-ops off-iOS", async () => {
    getPlatform.mockReturnValue("android");
    const result = await updateTripActivity("x", content());
    expect(result).toEqual({ updated: false });
    expect(updateActivity).not.toHaveBeenCalled();
  });
  it("reports not updated when the plugin throws", async () => {
    updateActivity.mockRejectedValue(new Error("boom"));
    await expect(updateTripActivity("x", content())).resolves.toEqual({ updated: false });
  });
});

describe("endTripActivity", () => {
  it("ends immediately on iOS", async () => {
    await endTripActivity("trip-7-2026-06-09");
    expect(endActivity).toHaveBeenCalledWith({
      id: "trip-7-2026-06-09",
      contentState: {},
      dismissalPolicy: "immediate",
    });
  });
  it("renders a final content state when provided", async () => {
    const final = content({ isEnded: true, statusText: "Arrived" });
    await endTripActivity("trip-7-2026-06-09", final);
    expect(endActivity).toHaveBeenCalledWith({
      id: "trip-7-2026-06-09",
      contentState: encodeContentState(final),
      dismissalPolicy: "immediate",
    });
  });
  it("swallows plugin errors", async () => {
    endActivity.mockRejectedValue(new Error("boom"));
    await expect(endTripActivity("x")).resolves.toBeUndefined();
  });
  it("no-ops off-iOS", async () => {
    getPlatform.mockReturnValue("web");
    await endTripActivity("x");
    expect(endActivity).not.toHaveBeenCalled();
  });
});

describe("listTripActivities", () => {
  it("returns the logical ids on iOS", async () => {
    await expect(listTripActivities()).resolves.toEqual(["trip-7-2026-06-09"]);
  });
  it("returns [] off-iOS", async () => {
    getPlatform.mockReturnValue("android");
    await expect(listTripActivities()).resolves.toEqual([]);
    expect(listActivities).not.toHaveBeenCalled();
  });
  it("returns [] when the plugin throws", async () => {
    listActivities.mockRejectedValue(new Error("boom"));
    await expect(listTripActivities()).resolves.toEqual([]);
  });
});
