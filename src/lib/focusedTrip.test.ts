// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import {
  loadFocusedTrip,
  saveFocusedTrip,
  FOCUSED_TRIP_STORAGE_KEY,
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
