import { describe, expect, it } from "vitest";

import {
  checkBoardingLocation,
  correctedLeg,
  shouldCheckBoardingLocation,
} from "@/lib/boardingLocation";
import { STATION_COORDINATES } from "@/data/stations";
import type { Station } from "@/types/smartSchedule";

/** A tight GPS fix standing at `station`. */
function at(station: Station, accuracy: number | null = 15) {
  return { ...STATION_COORDINATES[station], accuracy };
}

describe("checkBoardingLocation", () => {
  it("offers a swap on the ride home with the morning's stations still set", () => {
    // At San Rafael after work, but the trip still reads Petaluma → San Rafael.
    expect(
      checkBoardingLocation(at("San Rafael"), "Petaluma Downtown", "San Rafael"),
    ).toEqual({ kind: "nearDestination" });
  });

  it("offers a swap when closest to the destination, not just standing at it", () => {
    // ~1.5 km from San Rafael station (e.g. at the office).
    const office = { lat: 37.972, lng: -122.5227 + 0.017, accuracy: 30 };
    expect(
      checkBoardingLocation(office, "Petaluma Downtown", "San Rafael"),
    ).toEqual({ kind: "nearDestination" });
  });

  it("offers a swap between adjacent stations", () => {
    expect(
      checkBoardingLocation(
        at("Santa Rosa Downtown"),
        "Santa Rosa North",
        "Santa Rosa Downtown",
      ),
    ).toEqual({ kind: "nearDestination" });
  });

  it("names any other station the rider is closest to", () => {
    expect(
      checkBoardingLocation(at("Petaluma North"), "Petaluma Downtown", "Larkspur"),
    ).toEqual({ kind: "nearOtherStation", station: "Petaluma North" });
    // Past the destination: still just "you're closest to Larkspur".
    expect(
      checkBoardingLocation(at("Larkspur"), "Petaluma Downtown", "San Rafael"),
    ).toEqual({ kind: "nearOtherStation", station: "Larkspur" });
  });

  it("stays quiet when closest to the departure station", () => {
    expect(
      checkBoardingLocation(at("Petaluma Downtown"), "Petaluma Downtown", "San Rafael"),
    ).toBeNull();
    // ~3 km west of Petaluma Downtown, e.g. at home: still closest to it.
    const home = { lat: 38.2373, lng: -122.6691, accuracy: 20 };
    expect(
      checkBoardingLocation(home, "Petaluma Downtown", "San Rafael"),
    ).toBeNull();
  });

  it("stays quiet on a fix too coarse to tell which station is closest", () => {
    // ~2.3 km gap to the next station. A 1.5 km error could cross the midpoint
    // (it can shrink the gap by up to 3 km), so say nothing.
    expect(
      checkBoardingLocation(
        at("Santa Rosa Downtown", 1500),
        "Santa Rosa North",
        "Santa Rosa Downtown",
      ),
    ).toBeNull();
    // A 1 km error can shrink it by at most 2 km — still clearly closest.
    expect(
      checkBoardingLocation(
        at("Santa Rosa Downtown", 1000),
        "Santa Rosa North",
        "Santa Rosa Downtown",
      ),
    ).toEqual({ kind: "nearDestination" });
  });

  it("treats an unknown accuracy as a usable fix", () => {
    expect(
      checkBoardingLocation(at("San Rafael", null), "Petaluma Downtown", "San Rafael"),
    ).toEqual({ kind: "nearDestination" });
  });

  it("ignores non-finite coordinates", () => {
    expect(
      checkBoardingLocation(
        { lat: NaN, lng: NaN, accuracy: null },
        "Petaluma Downtown",
        "San Rafael",
      ),
    ).toBeNull();
  });
});

describe("shouldCheckBoardingLocation", () => {
  const now = new Date(2026, 9, 6, 17, 0).getTime();
  const minutes = (n: number) => now + n * 60_000;

  it("checks a train leaving soon", () => {
    expect(shouldCheckBoardingLocation(minutes(20), now)).toBe(true);
    expect(shouldCheckBoardingLocation(minutes(120), now)).toBe(true);
  });

  it("skips a train that has already left (the rider may be on board)", () => {
    expect(shouldCheckBoardingLocation(now, now)).toBe(false);
    expect(shouldCheckBoardingLocation(minutes(-5), now)).toBe(false);
  });

  it("skips a train more than two hours out", () => {
    expect(shouldCheckBoardingLocation(minutes(121), now)).toBe(false);
  });
});

describe("correctedLeg", () => {
  it("swaps the stations when the rider is closest to the destination", () => {
    expect(
      correctedLeg({ kind: "nearDestination" }, "Petaluma Downtown", "San Rafael"),
    ).toEqual({ from: "San Rafael", to: "Petaluma Downtown" });
  });

  it("leaves from the station the rider is closest to, keeping the destination", () => {
    expect(
      correctedLeg(
        { kind: "nearOtherStation", station: "Santa Rosa North" },
        "Santa Rosa Downtown",
        "Larkspur",
      ),
    ).toEqual({ from: "Santa Rosa North", to: "Larkspur" });
  });
});
