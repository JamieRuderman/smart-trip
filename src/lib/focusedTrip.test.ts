// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import {
  loadFocusedTrip,
  saveFocusedTrip,
  migrateLegacyReminders,
  reconstructFocusedTrip,
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
    expect(typeof m?.reminder?.notificationId).toBe("number");
    expect(m).not.toHaveProperty("departureAt");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
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
