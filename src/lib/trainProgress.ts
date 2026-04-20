/**
 * Derive a fractional station index for a train from its `MapTrain` record.
 *
 * The diagram positions trains along the route by their station-space
 * progress (e.g. 3.4 = 40% of the way from stations[3] → stations[4]).
 * We derive that from `nextStation` + `currentStatus`, falling back to
 * the closest station by lat/lng when the feed omits `nextStation`.
 */

import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";
import stations from "@/data/stations";
import { stationIndexMap, getClosestStation } from "@/lib/stationUtils";

export interface TrainProgress {
  /** Fractional station index, 0 … stations.length - 1. */
  progress: number;
  /** "S" (southbound, idx increasing) or "N" (northbound, idx decreasing). */
  direction: "S" | "N";
}

/**
 * directionId mapping in this app: 0 = southbound, 1 = northbound.
 * `null` direction falls back to the safer southbound default.
 */
function directionFor(directionId: number | null): "S" | "N" {
  return directionId === 1 ? "N" : "S";
}

/**
 * Work out where a train sits along the station list.
 *
 *  - STOPPED_AT nextStation → progress = index of nextStation
 *  - IN_TRANSIT_TO / INCOMING_AT nextStation → progress = index halfway
 *    between the previous stop and nextStation (direction-aware)
 *  - no nextStation → find the closest station to (lat, lng) and treat it
 *    as "just served"
 */
export function trainStationProgress(train: MapTrain): TrainProgress {
  const direction = directionFor(train.directionId);

  let anchor: Station | null = train.nextStation;
  let treatAsServed = train.currentStatus === "STOPPED_AT";

  if (anchor == null) {
    anchor = getClosestStation(train.latitude, train.longitude);
    treatAsServed = true;
  }

  const anchorIdx = stationIndexMap[anchor];
  if (anchorIdx == null) {
    // Should not happen given the Station union, but be defensive.
    return { progress: 0, direction };
  }

  if (treatAsServed) {
    return { progress: anchorIdx, direction };
  }

  // Between previous stop and anchor — render at the midpoint so the dot
  // sits on the track between the two stations.
  const prevIdx =
    direction === "S"
      ? Math.max(0, anchorIdx - 1)
      : Math.min(stations.length - 1, anchorIdx + 1);

  return { progress: (prevIdx + anchorIdx) / 2, direction };
}
