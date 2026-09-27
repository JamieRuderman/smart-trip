import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNow } from "@/hooks/useNow";
import { fetchGtfsRtJson } from "@/lib/gtfsRtFetch";
import { findVehicleRun, type RunKey } from "@/lib/runMatch";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type {
  GtfsRtVehiclePositionsResponse,
  VehiclePositionMatch,
} from "@/types/gtfsRt";

const VEHICLE_POSITIONS_POLL_INTERVAL = 15 * 1000; // 15 seconds
const FEED_STALE_THRESHOLD_SECONDS = 90;  // feed header age
const VEHICLE_STALE_THRESHOLD_SECONDS = 60; // individual vehicle age

/** Raw vehicle positions feed, polled every 15 seconds. Pass `enabled: false`
 *  to keep the hook mounted without fetching/polling (the query key is shared,
 *  so a disabled consumer still sees data another consumer fetched). */
export function useVehiclePositions(enabled = true) {
  return useQuery({
    queryKey: ["gtfsrt", "vehiclepositions"],
    queryFn: () =>
      fetchGtfsRtJson<GtfsRtVehiclePositionsResponse>(
        "/api/gtfsrt/vehiclepositions",
      ),
    refetchInterval: VEHICLE_POSITIONS_POLL_INTERVAL,
    staleTime: 10 * 1000,
    retry: 2,
    enabled,
  });
}

/**
 * Match a specific trip to a vehicle in the positions feed ({@link findVehicleRun}).
 *
 * Freshness policy: returns null if EITHER the feed header is >90s old OR the
 * individual vehicle timestamp is >60s old. Both must be fresh.
 *
 * @param enabled - set false to stop fetching/polling while keeping the hook
 *   mounted (returns null, or a match from data another consumer fetched)
 */
export function useVehiclePositionForTrip(
  run: RunKey,
  enabled = true,
): VehiclePositionMatch | null {
  const { data } = useVehiclePositions(enabled);
  // Freshness clock as a real dependency, NOT Date.now() read inside the
  // memo: when the feed stops delivering (offline, repeated fetch errors)
  // `data` keeps its last identity and a Date.now()-only check would never
  // re-run — the last match would stay "fresh" forever. That matters because
  // consumers use this match to veto trip-ended / focused-trip auto-clear;
  // the veto must lapse once the data genuinely goes stale.
  const nowSeconds = useNow(15_000, enabled);
  const { tripId, originStartTime, serviceDay, directionId } = run;

  return useMemo((): VehiclePositionMatch | null => {
    if (!data) return null;

    // Check feed header freshness
    if (data.timestamp > 0 && nowSeconds - data.timestamp > FEED_STALE_THRESHOLD_SECONDS) {
      return null;
    }

    const vehicle = findVehicleRun(data.vehicles ?? [], {
      tripId,
      originStartTime,
      serviceDay,
      directionId,
    });
    if (!vehicle?.stopId) return null;

    // Check individual vehicle timestamp freshness
    if (vehicle.timestamp != null) {
      const vehicleAge = nowSeconds - vehicle.timestamp;
      if (vehicleAge > VEHICLE_STALE_THRESHOLD_SECONDS) return null;
    }

    return {
      vehicleId: vehicle.vehicleId,
      currentStation: GTFS_STOP_ID_TO_STATION[vehicle.stopId] ?? null,
      currentStatus: vehicle.currentStatus ?? "IN_TRANSIT_TO",
      currentStopSequence: vehicle.currentStopSequence ?? 0,
      position: vehicle.position,
      timestamp: vehicle.timestamp ?? data.timestamp,
    };
  }, [data, tripId, originStartTime, serviceDay, directionId, nowSeconds]);
}
