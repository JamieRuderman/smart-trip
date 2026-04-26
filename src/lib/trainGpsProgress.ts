/**
 * Derive train progress from GPS lat/lng by projecting onto the segment
 * between the previous and next station.
 *
 * Used as a sanity check on top of `scheduledProgress`: when the schedule
 * and GPS disagree by more than a station, the train is probably not where
 * the timetable says it is, so the marker is nudged toward GPS truth. Falls
 * back to `null` whenever it can't get a clean projection — schedule and
 * station-midpoint progress handle the rest.
 */

import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";
import stations, { STATION_COORDINATES } from "@/data/stations";
import { stationIndexMap } from "@/lib/stationUtils";
import type { TrainProgress } from "@/lib/trainProgress";

/** Drop GPS-driven progress when the train is more than this far from the
 *  inter-station segment — likely re-routed, parked off-line, or stale. */
const MAX_RESIDUAL_KM = 1.5;

/** Earth's radius in km (haversine + arc-length scaling). */
const EARTH_RADIUS_KM = 6371;
/** km per degree of latitude (~constant). */
const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;

function directionFor(directionId: number | null): "S" | "N" {
  return directionId === 1 ? "N" : "S";
}

/** Resolve the station the train is heading away from given the anchor and
 *  direction. Returns -1 when the anchor is the corridor terminal in this
 *  direction (no "previous" segment). */
function previousIndex(anchorIdx: number, direction: "S" | "N"): number {
  if (direction === "S") {
    return anchorIdx >= 1 ? anchorIdx - 1 : -1;
  }
  return anchorIdx <= stations.length - 2 ? anchorIdx + 1 : -1;
}

/**
 * Compute fractional station index (0 … stations.length-1) from the train's
 * GPS lat/lng. Returns `null` when the projection is unreliable — caller
 * should fall back to schedule/station-midpoint progress.
 */
export function gpsStationProgress(train: MapTrain): TrainProgress | null {
  if (
    !Number.isFinite(train.latitude) ||
    !Number.isFinite(train.longitude) ||
    train.directionId == null
  ) {
    return null;
  }

  const direction = directionFor(train.directionId);

  // STOPPED_AT s — snap to that station, no GPS projection (parked GPS drifts).
  if (train.currentStatus === "STOPPED_AT" && train.nextStation != null) {
    const idx = stationIndexMap[train.nextStation];
    return idx == null ? null : { progress: idx, direction };
  }

  // In-transit projection requires nextStation; without it bail.
  const nextStation: Station | null = train.nextStation;
  if (nextStation == null) return null;
  const nextIdx = stationIndexMap[nextStation];
  if (nextIdx == null) return null;
  const prevIdx = previousIndex(nextIdx, direction);
  if (prevIdx < 0) return null;

  const prev = STATION_COORDINATES[stations[prevIdx]];
  const next = STATION_COORDINATES[stations[nextIdx]];

  // Equirectangular projection scaled by cos(meanLat) — error <15 m at SMART
  // corridor scale. Components are in km so we can residual-check directly.
  const latRefRad = ((prev.lat + next.lat) / 2) * (Math.PI / 180);
  const kxKm = Math.cos(latRefRad) * KM_PER_DEG_LAT;
  const kyKm = KM_PER_DEG_LAT;

  const ax = (next.lng - prev.lng) * kxKm;
  const ay = (next.lat - prev.lat) * kyKm;
  const bx = (train.longitude - prev.lng) * kxKm;
  const by = (train.latitude - prev.lat) * kyKm;

  const segLen2 = ax * ax + ay * ay;
  if (segLen2 <= 0) return null;

  const tRaw = (ax * bx + ay * by) / segLen2;
  const t = Math.max(0, Math.min(1, tRaw));

  // Perpendicular residual (km) from the GPS point to the segment line.
  // |b - t·a| in km.
  const px = bx - tRaw * ax;
  const py = by - tRaw * ay;
  const residualKm = Math.hypot(px, py);
  if (residualKm > MAX_RESIDUAL_KM) return null;

  const progress = prevIdx + (nextIdx - prevIdx) * t;
  return { progress, direction };
}
