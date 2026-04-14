import { STATION_COORDINATES } from "@/data/stations";
import type { Station } from "@/types/smartSchedule";
import stations from "@/data/stations";

/** Station order from north (Windsor) to south (Larkspur) */
export const STATION_ORDER: Station[] = stations;

/** Route line as GeoJSON connecting all stations north→south */
export const ROUTE_GEOJSON: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: STATION_ORDER.map((s) => [
      STATION_COORDINATES[s].lng,
      STATION_COORDINATES[s].lat,
    ]),
  },
};

/** Default bounds: fit all stations with padding */
export const ALL_STATIONS_BOUNDS: [number, number, number, number] = (() => {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const s of STATION_ORDER) {
    const { lat, lng } = STATION_COORDINATES[s];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
})();

/** Mapbox style URLs */
export const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/light-v11";
export const MAPBOX_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

/** Map padding for fitBounds (pixels) */
export const MAP_FIT_PADDING = { top: 80, bottom: 40, left: 40, right: 40 };
