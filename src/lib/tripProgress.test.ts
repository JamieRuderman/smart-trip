import { describe, expect, it } from "vitest";
import {
  isNearSelectedRoute,
  isVehicleShortOfDestination,
  selectNextStopTarget,
} from "@/lib/tripProgress";
import type { Station } from "@/types/smartSchedule";
import type { VehiclePositionMatch, VehicleStopStatus } from "@/types/gtfsRt";

const route: Station[] = [
  "Larkspur",
  "San Rafael",
  "Marin Civic Center",
  "Novato Hamilton",
];

describe("isNearSelectedRoute", () => {
  it("only treats proximity to the selected route as near-route", () => {
    expect(isNearSelectedRoute(1.49)).toBe(true);
    expect(isNearSelectedRoute(1.51)).toBe(false);
  });
});

describe("isVehicleShortOfDestination", () => {
  const vehicle = (
    currentStation: Station | null,
    currentStatus: VehicleStopStatus = "IN_TRANSIT_TO",
  ): Pick<VehiclePositionMatch, "currentStation" | "currentStatus"> => ({
    currentStation,
    currentStatus,
  });

  // The delayed-train scenario: southbound Santa Rosa North → Petaluma North,
  // train still working its way toward Cotati long past its scheduled arrival.
  it("is true while a delayed southbound train is still upstream of the destination", () => {
    expect(
      isVehicleShortOfDestination(vehicle("Cotati"), "Petaluma North", true),
    ).toBe(true);
    expect(
      isVehicleShortOfDestination(
        vehicle("Cotati", "STOPPED_AT"),
        "Petaluma North",
        true,
      ),
    ).toBe(true);
  });

  it("is true while the train is approaching the destination but not stopped there", () => {
    expect(
      isVehicleShortOfDestination(
        vehicle("Petaluma North", "IN_TRANSIT_TO"),
        "Petaluma North",
        true,
      ),
    ).toBe(true);
    expect(
      isVehicleShortOfDestination(
        vehicle("Petaluma North", "INCOMING_AT"),
        "Petaluma North",
        true,
      ),
    ).toBe(true);
  });

  it("is false once the train is stopped at the destination", () => {
    expect(
      isVehicleShortOfDestination(
        vehicle("Petaluma North", "STOPPED_AT"),
        "Petaluma North",
        true,
      ),
    ).toBe(false);
  });

  it("is false once a through train's next stop is past the destination", () => {
    expect(
      isVehicleShortOfDestination(
        vehicle("Petaluma Downtown"),
        "Petaluma North",
        true,
      ),
    ).toBe(false);
  });

  it("respects direction for northbound trips", () => {
    // Northbound San Rafael → Novato Downtown; train heading to Novato Hamilton
    // is still short, while one heading back up at Novato San Marin is past it.
    expect(
      isVehicleShortOfDestination(vehicle("Novato Hamilton"), "Novato Downtown", false),
    ).toBe(true);
    expect(
      isVehicleShortOfDestination(vehicle("Novato San Marin"), "Novato Downtown", false),
    ).toBe(false);
  });

  it("is false without a vehicle match or resolvable station", () => {
    expect(isVehicleShortOfDestination(null, "Petaluma North", true)).toBe(false);
    expect(
      isVehicleShortOfDestination(vehicle(null), "Petaluma North", true),
    ).toBe(false);
  });
});

describe("selectNextStopTarget", () => {
  it("keeps the target on the next upcoming stop when the nearest GPS stop is behind", () => {
    expect(
      selectNextStopTarget({
        displayStops: route,
        currentIndex: 2,
        nearestOnRouteIndex: 1,
        useGpsForProgress: true,
      }),
    ).toBe("Marin Civic Center");
  });

  it("can advance the target forward when GPS shows the rider farther along the route", () => {
    expect(
      selectNextStopTarget({
        displayStops: route,
        currentIndex: 1,
        nearestOnRouteIndex: 2,
        useGpsForProgress: true,
      }),
    ).toBe("Marin Civic Center");
  });

  it("stays anchored to the origin before departure even near a downstream stop", () => {
    expect(
      selectNextStopTarget({
        displayStops: route,
        currentIndex: -1,
        nearestOnRouteIndex: 2,
        useGpsForProgress: true,
      }),
    ).toBe("Larkspur");
  });
});
