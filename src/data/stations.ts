import type { Station, StationZone } from "@/types/smartSchedule";

// Lat/lng coordinates for each SMART station, manually validated against Google Maps.
// These intentionally differ from raw 511.org GTFS stops.txt coordinates where those were inaccurate.
export const STATION_COORDINATES: Record<Station, { lat: number; lng: number }> = {
  "Windsor": { lat: 38.5477, lng: -122.8125 },
  "Sonoma County Airport": { lat: 38.5044, lng: -122.7426 },
  "Santa Rosa North": { lat: 38.4594, lng: -122.7286 },
  "Santa Rosa Downtown": { lat: 38.4407, lng: -122.7178 },
  "Rohnert Park": { lat: 38.3350, lng: -122.6972 },
  "Cotati": { lat: 38.3247, lng: -122.7073 },
  "Petaluma North": { lat: 38.2629, lng: -122.6637 },
  "Petaluma Downtown": { lat: 38.2318, lng: -122.6437 },
  "Novato San Marin": { lat: 38.0834, lng: -122.5671 },
  "Novato Downtown": { lat: 38.1095, lng: -122.5706 },
  "Novato Hamilton": { lat: 38.0586, lng: -122.5266 },
  "Marin Civic Center": { lat: 37.9744, lng: -122.5259 },
  "San Rafael": { lat: 37.9763, lng: -122.5320 },
  "Larkspur": { lat: 37.9437, lng: -122.5044 },
};

// Raw station data - this represents what would come from an API
export const stationZones: StationZone[] = [
  { station: "Windsor", zone: 1 },
  { station: "Sonoma County Airport", zone: 1 },
  { station: "Santa Rosa North", zone: 2 },
  { station: "Santa Rosa Downtown", zone: 2 },
  { station: "Rohnert Park", zone: 3 },
  { station: "Cotati", zone: 3 },
  { station: "Petaluma North", zone: 3 },
  { station: "Petaluma Downtown", zone: 3 },
  { station: "Novato San Marin", zone: 4 },
  { station: "Novato Downtown", zone: 4 },
  { station: "Novato Hamilton", zone: 4 },
  { station: "Marin Civic Center", zone: 5 },
  { station: "San Rafael", zone: 5 },
  { station: "Larkspur", zone: 5 },
];

// Raw station list - this represents what would come from an API
const stations: Station[] = stationZones.map(({ station }) => station);

export default stations;
