import { STATION_ORDER } from "@/data/generated/stations.generated";
import { SAN_FRANCISCO, type Place } from "@/lib/places";
import { stationSlug } from "../../scripts/seo/slugify";

export type RoutePair = readonly [Place, Place];

/** The page a trip end links to: its station page, or the ferry page for SF. */
export function placePath(place: Place): string {
  return place === SAN_FRANCISCO
    ? "/ferry-connection/"
    : `/stations/${stationSlug(place)}/`;
}

/** The busiest trips, linked from the homepage footer. */
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
  [SAN_FRANCISCO, "Santa Rosa Downtown"],
  ["Santa Rosa Downtown", SAN_FRANCISCO],
  [SAN_FRANCISCO, "Petaluma Downtown"],
  ["Petaluma Downtown", SAN_FRANCISCO],
  [SAN_FRANCISCO, "Sonoma County Airport"],
  ["Sonoma County Airport", SAN_FRANCISCO],
];

const neighborPairs: RoutePair[] = STATION_ORDER.slice(1).flatMap(
  (station, i): RoutePair[] => [
    [STATION_ORDER[i], station],
    [station, STATION_ORDER[i]],
  ],
);

const pairKey = ([from, to]: RoutePair): string => `${from}|${to}`;

/**
 * Every route page the site builds: the top trips both ways, and each station
 * to its neighbors — every route the pages link to.
 */
export const ROUTE_PAIRS: RoutePair[] = [
  ...new Map(
    [
      ...TOP_ROUTE_PAIRS,
      ...TOP_ROUTE_PAIRS.map(([from, to]): RoutePair => [to, from]),
      ...neighborPairs,
    ].map((pair) => [pairKey(pair), pair]),
  ).values(),
];

const routeKeys = new Set(ROUTE_PAIRS.map(pairKey));

export function hasRoutePage(from: Place, to: Place): boolean {
  return routeKeys.has(pairKey([from, to]));
}
