// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import {
  loadFocusedTrip,
  saveFocusedTrip,
  FOCUSED_TRIP_STORAGE_KEY,
  migrateLegacyReminders,
  type FocusedTrip,
} from "./focusedTrip";

const base: FocusedTrip = {
  source: "user",
  tripNumber: 35,
  fromStation: "San Rafael",
  toStation: "Larkspur",
  scheduleType: "weekday",
  departureAt: Date.now() + 30 * 60_000,
  arrivalAt: Date.now() + 50 * 60_000,
  reminder: null,
};

describe("focusedTrip storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a record", () => {
    saveFocusedTrip(base);
    expect(loadFocusedTrip()).toEqual(base);
  });

  it("returns null when empty", () => {
    expect(loadFocusedTrip()).toBeNull();
  });

  it("drops a record whose arrivalAt has passed", () => {
    saveFocusedTrip({ ...base, arrivalAt: Date.now() - 1000 });
    expect(loadFocusedTrip()).toBeNull();
    expect(localStorage.getItem(FOCUSED_TRIP_STORAGE_KEY)).toBeNull();
  });

  it("rejects malformed JSON", () => {
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, "{not json");
    expect(loadFocusedTrip()).toBeNull();
  });

  it("clears when saving null", () => {
    saveFocusedTrip(base);
    saveFocusedTrip(null);
    expect(loadFocusedTrip()).toBeNull();
  });
});

const LEGACY_KEY = "smart-train-departure-reminders";

describe("migrateLegacyReminders", () => {
  beforeEach(() => localStorage.clear());

  it("promotes the most-recent future legacy reminder and deletes the old key", () => {
    const now = Date.now();
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        { id: 1, tripNumber: 11, fromStation: "A", toStation: "B",
          departureAt: now + 10 * 60_000, reminderAt: now + 5 * 60_000,
          leadMinutes: 5, title: "t1", body: "b1" },
        { id: 2, tripNumber: 22, fromStation: "C", toStation: "D",
          departureAt: now + 40 * 60_000, reminderAt: now + 30 * 60_000,
          leadMinutes: 10, title: "t2", body: "b2" },
      ]),
    );
    const migrated = migrateLegacyReminders();
    expect(migrated?.tripNumber).toBe(22); // later departure wins
    expect(migrated?.reminder?.leadMinutes).toBe(10);
    expect(migrated?.arrivalAt).toBe(migrated?.departureAt); // unknown → equals departure
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadFocusedTrip()?.tripNumber).toBe(22);
  });

  it("returns null and deletes the key when all legacy reminders are past", () => {
    const past = Date.now() - 60 * 60_000;
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        { id: 1, tripNumber: 11, fromStation: "A", toStation: "B",
          departureAt: past, reminderAt: past, leadMinutes: 5, title: "t", body: "b" },
      ]),
    );
    expect(migrateLegacyReminders()).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("is a no-op when there is no legacy key", () => {
    expect(migrateLegacyReminders()).toBeNull();
  });
});
