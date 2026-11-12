import { afterEach, describe, expect, it, vi } from "vitest";
import { hasInAppHistory, shouldOpenTripViewOnLaunch } from "./tripView";
import type { FocusedTrip } from "./focusedTrip";

const NOW = new Date(2026, 9, 6, 8, 30); // Tue Oct 6 2026, 08:30 local

const focus = (serviceDate: string): FocusedTrip => ({
  source: "user",
  tripNumber: 12,
  fromStation: "Petaluma Downtown",
  toStation: "Larkspur",
  scheduleType: "weekday",
  serviceDate,
  reminder: null,
});

describe("shouldOpenTripViewOnLaunch", () => {
  it("opens for a trip running today", () => {
    expect(shouldOpenTripViewOnLaunch(focus("2026-10-06"), "", NOW)).toBe(true);
    expect(
      shouldOpenTripViewOnLaunch(
        focus("2026-10-06"),
        "?from=Petaluma+Downtown&to=Larkspur",
        NOW,
      ),
    ).toBe(true);
  });

  it("stays on the schedule with nothing focused", () => {
    expect(shouldOpenTripViewOnLaunch(null, "", NOW)).toBe(false);
  });

  it("stays on the schedule for a trip on another day", () => {
    expect(shouldOpenTripViewOnLaunch(focus("2026-10-10"), "", NOW)).toBe(false);
  });

  it("lets a shared trip link or dev fixture win", () => {
    expect(
      shouldOpenTripViewOnLaunch(focus("2026-10-06"), "?trip=7&type=weekday", NOW),
    ).toBe(false);
    expect(
      shouldOpenTripViewOnLaunch(focus("2026-10-06"), "?devTrip=delayed", NOW),
    ).toBe(false);
  });
});

describe("hasInAppHistory", () => {
  const atEntry = (state: unknown) => vi.stubGlobal("window", { history: { state } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays in the app only with a router entry behind the current one", () => {
    atEntry({ usr: null, key: "a1b2c3", idx: 2 });
    expect(hasInAppHistory()).toBe(true);
  });

  it("treats a replaced first entry as having nothing behind it", () => {
    atEntry({ usr: null, key: "replaced", idx: 0 });
    expect(hasInAppHistory()).toBe(false);
  });

  it("treats an entry with no router state as the first", () => {
    atEntry(null);
    expect(hasInAppHistory()).toBe(false);
  });
});
