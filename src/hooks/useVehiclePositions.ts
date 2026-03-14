import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiBaseUrl } from "@/lib/env";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type {
  GtfsRtVehiclePositionsResponse,
  VehiclePositionMatch,
} from "@/types/gtfsRt";

const VEHICLE_POSITIONS_POLL_INTERVAL = 15 * 1000; // 15 seconds
const FEED_STALE_THRESHOLD_SECONDS = 90;  // feed header age
const VEHICLE_STALE_THRESHOLD_SECONDS = 60; // individual vehicle age

async function fetchVehiclePositions(): Promise<GtfsRtVehiclePositionsResponse> {
  const res = await fetch(`${apiBaseUrl}/api/gtfsrt/vehiclepositions`);
  if (!res.ok) throw new Error(`Vehicle positions fetch failed: ${res.status}`);
  return res.json() as Promise<GtfsRtVehiclePositionsResponse>;
}

/** Raw vehicle positions feed, polled every 15 seconds. */
export function useVehiclePositions() {
  return useQuery({
    queryKey: ["gtfsrt", "vehiclepositions"],
    queryFn: fetchVehiclePositions,
    refetchInterval: VEHICLE_POSITIONS_POLL_INTERVAL,
    staleTime: 10 * 1000,
    retry: 2,
  });
}

/**
 * Match a specific trip to a vehicle in the positions feed.
 *
 * Matching strategy (strict, to avoid false positives):
 *   - vehicle.trip.startDate === startDate
 *   - vehicle.trip.startTime truncated to "HH:MM" === startTime
 *   - vehicle.trip.directionId === directionId
 *   - vehicle must have a stopId (vehicles with coordinates but no stopId are excluded)
 *
 * Freshness policy: returns null if EITHER the feed header is >90s old OR the
 * individual vehicle timestamp is >60s old. Both must be fresh.
 *
 * @param startTime - "HH:MM" origin departure time from the static schedule
 * @param startDate - "YYYYMMDD" service date
 * @param directionId - 0 = southbound, 1 = northbound
 */
export function useVehiclePositionForTrip(
  startTime: string | undefined,
  startDate: string | undefined,
  directionId: number | undefined
): VehiclePositionMatch | null {
  const { data } = useVehiclePositions();

  return useMemo((): VehiclePositionMatch | null => {
    if (!data || startTime == null || startDate == null || directionId == null) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    // Check feed header freshness
    if (data.timestamp > 0 && nowSeconds - data.timestamp > FEED_STALE_THRESHOLD_SECONDS) {
      return null;
    }

    for (const vehicle of data.vehicles ?? []) {
      // Only consider active revenue trips
      if (!vehicle.trip) continue;

      // Must have a stopId — vehicles with only coordinates are not used for progress
      if (!vehicle.stopId) continue;

      // Strict three-part match
      const vehicleStartTimeHHMM = vehicle.trip.startTime.slice(0, 5);
      if (vehicle.trip.startDate !== startDate) continue;
      if (vehicleStartTimeHHMM !== startTime) continue;
      if (vehicle.trip.directionId !== directionId) continue;

      // Check individual vehicle timestamp freshness
      if (vehicle.timestamp != null) {
        const vehicleAge = nowSeconds - vehicle.timestamp;
        if (vehicleAge > VEHICLE_STALE_THRESHOLD_SECONDS) return null;
      }

      // Resolve stopId to a Station name
      const currentStation = GTFS_STOP_ID_TO_STATION[vehicle.stopId] ?? null;

      return {
        vehicleId: vehicle.vehicleId,
        currentStation,
        currentStatus: vehicle.currentStatus ?? "IN_TRANSIT_TO",
        currentStopSequence: vehicle.currentStopSequence ?? 0,
        position: vehicle.position,
        timestamp: vehicle.timestamp ?? data.timestamp,
      };
    }

    return null;
  }, [data, startTime, startDate, directionId]);
}
