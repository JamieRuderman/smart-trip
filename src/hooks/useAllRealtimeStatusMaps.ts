import { useMemo } from "react";
import stations from "@/data/stations";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import {
  useTripRealtimeStatusMap,
  type TripRealtimeStatusMaps,
} from "@/hooks/useTripUpdates";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];

export interface AllRealtimeStatusMaps {
  /** Status maps for southbound (Windsor → Larkspur) trips, weekday + weekend. */
  sb: TripRealtimeStatusMaps;
  /** Status maps for northbound (Larkspur → Windsor) trips, weekday + weekend. */
  nb: TripRealtimeStatusMaps;
}

/**
 * Build realtime status maps spanning *all* full-corridor trips in both
 * directions and both schedule types. Used by the Map and MapDiagram pages so
 * a tapped train of any direction can surface live delay / cancellation state
 * in the trip detail sheet — keyed by the full-corridor scheduled departure
 * (origin time), which is what `useTripRealtimeStatusMap` already keys by.
 *
 * Centralising the call also keeps Map.tsx and MapDiagram.tsx in lockstep on
 * how the all-corridor status maps are assembled.
 */
export function useAllRealtimeStatusMaps(): AllRealtimeStatusMaps {
  const allSouthboundTrips = useMemo(
    () => [
      ...getFilteredTrips(WINDSOR, LARKSPUR, "weekday"),
      ...getFilteredTrips(WINDSOR, LARKSPUR, "weekend"),
    ],
    [],
  );
  const allNorthboundTrips = useMemo(
    () => [
      ...getFilteredTrips(LARKSPUR, WINDSOR, "weekday"),
      ...getFilteredTrips(LARKSPUR, WINDSOR, "weekend"),
    ],
    [],
  );
  const sb = useTripRealtimeStatusMap(WINDSOR, LARKSPUR, allSouthboundTrips);
  const nb = useTripRealtimeStatusMap(LARKSPUR, WINDSOR, allNorthboundTrips);
  return { sb, nb };
}
