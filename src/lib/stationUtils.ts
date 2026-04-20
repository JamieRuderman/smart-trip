import type { Station } from "@/types/smartSchedule";
import stations, { stationZones, STATION_COORDINATES } from "@/data/stations";
import { FERRY_CONSTANTS } from "./fareConstants";

/**
 * Maps GTFS platform stop IDs (from SMART's stops.txt) to Station names.
 * Each physical station has two platform entries (northbound/southbound).
 * Used to correlate GTFS-RT stop_time_update.stop_id with the app's Station type.
 */
export { GTFS_STOP_ID_TO_STATION } from "@/data/generated/stationPlatforms.generated";

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
  let closest: Station = stations[0];
  let minDist = Infinity;
  for (const station of stations) {
    const coords = STATION_COORDINATES[station];
    const dist = haversineKm(lat, lng, coords.lat, coords.lng);
    if (dist < minDist) {
      minDist = dist;
      closest = station;
    }
  }
  return { station: closest, distanceKm: minDist };
}

/**
 * Straight-line distance in km from the given coordinates to a specific station.
 */
export function getDistanceToStationKm(lat: number, lng: number, station: Station): number {
  const coords = STATION_COORDINATES[station];
  return haversineKm(lat, lng, coords.lat, coords.lng);
}
