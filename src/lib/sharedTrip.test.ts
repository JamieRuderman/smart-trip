import { describe, expect, it } from "vitest";
import { getFilteredTrips } from "./scheduleUtils";
import { reconstructFocusedTrip } from "./focusedTrip";
import {
  matchesSharedDeparture,
  nativeSharedTripLocation,
  parseSharedTrip,
  sharedTripArrival,
  sharedTripServiceDate,
  sharedTripUrl,
} from "./sharedTrip";

describe("shared trip links", () => {
  it("pins a weekend ferry recommendation to the advertised Pacific day and run", () => {
    // Friday evening in Pacific time, Saturday already in UTC.
    const now = new Date("2026-11-14T05:00:00Z");
    const date = sharedTripServiceDate(now, "weekend");
    expect(date).toBe("2026-11-14");

    const trip = getFilteredTrips("Larkspur", "San Rafael", "weekend", true)[0];
    const url = sharedTripUrl(trip, "weekend", date);
    const shared = parseSharedTrip(url.search)!;
    expect(shared.from).toBe("San Francisco");
    expect(shared.to).toBe("San Rafael");
    expect(shared.run.viaFerry).toBe(true);
    expect(reconstructFocusedTrip(shared.run)).toEqual(trip);
    expect(matchesSharedDeparture(shared, trip)).toBe(true);
    expect(matchesSharedDeparture({ ...shared, departure: "00:01" }, trip)).toBe(false);
    expect(matchesSharedDeparture({ ...shared, ferryDeparture: "00:01" }, trip)).toBe(false);
  });

  it("rejects impossible dates and inherited station keys", () => {
    const trip = getFilteredTrips("Windsor", "Larkspur", "weekday")[0];
    const url = sharedTripUrl(trip, "weekday", "2026-11-13");
    url.searchParams.set("date", "2026-02-30");
    expect(parseSharedTrip(url.search)).toBeNull();
    url.searchParams.set("date", "2026-11-13");
    url.searchParams.set("from", "constructor");
    expect(parseSharedTrip(url.search)).toBeNull();
  });

  it("keeps late Pacific arrivals on the right side of midnight", () => {
    expect(sharedTripArrival("2026-11-13", { start: "23:00", end: "23:55" }, "00:05"))
      .toBe(Date.parse("2026-11-14T08:05:00Z"));
    expect(sharedTripArrival("2026-11-01", { start: "07:00", end: "08:00" }, "08:00"))
      .toBe(Date.parse("2026-11-01T16:00:00Z"));
  });

  it("routes only canonical share URLs into the native app", () => {
    expect(nativeSharedTripLocation("https://smarttraintrip.com/share/trip?train=42"))
      .toBe("/share/trip?train=42");
    expect(nativeSharedTripLocation("https://smarttraintrip.com.example/share/trip?train=42"))
      .toBeNull();
    expect(nativeSharedTripLocation("https://smarttraintrip.com/?trip=42")).toBeNull();
  });
});
