import type { Station, StationZone } from "@/types/smartSchedule";
import {
  STATION_ORDER,
  STATION_ZONES,
} from "@/data/generated/stations.generated";

export { STATION_COORDINATES } from "@/data/generated/stationCoordinates.generated";

// The generated file is `readonly`; widen to the public `StationZone[]` /
// `Station[]` shape callers already expect. Same reference — nothing mutates
// these at runtime.
export const stationZones = STATION_ZONES as readonly StationZone[] as StationZone[];

const stations = STATION_ORDER as readonly Station[] as Station[];

export default stations;
