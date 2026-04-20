import type { Station, StationZone } from "@/types/smartSchedule";
import {
  STATION_ORDER,
  STATION_ZONES,
} from "@/data/generated/stations.generated";

// Station metadata is generated from the SMART GTFS feed by
// scripts/updateTransitFeeds.ts. Run `npm run update-transit` to refresh.
export { STATION_COORDINATES } from "@/data/generated/stationCoordinates.generated";

export const stationZones: StationZone[] = STATION_ZONES.map((z) => ({ ...z }));

const stations: Station[] = [...STATION_ORDER];

export default stations;
