import type { Station, StationZone } from "@/types/smartSchedule";

// Lat/lng coordinates for each SMART station (verified against Google Maps)
export const STATION_COORDINATES: Record<Station, { lat: number; lng: number }> = {
  "Windsor": { lat: 38.5491125, lng: -122.818189 },
  "Sonoma County Airport": { lat: 38.5100832, lng: -122.7843567 },
  "Santa Rosa North": { lat: 38.455112, lng: -122.7366214 },
  "Santa Rosa Downtown": { lat: 38.4374356, lng: -122.7218848 },
  "Rohnert Park": { lat: 38.3473735, lng: -122.7037793 },
  "Cotati": { lat: 38.3312591, lng: -122.6916985 },
  "Petaluma North": { lat: 38.2675533, lng: -122.6557996 },
  "Petaluma Downtown": { lat: 38.2369926, lng: -122.635302 },
  "Novato San Marin": { lat: 38.120578, lng: -122.5688409 },
  "Novato Downtown": { lat: 38.10598, lng: -122.5670149 },
  "Novato Hamilton": { lat: 38.0563341, lng: -122.5242735 },
  "Marin Civic Center": { lat: 38.0013104, lng: -122.5383129 },
  "San Rafael": { lat: 37.971135, lng: -122.5234037 },
  "Larkspur": { lat: 37.9478532, lng: -122.5132702 },
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
