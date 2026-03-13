import type { Station } from "@/types/smartSchedule";

export interface NearestRouteStop {
  station: Station;
  index: number;
  km: number;
}

export function isNearSelectedRoute(routeDistanceKm: number): boolean {
  return routeDistanceKm <= 1.5;
}

export function selectNextStopTarget({
  displayStops,
  currentIndex,
  nearestOnRouteIndex,
  useGpsForProgress,
}: {
  displayStops: Station[];
  currentIndex: number;
  nearestOnRouteIndex: number | null;
  useGpsForProgress: boolean;
}): Station | null {
  if (displayStops.length === 0) return null;

  if (currentIndex === -1) {
    return displayStops[0] ?? null;
  }

  const fallbackIndex = currentIndex;
  if (!useGpsForProgress || nearestOnRouteIndex == null) {
    return displayStops[Math.min(fallbackIndex, displayStops.length - 1)] ?? null;
  }

  const targetIndex = Math.max(fallbackIndex, nearestOnRouteIndex);
  return displayStops[Math.min(targetIndex, displayStops.length - 1)] ?? null;
}
