import stations from "@/data/stations";
import { getClosestStation, stationIndexMap } from "@/lib/stationUtils";
import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];

/**
 * Pick the timeline's "from" station for a tapped train so only upcoming
 * stops appear (plus one previous stop for the current-station highlight).
 *
 * Guarantees the returned station is not the terminus — a zero-length
 * fromStation→toStation range breaks downstream direction/progress
 * inference (notably southbound trains stopped at Larkspur).
 */
export function pickDisplayFromStation(
  train: MapTrain,
  isSouthbound: boolean,
): Station {
  const origin = isSouthbound ? WINDSOR : LARKSPUR;
  const terminus = isSouthbound ? LARKSPUR : WINDSOR;
  const terminusIdx = stationIndexMap[terminus];
  let anchorStation: Station | null = train.nextStation;
  let treatAsServed = train.currentStatus === "STOPPED_AT";
  if (anchorStation == null) {
    anchorStation = getClosestStation(train.latitude, train.longitude);
    treatAsServed = true;
  }
  const anchorIdx = stationIndexMap[anchorStation];
  if (anchorIdx == null) return origin;
  const upcomingIdx = treatAsServed
    ? isSouthbound
      ? anchorIdx + 1
      : anchorIdx - 1
    : anchorIdx;
  const displayFromIdx = isSouthbound ? upcomingIdx - 1 : upcomingIdx + 1;

  const pick = (idx: number): Station | null =>
    idx >= 0 && idx < stations.length && idx !== terminusIdx
      ? stations[idx]
      : null;

  return (
    pick(displayFromIdx) ??
    pick(upcomingIdx) ??
    // Last resort: one stop short of the terminus so the trip range is
    // always non-zero-length.
    stations[isSouthbound ? terminusIdx - 1 : terminusIdx + 1] ??
    origin
  );
}
