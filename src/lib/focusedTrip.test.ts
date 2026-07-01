// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import {
  anchorLiveTime,
  loadFocusedTrip,
  saveFocusedTrip,
  migrateLegacyReminders,
  reconstructFocusedTrip,
  focusedArrivalInstant,
  focusedDepartureInstant,
  focusedTripClearInstant,
  FOCUSED_TRIP_STORAGE_KEY,
  type FocusedTrip,
} from "./focusedTrip";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import stations from "@/data/stations";

const FROM = stations[0];
const TO = stations[stations.length - 1];
const SAMPLE = getFilteredTrips(FROM, TO, "weekday")[0];

function makeFocused(overrides: Partial<FocusedTrip> = {}): FocusedTrip {
  return {
    source: "user",
    tripNumber: SAMPLE.trip,
    fromStation: FROM,
    toStation: TO,
    scheduleType: "weekday",
    serviceDate: "2099-01-01",
    reminder: null,
    ...overrides,
  };
}

describe("focusedTrip storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a record (future service date)", () => {
    const f = makeFocused();
    saveFocusedTrip(f);
    expect(loadFocusedTrip()).toEqual(f);
  });

  it("returns null when empty", () => {
    expect(loadFocusedTrip()).toBeNull();
  });

  it("clears a record whose service-date arrival has passed", () => {
    saveFocusedTrip(makeFocused({ serviceDate: "2020-01-01" }));
    expect(loadFocusedTrip()).toBeNull();
    expect(localStorage.getItem(FOCUSED_TRIP_STORAGE_KEY)).toBeNull();
  });

  it("clears a record whose trip is not in the schedule", () => {
    saveFocusedTrip(makeFocused({ tripNumber: 999999 }));
    expect(loadFocusedTrip()).toBeNull();
  });

  it("rejects malformed JSON", () => {
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, "{not json");
    expect(loadFocusedTrip()).toBeNull();
  });

  it("rejects a record missing serviceDate", () => {
    const bad = makeFocused() as unknown as Record<string, unknown>;
    delete bad.serviceDate;
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, JSON.stringify(bad));
    expect(loadFocusedTrip()).toBeNull();
  });

  it("clears when saving null", () => {
    saveFocusedTrip(makeFocused());
    saveFocusedTrip(null);
    expect(loadFocusedTrip()).toBeNull();
  });

  it("round-trips an optional liveActivityId", () => {
    const f = makeFocused({ liveActivityId: "trip-activity-1" });
    saveFocusedTrip(f);
    expect(loadFocusedTrip()).toEqual(f);
  });

  it("rejects a non-string liveActivityId", () => {
    const bad = makeFocused() as unknown as Record<string, unknown>;
    bad.liveActivityId = 123;
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, JSON.stringify(bad));
    expect(loadFocusedTrip()).toBeNull();
  });
});

describe("focusedArrivalInstant / focusedDepartureInstant", () => {
  it("resolves arrival after departure on the same service date", () => {
    const f = makeFocused();
    const dep = focusedDepartureInstant(f);
    const arr = focusedArrivalInstant(f);
    expect(dep).not.toBeNull();
    expect(arr).not.toBeNull();
    // SAMPLE is a normal (non-overnight) daytime run: arrival is after departure.
    expect(arr!).toBeGreaterThan(dep!);
  });

  it("returns null when the trip is no longer in the schedule", () => {
    expect(focusedArrivalInstant(makeFocused({ tripNumber: 999999 }))).toBeNull();
  });
});

describe("focusedTripClearInstant", () => {
  const SCHED = new Date(2026, 5, 9, 9, 24, 0, 0).getTime();
  const GRACE = 2 * 60_000;

  it("clears at scheduled arrival + grace when on time (live == scheduled)", () => {
    expect(
      focusedTripClearInstant({
        scheduledArrivalAt: SCHED,
        liveArrivalAt: SCHED,
        feedLoaded: true,
        graceMs: GRACE,
      }),
    ).toBe(SCHED + GRACE);
  });

  it("waits for live arrival + grace when the train is delayed (no early clear)", () => {
    const late = SCHED + 10 * 60_000;
    expect(
      focusedTripClearInstant({
        scheduledArrivalAt: SCHED,
        liveArrivalAt: late,
        feedLoaded: true,
        graceMs: GRACE,
      }),
    ).toBe(late + GRACE);
  });

  it("never clears before scheduled + grace even if live runs early", () => {
    const early = SCHED - 5 * 60_000;
    expect(
      focusedTripClearInstant({
        scheduledArrivalAt: SCHED,
        liveArrivalAt: early,
        feedLoaded: true,
        graceMs: GRACE,
      }),
    ).toBe(SCHED + GRACE);
  });

  it("falls back to scheduled + grace once the feed is loaded but has no live arrival (train passed the stop)", () => {
    expect(
      focusedTripClearInstant({
        scheduledArrivalAt: SCHED,
        liveArrivalAt: null,
        feedLoaded: true,
        graceMs: GRACE,
      }),
    ).toBe(SCHED + GRACE);
  });

  it("defers (null) when the feed has not loaded yet, so a delayed run isn't cleared early on boot", () => {
    expect(
      focusedTripClearInstant({
        scheduledArrivalAt: SCHED,
        liveArrivalAt: null,
        feedLoaded: false,
        graceMs: GRACE,
      }),
    ).toBeNull();
  });

  it("returns null without a scheduled arrival", () => {
    expect(
      focusedTripClearInstant({
        scheduledArrivalAt: null,
        liveArrivalAt: null,
        feedLoaded: true,
        graceMs: GRACE,
      }),
    ).toBeNull();
  });
});

describe("anchorLiveTime", () => {
  // Static anchor: 2026-06-09 08:30 local.
  const STATIC = new Date(2026, 5, 9, 8, 30, 0, 0).getTime();

  it("anchors a same-day live time onto the static instant's day", () => {
    expect(anchorLiveTime(STATIC, "08:34")).toBe(
      new Date(2026, 5, 9, 8, 34, 0, 0).getTime(),
    );
  });

  it("keeps a live time slightly before the static one on the same day", () => {
    expect(anchorLiveTime(STATIC, "08:28")).toBe(
      new Date(2026, 5, 9, 8, 28, 0, 0).getTime(),
    );
  });

  it("rolls forward when the static instant is just before midnight", () => {
    const lateStatic = new Date(2026, 5, 9, 23, 55, 0, 0).getTime();
    // Live 00:10 belongs to the NEXT calendar day (closest to the anchor).
    expect(anchorLiveTime(lateStatic, "00:10")).toBe(
      new Date(2026, 5, 10, 0, 10, 0, 0).getTime(),
    );
  });

  it("rolls backward when the static instant is just after midnight", () => {
    const overnightStatic = new Date(2026, 5, 10, 0, 5, 0, 0).getTime();
    // Live 23:58 belongs to the PREVIOUS calendar day.
    expect(anchorLiveTime(overnightStatic, "23:58")).toBe(
      new Date(2026, 5, 9, 23, 58, 0, 0).getTime(),
    );
  });

  it("strips schedule markers from the live time", () => {
    expect(anchorLiveTime(STATIC, "08:45*")).toBe(
      new Date(2026, 5, 9, 8, 45, 0, 0).getTime(),
    );
  });
});

describe("reconstructFocusedTrip", () => {
  it("finds the trip for the focused leg + number", () => {
    expect(reconstructFocusedTrip(makeFocused())?.trip).toBe(SAMPLE.trip);
  });

  it("returns null when the trip is gone", () => {
    expect(reconstructFocusedTrip(makeFocused({ tripNumber: 999999 }))).toBeNull();
  });
});

const LEGACY_KEY = "smart-train-departure-reminders";

describe("migrateLegacyReminders", () => {
  beforeEach(() => localStorage.clear());

  it("promotes the most-recent future reminder with serviceDate + notificationId", () => {
    const future = Date.now() + 40 * 60_000;
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          id: 1,
          tripNumber: SAMPLE.trip,
          fromStation: FROM,
          toStation: TO,
          departureAt: future,
          reminderAt: future - 10 * 60_000,
          leadMinutes: 10,
          title: "t",
          body: "b",
        },
      ]),
    );
    const m = migrateLegacyReminders();
    expect(m?.tripNumber).toBe(SAMPLE.trip);
    expect(m?.serviceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Reuses the legacy reminder's own id — that's the id the OS scheduled the
    // pre-upgrade notification under, so keeping it lets Stop/cancel reach it.
    expect(m?.reminder?.notificationId).toBe(1);
    expect(m).not.toHaveProperty("departureAt");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("falls back to a derived id when the legacy reminder lacks one", () => {
    const future = Date.now() + 40 * 60_000;
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          tripNumber: SAMPLE.trip,
          fromStation: FROM,
          toStation: TO,
          departureAt: future,
          reminderAt: future - 10 * 60_000,
          leadMinutes: 10,
          title: "t",
          body: "b",
        },
      ]),
    );
    const m = migrateLegacyReminders();
    expect(typeof m?.reminder?.notificationId).toBe("number");
  });

  it("returns null when all legacy reminders are past", () => {
    const past = Date.now() - 60 * 60_000;
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        { id: 1, tripNumber: 11, fromStation: FROM, toStation: TO, departureAt: past, reminderAt: past, leadMinutes: 5, title: "t", body: "b" },
      ]),
    );
    expect(migrateLegacyReminders()).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("is a no-op without a legacy key", () => {
    expect(migrateLegacyReminders()).toBeNull();
  });
});
