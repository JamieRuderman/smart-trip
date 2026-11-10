import { STATION_ORDER, type Station } from "@/data/generated/stations.generated";
import { SAN_FRANCISCO, type Place } from "@/lib/places";
import { stationSlug, routePairSlug } from "../../scripts/seo/slugify";

type RoutePair = readonly [Place, Place];

export const SF_ROUTE_STATIONS: Station[] = [
  "Santa Rosa Downtown",
  "Petaluma Downtown",
  "Sonoma County Airport",
];

export const TOP_ROUTE_PAIRS: RoutePair[] = [
  ["Larkspur", "Santa Rosa Downtown"],
  ["Santa Rosa Downtown", "Larkspur"],
  ["Larkspur", "Petaluma Downtown"],
  ["Petaluma Downtown", "Larkspur"],
  ["Larkspur", "San Rafael"],
  ["San Rafael", "Larkspur"],
  ["Larkspur", "Novato Downtown"],
  ["Novato Downtown", "Larkspur"],
  ["Larkspur", "Sonoma County Airport"],
  ["San Rafael", "Santa Rosa Downtown"],
  ...SF_ROUTE_STATIONS.flatMap((station): RoutePair[] => [
    [SAN_FRANCISCO, station],
    [station, SAN_FRANCISCO],
  ]),
];

const neighborPairs: RoutePair[] = STATION_ORDER.slice(1).flatMap(
  (station, i): RoutePair[] => [
    [STATION_ORDER[i], station],
    [station, STATION_ORDER[i]],
  ],
);

/** Includes every station's neighbors because the station pages link to them. */
export const ROUTE_PAIRS: RoutePair[] = [
  ...new Map(
    [
      ...TOP_ROUTE_PAIRS,
      ...TOP_ROUTE_PAIRS.map(([from, to]): RoutePair => [to, from]),
      ...neighborPairs,
    ].map((pair) => [pair.join("|"), pair]),
  ).values(),
];

export function placePath(place: Place): string {
  return place === SAN_FRANCISCO
    ? "/ferry-connection/"
    : `/stations/${stationSlug(place)}/`;
}

export function routePath(from: Place, to: Place): string {
  return `/routes/${routePairSlug(from, to)}/`;
}
