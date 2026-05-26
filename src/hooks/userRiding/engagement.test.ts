import { describe, expect, it } from "vitest";
import { pickTrainToLatch } from "./engagement";
import type { MapTrain } from "@/hooks/useMapTrains";
import type { TrainTransitionMap, UserSample } from "./types";

// Coordinates near Santa Rosa North — squarely on the SMART rail corridor.
const ON_RAIL = { lat: 38.4661, lng: -122.7268 } as const;
// Roughly 1.4 km south along the rail from ON_RAIL — used to simulate a
// GTFS-RT train marker lagging behind the user's true position.
const SOUTH_OF_RAIL = { lat: 38.4536, lng: -122.7268 } as const;

function makeUser(overrides: Partial<UserSample> = {}): UserSample {
  return {
    lat: ON_RAIL.lat,
    lng: ON_RAIL.lng,
    speedMps: null,
    heading: null,
    nowMs: 1_700_000_000_000,
    ...overrides,
  };
}

function makeTrain(overrides: Partial<MapTrain> = {}): MapTrain {
  return {
    key: "tA",
    vehicleId: "A",
    latitude: ON_RAIL.lat,
    longitude: ON_RAIL.lng,
    bearing: null,
    speed: 15,
    directionId: 0,
    tripLabel: null,
    tripNumber: 1,
    nextStation: null,
    currentStatus: null,
    delayMinutes: null,
    isCanceled: false,
    startTime: null,
    ...overrides,
  };
}

const emptyTransitions: TrainTransitionMap = new Map();

describe("pickTrainToLatch — cold-start fallback", () => {
  it("refuses to latch when the user reports no speed (laptop scenario)", () => {
    // Regression: a desktop browser permanently reports speedMps=null. The
    // old Tier-2 escape hatch would latch any moving train within 900 m.
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: null, heading: null }),
      trains: [makeTrain({ speed: 15 })],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toBeNull();
  });

  it("refuses to latch when the user is stationary (speed=0)", () => {
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 0 }),
      trains: [makeTrain({ speed: 15 })],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toBeNull();
  });

  it("latches a co-located same-direction train when the user is moving", () => {
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 12 }),
      trains: [makeTrain({ key: "tSouth", directionId: 0, speed: 15 })],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toEqual({ key: "tSouth", source: "fallback" });
  });

  it("does not latch a co-located opposite-direction train", () => {
    // User heading south (~180°), train going north (directionId=1).
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 12, heading: 180 }),
      trains: [makeTrain({ key: "tNorth", directionId: 1, speed: 15 })],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when there are no candidate trains", () => {
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 12 }),
      trains: [],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toBeNull();
  });

  it("refuses to latch a moving train near a stationary user (the old Tier-1 trap)", () => {
    // Pre-fix: Tier 1 latched on `userMoving || trainMoving`, so a phone
    // sitting in a house ~100 m from the line latched any train going by.
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 0 }),
      trains: [makeTrain({ speed: 20 })],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toBeNull();
  });

  it("latches a same-direction train ~1.4 km behind when the user is fast (lag-budgeted Tier 2)", () => {
    // At 28 m/s (~62 mph), the 60 s GTFS-RT lag budget widens Tier 2's
    // proximity radius to ~1.68 km — enough to cover a train marker that's
    // ~1.4 km south of the user's true position.
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 28, heading: 180 }),
      trains: [
        makeTrain({
          key: "tLag",
          latitude: SOUTH_OF_RAIL.lat,
          longitude: SOUTH_OF_RAIL.lng,
          directionId: 0,
          speed: 28,
        }),
      ],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toEqual({ key: "tLag", source: "fallback" });
  });

  it("does NOT latch a 1.4 km-distant train when the user is barely moving", () => {
    // Slow user (4 m/s) → lag budget is ~0.24 km, falls below the base
    // 0.9 km radius. A train 1.4 km away stays unmatched.
    const result = pickTrainToLatch({
      user: makeUser({ speedMps: 4, heading: 180 }),
      trains: [
        makeTrain({
          key: "tLag",
          latitude: SOUTH_OF_RAIL.lat,
          longitude: SOUTH_OF_RAIL.lng,
          directionId: 0,
          speed: 4,
        }),
      ],
      transitions: emptyTransitions,
      recentDeparture: null,
    });
    expect(result).toBeNull();
  });
});
