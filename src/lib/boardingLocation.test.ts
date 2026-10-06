import { describe, expect, it } from "vitest";

import {
  checkBoardingLocation,
  shouldCheckBoardingLocation,
} from "@/lib/boardingLocation";
import { STATION_COORDINATES } from "@/data/stations";
import type { Station } from "@/types/smartSchedule";

/** A tight GPS fix standing at `station`. */
function at(station: Station, accuracy: number | null = 15) {
  return { ...STATION_COORDINATES[station], accuracy };
}

describe("checkBoardingLocation", () => {
  it("flags a ride home with the stations still in the morning's order", () => {
    // At San Rafael after work, but the trip still reads Petaluma → San Rafael.
    expect(
      checkBoardingLocation(at("San Rafael"), "Petaluma Downtown", "San Rafael"),
    ).toEqual({ kind: "nearDestination" });
  });

  it("flags a reversed trip from a short way off the platform", () => {
    // ~1.5 km from San Rafael station (e.g. at the office), not at it.
    const office = { lat: 37.972, lng: -122.5227 + 0.017, accuracy: 30 };
    expect(
      checkBoardingLocation(office, "Petaluma Downtown", "San Rafael"),
    ).toEqual({ kind: "nearDestination" });
  });

  it("flags a reversed trip between adjacent stations", () => {
    expect(
      checkBoardingLocation(
        at("Santa Rosa Downtown"),
        "Santa Rosa North",
        "Santa Rosa Downtown",
      ),
    ).toEqual({ kind: "nearDestination" });
  });

  it("stays quiet at the departure station", () => {
    expect(
      checkBoardingLocation(at("Petaluma Downtown"), "Petaluma Downtown", "San Rafael"),
    ).toBeNull();
  });

  it("stays quiet at home a few km from the departure station", () => {
    // ~3 km west of Petaluma Downtown: away from every station, so no signal.
    const home = { lat: 38.2373, lng: -122.6691, accuracy: 20 };
    expect(
      checkBoardingLocation(home, "Petaluma Downtown", "San Rafael"),
    ).toBeNull();
  });

  it("stays quiet midway between two close stations", () => {
    const midway = { lat: 38.4464, lng: -122.72915, accuracy: 20 };
    expect(
      checkBoardingLocation(midway, "Santa Rosa North", "Santa Rosa Downtown"),
    ).toBeNull();
  });

  it("names the station the rider is standing at when it isn't the origin", () => {
    expect(
      checkBoardingLocation(at("Petaluma North"), "Petaluma Downtown", "Larkspur"),
    ).toEqual({ kind: "atOtherStation", station: "Petaluma North" });
  });

  it("ignores a coarse fix that can't tell two close stations apart", () => {
    // 1.5 km accuracy against a ~2.3 km gap: could be at either one.
    expect(
      checkBoardingLocation(
        at("Santa Rosa Downtown", 1500),
        "Santa Rosa North",
        "Santa Rosa Downtown",
      ),
    ).toBeNull();
    // Same coarse fix, but the origin is ~25 km away — still clearly reversed.
    expect(
      checkBoardingLocation(
        at("Santa Rosa Downtown", 1500),
        "Petaluma Downtown",
        "Santa Rosa Downtown",
      ),
    ).toEqual({ kind: "nearDestination" });
  });

  it("doesn't claim the rider is at another station on a coarse fix", () => {
    expect(
      checkBoardingLocation(
        at("Petaluma North", 600),
        "Petaluma Downtown",
        "Larkspur",
      ),
    ).toBeNull();
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
