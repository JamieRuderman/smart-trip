import { describe, expect, it } from "vitest";
import { isNearSelectedRoute, selectNextStopTarget } from "@/lib/tripProgress";
import type { Station } from "@/types/smartSchedule";

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

  it("starts at the origin before departure", () => {
    expect(
      selectNextStopTarget({
        displayStops: route,
        currentIndex: -1,
        nearestOnRouteIndex: 0,
        useGpsForProgress: true,
      }),
    ).toBe("Larkspur");
  });
});
