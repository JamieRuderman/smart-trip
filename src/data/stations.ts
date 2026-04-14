import type { Station, StationZone } from "@/types/smartSchedule";

// Re-export coordinates generated from GTFS parent stations by scripts/updateTransitFeeds.ts.
// Run `npm run update-transit` to refresh these from the 511.org GTFS feed.
export { STATION_COORDINATES } from "@/data/generated/stationCoordinates.generated";

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
