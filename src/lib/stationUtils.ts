import type { Station } from "@/types/smartSchedule";
import stations, { stationZones, STATION_COORDINATES } from "@/data/stations";
import {
  GTFS_STOP_ID_TO_PLATFORM,
  GTFS_STOP_ID_TO_STATION,
  type PlatformInfo,
  type TrainDirection,
} from "@/data/generated/stationPlatforms.generated";
import { FERRY_CONSTANTS } from "./fareConstants";

/**
 * Maps GTFS platform stop IDs (from SMART's stops.txt) to a station + direction.
 * Each physical station has two platform stop_ids (one per direction); the
 * direction-aware map lets trip-update matching distinguish them, while the
 * station-only view keeps existing direction-agnostic resolution working.
 */
export {
  GTFS_STOP_ID_TO_STATION,
  GTFS_STOP_ID_TO_PLATFORM,
  type PlatformInfo,
  type TrainDirection,
};

/**
 * Station utilities - derived from pure data
 */

// Pre-computed lookup for station zones (derived from stationZones data)
export const stationZoneMap: Record<Station, number> = stationZones.reduce(
  (acc, { station, zone }) => {
    acc[station] = zone;
    return acc;
  },
  {} as Record<Station, number>
);

// Pre-computed station index lookup (derived from stations data)
export const stationIndexMap: Record<Station, number> = stations.reduce(
  (acc, station, index) => {
    acc[station] = index;
    return acc;
  },
  {} as Record<Station, number>
);

/**
 * Get the zone number for a station
 */
export function getStationZone(station: Station): number {
  return stationZoneMap[station] || 0;
}

/**
 * Get the index position of a station in the route
 */
export function getStationIndex(station: Station): number {
  return stationIndexMap[station];
}

/**
 * Check if a station has ferry connections
 */
export function hasFerryConnection(station: string): boolean {
  return station === FERRY_CONSTANTS.FERRY_STATION;
}

/**
 * Calculate the number of zones between two stations for fare calculation
 */
export function calculateZonesBetweenStations(
  fromStation: Station,
  toStation: Station
): number {
  const fromZone = getStationZone(fromStation);
  const toZone = getStationZone(toStation);
  return Math.abs(toZone - fromZone) + 1; // Include both zones in the calculation
}

/**
 * Get all stations for use in components
 */
export function getAllStations(): Station[] {
  return stations;
}

/**
 * Determine whether travel from `from` to `to` is southbound.
 * Southbound means fromIndex < toIndex (Windsor → Larkspur direction).
 */
export function isSouthbound(from: Station, to: Station): boolean {
  return (stationIndexMap[from] ?? 0) < (stationIndexMap[to] ?? 0);
}

/**
 * Direction of travel from `from` to `to` as the canonical `TrainDirection`
 * literal used by the realtime platform map and trip-update matching.
 */
export function getTripDirection(from: Station, to: Station): TrainDirection {
  return isSouthbound(from, to) ? "southbound" : "northbound";
}

/**
 * Haversine distance in km between two lat/lng points.
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the closest SMART station to the given coordinates
 */
export function getClosestStation(lat: number, lng: number): Station {
  return getClosestStationWithDistance(lat, lng).station;
}

export function getClosestStationWithDistance(
  lat: number,
  lng: number
): { station: Station; distanceKm: number } {
  const { station, distanceKm } = getClosestStationWithMargin(lat, lng);
  return { station, distanceKm };
}

/**
 * The two nearest stations to a point, plus the confidence margin between them.
 *
 * `marginKm` is how much further the second-closest station is than the
 * closest; it is the slack we have before a fix's error could tip the pick to a
 * neighbor (see {@link isClosestStationConfident}). Non-finite coordinates
 * (e.g. an unresolved GPS fix) yield an `Infinity` distance and a `0` margin so
 * callers never silently treat garbage input as a confident `stations[0]`.
 */
export function getClosestStationWithMargin(
  lat: number,
  lng: number
): { station: Station; distanceKm: number; marginKm: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { station: stations[0], distanceKm: Infinity, marginKm: 0 };
  }

  let closest: Station = stations[0];
  let closestDist = Infinity;
  let runnerUpDist = Infinity;
  for (const station of stations) {
    const coords = STATION_COORDINATES[station];
    const dist = haversineKm(lat, lng, coords.lat, coords.lng);
    if (dist < closestDist) {
      runnerUpDist = closestDist;
      closestDist = dist;
      closest = station;
    } else if (dist < runnerUpDist) {
      runnerUpDist = dist;
    }
  }
  return {
    station: closest,
    distanceKm: closestDist,
    marginKm: runnerUpDist - closestDist,
  };
}

/**
 * Whether a location fix confidently identifies the closest station.
 *
 * A straight-line "nearest station" pick is only trustworthy when the fix's
 * accuracy radius is smaller than the margin to the runner-up — otherwise the
 * true position could sit nearer that neighbor and we'd snap to the wrong one.
 * SMART's tightest station pair is ~1.66 km apart, so a coarse (cell-tower /
 * Wi-Fi) fix a kilometer off can straddle two stations; this guard keeps such a
 * fix from silently auto-selecting the wrong one. `accuracyMeters == null`
 * (browser omitted it) is treated as trustworthy so the guard never
 * hard-blocks.
 */
export function isClosestStationConfident(
  marginKm: number,
  accuracyMeters: number | null
): boolean {
  if (accuracyMeters == null) return true;
  return marginKm * 1000 >= accuracyMeters;
}

/**
 * Straight-line distance in km from the given coordinates to a specific station.
 */
export function getDistanceToStationKm(lat: number, lng: number, station: Station): number {
  const coords = STATION_COORDINATES[station];
  return haversineKm(lat, lng, coords.lat, coords.lng);
}
