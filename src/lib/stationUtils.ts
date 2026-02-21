import type { Station } from "@/types/smartSchedule";
import stations, { stationZones } from "@/data/stations";
import { FERRY_CONSTANTS } from "./fareConstants";

/**
 * Maps GTFS platform stop IDs (from SMART's stops.txt) to Station names.
 * Each physical station has two platform entries (northbound/southbound).
 * Used to correlate GTFS-RT stop_time_update.stop_id with the app's Station type.
 */
export const GTFS_STOP_ID_TO_STATION: Record<string, Station> = {
  "71011": "Larkspur",
  "71012": "Larkspur",
  "71021": "San Rafael",
  "71022": "San Rafael",
  "71031": "Marin Civic Center",
  "71032": "Marin Civic Center",
  "71041": "Novato Hamilton",
  "71042": "Novato Hamilton",
  "71051": "Novato Downtown",
  "71052": "Novato Downtown",
  "71061": "Novato San Marin",
  "71062": "Novato San Marin",
  "71071": "Petaluma Downtown",
  "71072": "Petaluma Downtown",
  "71081": "Petaluma North",
  "71082": "Petaluma North",
  "71091": "Cotati",
  "71092": "Cotati",
  "71101": "Rohnert Park",
  "71102": "Rohnert Park",
  "71111": "Santa Rosa Downtown",
  "71112": "Santa Rosa Downtown",
  "71121": "Santa Rosa North",
  "71122": "Santa Rosa North",
  "71131": "Sonoma County Airport",
  "71132": "Sonoma County Airport",
  "71141": "Windsor",
  "71142": "Windsor",
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
