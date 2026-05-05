/**
 * Derive train progress from GPS lat/lng by snapping it onto the rail
 * polyline and locating the result between adjacent stations.
 *
 * Used as a sanity check on top of `scheduledProgress`: when the schedule
 * and GPS disagree by more than a station, the train is probably not where
 * the timetable says it is, so the marker is nudged toward GPS truth. Falls
 * back to `null` whenever the projection is unreliable — schedule and
 * station-midpoint progress handle the rest.
 */

import type { MapTrain } from "@/hooks/useMapTrains";
import {
  railArcToStationIndex,
  snapToRail,
} from "@/lib/railProjection";
import type { TrainProgress } from "@/lib/trainProgress";

/** Drop GPS-driven progress when the train is more than this far from the
 *  rail polyline — likely re-routed, parked off-line, or stale. */
const MAX_RESIDUAL_KM = 0.5;

/** Earth's radius in km (haversine + arc-length scaling). */
export const EARTH_RADIUS_KM = 6371;
/** km per degree of latitude (~constant). */
export const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;

function directionFor(directionId: number | null): "S" | "N" {
  return directionId === 1 ? "N" : "S";
}

/**
 * Compute fractional station index (0 … stations.length-1) from the train's
 * GPS lat/lng. Returns `null` when the projection is unreliable — caller
 * should fall back to schedule/station-midpoint progress.
 */
export function gpsStationProgress(train: MapTrain): TrainProgress | null {
  if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) {
    return null;
  }

  const direction = directionFor(train.directionId);

  const snap = snapToRail(train.latitude, train.longitude);
  if (!snap || snap.residualKm > MAX_RESIDUAL_KM) return null;

  return { progress: railArcToStationIndex(snap.arcKm), direction };
}
