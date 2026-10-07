/**
 * Where the rider's train is along their leg (fromStation → toStation), in
 * station-index space — the coordinate system the line diagram and the My Trip
 * position track share. A fractional index of 3.4 sits 40% of the way from
 * stations[3] to stations[4] (canonical north → south order).
 */
import { STATION_COORDINATES } from "@/data/stations";
import { isSouthbound, stationIndexMap } from "@/lib/stationUtils";
import {
  corridorDistanceKm,
  MAX_ALONG_TRACK_RESIDUAL_KM,
  railArcToStationIndex,
  snapToRail,
} from "@/lib/railProjection";
import { kmToMi } from "@/lib/timeUtils";
import type { VehiclePositionMatch } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

type VehicleFix = Pick<
  VehiclePositionMatch,
  "currentStation" | "currentStatus" | "position"
>;

/**
 * Fractional station index of a live vehicle. The feed's stop + status pins the
 * segment (STOPPED_AT → exactly that stop; in transit → between the previous
 * stop and the next one), and the GPS fix, snapped to the rail, places the
 * train within it. A fix too far off the rail (bad fix, yard move) isn't
 * trusted; then an in-transit train sits mid-segment.
 * Null when the feed names no known stop.
 */
export function vehicleStationIndex(
  vehicle: VehicleFix,
  southbound: boolean,
): number | null {
  const station = vehicle.currentStation;
  if (station == null) return null;
  const nextIdx = stationIndexMap[station];
  if (nextIdx == null) return null;
  if (vehicle.currentStatus === "STOPPED_AT") return nextIdx;

  const prevIdx = southbound ? nextIdx - 1 : nextIdx + 1;
  const lo = Math.min(prevIdx, nextIdx);
  const hi = Math.max(prevIdx, nextIdx);
  const snap = snapToRail(vehicle.position.latitude, vehicle.position.longitude);
  if (snap && snap.residualKm <= MAX_ALONG_TRACK_RESIDUAL_KM) {
    const gpsIdx = railArcToStationIndex(snap.arcKm);
    return Math.min(hi, Math.max(lo, gpsIdx));
  }
  return (prevIdx + nextIdx) / 2;
}

/**
 * How far along the leg a station index is: 0 at the origin, 1 at the
 * destination. Unclamped — negative while the train is still upstream of the
 * origin, above 1 once it's past the destination.
 */
export function legFraction(
  stationIndex: number,
  fromStation: Station,
  toStation: Station,
): number {
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];
  if (fromIdx === toIdx) return 1;
  const fraction = (stationIndex - fromIdx) / (toIdx - fromIdx);
  // A northbound leg divides by a negative span; normalize the -0 at origin.
  return fraction === 0 ? 0 : fraction;
}

/**
 * Whole stops the train still has to make before reaching `fromStation` — 0
 * once it's there (or past it). A train between two stations counts the one
 * it's heading to.
 */
export function stopsUntilOrigin(
  stationIndex: number,
  fromStation: Station,
  southbound: boolean,
): number {
  const fromIdx = stationIndexMap[fromStation];
  const remaining = southbound ? fromIdx - stationIndex : stationIndex - fromIdx;
  // Shave float noise so a train sitting exactly on a stop isn't rounded up.
  return Math.max(0, Math.ceil(remaining - 1e-6));
}

/** Along-track distance (miles) from a vehicle fix to a station. */
export function vehicleDistanceToStationMi(
  vehicle: Pick<VehiclePositionMatch, "position">,
  station: Station,
): number {
  const { lat, lng } = STATION_COORDINATES[station];
  return kmToMi(
    corridorDistanceKm(
      vehicle.position.latitude,
      vehicle.position.longitude,
      lat,
      lng,
    ),
  );
}

/** Where the train is relative to the rider's leg, for the position track. */
export type LegPosition =
  /** No live fix and the train hasn't reached the origin by the timetable. */
  | { phase: "waiting" }
  /** Live: still upstream of the rider's origin — at (`stopped`) or heading
   *  to `station`, `stopsAway` stops and `distanceMi` along the line out. */
  | {
      phase: "approaching";
      station: Station;
      stopped: boolean;
      stopsAway: number;
      distanceMi: number;
    }
  /** Live: stopped at the rider's origin. */
  | { phase: "atOrigin" }
  /** On the leg. `fraction` is 0 at the origin, 1 at the destination. */
  | { phase: "enRoute"; source: "live" | "schedule"; fraction: number }
  | { phase: "arrived" };

/**
 * Resolve the train's position on the leg: a live vehicle fix wins (it can
 * place the train upstream of the origin, too); without one, the timetable
 * estimate is only used once the train has left the origin — before that we
 * can't honestly say where it is.
 */
export function resolveLegPosition({
  fromStation,
  toStation,
  vehicle,
  scheduleIndex,
  departed,
  arrived,
}: {
  fromStation: Station;
  toStation: Station;
  vehicle: VehicleFix | null;
  /** Timetable estimate for now (trainMotion's `scheduledStationIndex`), or
   *  null when unknown. */
  scheduleIndex: number | null;
  /** The train has left the rider's origin by the (live-aware) timetable. */
  departed: boolean;
  /** The rider has reached the destination (or the trip has ended). */
  arrived: boolean;
}): LegPosition {
  if (arrived) return { phase: "arrived" };
  const southbound = isSouthbound(fromStation, toStation);

  const liveIdx = vehicle ? vehicleStationIndex(vehicle, southbound) : null;
  // A live index implies the feed named the vehicle's stop.
  const station = vehicle?.currentStation;
  if (vehicle && station && liveIdx != null) {
    const fraction = legFraction(liveIdx, fromStation, toStation);
    if (fraction > 0 || (fraction === 0 && vehicle.currentStatus !== "STOPPED_AT")) {
      return { phase: "enRoute", source: "live", fraction: Math.min(1, fraction) };
    }
    if (fraction === 0) return { phase: "atOrigin" };
    return {
      phase: "approaching",
      station,
      stopped: vehicle.currentStatus === "STOPPED_AT",
      stopsAway: stopsUntilOrigin(liveIdx, fromStation, southbound),
      distanceMi: vehicleDistanceToStationMi(vehicle, fromStation),
    };
  }

  if (!departed || scheduleIndex == null) return { phase: "waiting" };
  const fraction = legFraction(scheduleIndex, fromStation, toStation);
  return {
    phase: "enRoute",
    source: "schedule",
    fraction: Math.min(1, Math.max(0, fraction)),
  };
}
