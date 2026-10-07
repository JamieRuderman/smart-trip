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
  railArcToStationIndex,
  snapToRail,
} from "@/lib/railProjection";
import { interpolateStationProgress } from "@/lib/trainMotion";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import type { VehiclePositionMatch } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

/** A GPS fix farther than this from the rail polyline isn't trusted to place
 *  the train (bad fix, yard move); fall back to the feed's stop + status. */
const MAX_RAIL_RESIDUAL_KM = 1.5;
const KM_TO_MI = 0.621371;

type VehicleFix = Pick<
  VehiclePositionMatch,
  "currentStation" | "currentStatus" | "position"
>;

/**
 * Fractional station index of a live vehicle. The feed's stop + status pins the
 * segment (STOPPED_AT → exactly that stop; in transit → between the previous
 * stop and the next one), and the GPS fix, snapped to the rail, places the
 * train within it. Without a usable fix an in-transit train sits mid-segment.
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
  if (snap && snap.residualKm <= MAX_RAIL_RESIDUAL_KM) {
    const gpsIdx = railArcToStationIndex(snap.arcKm);
    return Math.min(hi, Math.max(lo, gpsIdx));
  }
  return (prevIdx + nextIdx) / 2;
}

/**
 * Fractional station index the timetable puts the train at, shifted by the
 * current delay. Used when there's no live vehicle fix. `times` is the trip's
 * full per-station "HH:MM" array (canonical order, "~~" where it doesn't stop).
 */
export function scheduleStationIndex(
  times: readonly string[],
  southbound: boolean,
  nowMinutes: number,
  delayMinutes: number,
): number | null {
  const base = times.map((time) => {
    if (!time || time.includes("~~")) return null;
    const minutes = parseTimeToMinutes(time);
    return Number.isFinite(minutes) ? minutes : null;
  });
  const order = [...times.keys()];
  if (!southbound) order.reverse();
  return interpolateStationProgress(base, order, nowMinutes, delayMinutes);
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
  return (
    corridorDistanceKm(
      vehicle.position.latitude,
      vehicle.position.longitude,
      lat,
      lng,
    ) * KM_TO_MI
  );
}

/** Where the train is relative to the rider's leg, for the position track. */
export type LegPosition =
  /** No live fix and the train hasn't reached the origin by the timetable. */
  | { phase: "waiting" }
  /** Live: still upstream of the rider's origin. */
  | { phase: "approaching"; stopsAway: number }
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
  /** {@link scheduleStationIndex} for now, or null when unknown. */
  scheduleIndex: number | null;
  /** The train has left the rider's origin by the (live-aware) timetable. */
  departed: boolean;
  /** The rider has reached the destination (or the trip has ended). */
  arrived: boolean;
}): LegPosition {
  if (arrived) return { phase: "arrived" };
  const southbound = isSouthbound(fromStation, toStation);

  const liveIdx = vehicle ? vehicleStationIndex(vehicle, southbound) : null;
  if (vehicle && liveIdx != null) {
    const fraction = legFraction(liveIdx, fromStation, toStation);
    if (fraction > 0 || (fraction === 0 && vehicle.currentStatus !== "STOPPED_AT")) {
      return { phase: "enRoute", source: "live", fraction: Math.min(1, fraction) };
    }
    if (fraction === 0) return { phase: "atOrigin" };
    return {
      phase: "approaching",
      stopsAway: stopsUntilOrigin(liveIdx, fromStation, southbound),
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
