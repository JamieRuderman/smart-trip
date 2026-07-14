import { stationIndexMap } from "@/lib/stationUtils";
import type { Station } from "@/types/smartSchedule";
import type { VehiclePositionMatch } from "@/types/gtfsRt";

export interface NearestRouteStop {
  station: Station;
  index: number;
  km: number;
}

/**
 * Whether a live-matched vehicle is still short of the rider's destination —
 * i.e. the train demonstrably hasn't finished the trip, regardless of what the
 * clock says. Used to veto time-based "trip ended" / auto-clear decisions for
 * a delayed run whose arrival prediction is missing or stale.
 *
 * True when the vehicle's current stop is strictly before `toStation` in the
 * direction of travel, or is `toStation` itself but the train hasn't stopped
 * there yet (IN_TRANSIT_TO / INCOMING_AT). False once the train is STOPPED_AT
 * the destination, past it (a through train's next stop is outside the leg),
 * unmatched, or the position feed is stale (the hook returns null then), so
 * the normal time-based rules resume.
 */
export function isVehicleShortOfDestination(
  vehicle: Pick<VehiclePositionMatch, "currentStation" | "currentStatus"> | null,
  toStation: Station,
  southbound: boolean,
): boolean {
  if (vehicle == null) return false;
  const station = vehicle.currentStation;
  if (station == null) return false;
  const stationIdx = stationIndexMap[station];
  const toIdx = stationIndexMap[toStation];
  if (stationIdx == null || toIdx == null) return false;
  if (stationIdx === toIdx) return vehicle.currentStatus !== "STOPPED_AT";
  return southbound ? stationIdx < toIdx : stationIdx > toIdx;
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
