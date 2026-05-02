/**
 * Regenerate src/data/generated/stationPlatforms.generated.ts from the
 * 511 SMART sample data checked in under sample/. Lets contributors
 * without a TRANSIT_511_API_KEY refresh the platform map (e.g. after
 * pulling a new sample), and keeps the file's provenance "machine-
 * generated from real 511 GTFS data" rather than hand-typed.
 *
 * The full `npm run update-transit` script remains the canonical path
 * once the SMART feed shifts — this is just the offline subset.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const STOPS_PATH = path.resolve(ROOT, "sample/511-smart-stops-2026-03-18.txt");
const TRIPUPDATES_PATH = path.resolve(ROOT, "sample/tripupdates.json");
const OUTPUT_PATH = path.resolve(
  ROOT,
  "src/data/generated/stationPlatforms.generated.ts",
);

type TrainDirection = "northbound" | "southbound";
type CsvRow = Record<string, string>;
type TripUpdate = {
  stopTimeUpdates: { stopId?: string; stopSequence?: number }[];
};

function readCsv(filePath: string): CsvRow[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];
}

function buildStopIdToStation(stops: CsvRow[]): {
  stopIdToStation: Map<string, string>;
  parentIds: Set<string>;
  stationOrder: string[];
} {
  const displayName = (raw: string) => raw.replace(/^SMART\s+/i, "").trim();
  const nameByParentId = new Map<string, string>();
  const parentIds = new Set<string>();
  type Parent = { id: string; name: string; lat: number };
  const parents: Parent[] = [];
  for (const s of stops) {
    if (s.location_type === "1" && s.stop_id && s.stop_name) {
      const name = displayName(s.stop_name);
      const lat = Number(s.stop_lat);
      if (!Number.isFinite(lat)) continue;
      nameByParentId.set(s.stop_id, name);
      parentIds.add(s.stop_id);
      parents.push({ id: s.stop_id, name, lat });
    }
  }
  const stopIdToStation = new Map<string, string>();
  for (const s of stops) {
    if (!s.stop_id) continue;
    const parentId = s.location_type === "1" ? s.stop_id : s.parent_station ?? "";
    const name = nameByParentId.get(parentId);
    if (name) stopIdToStation.set(s.stop_id, name);
  }
  // North → south by latitude (descending), matching updateTransitFeeds.ts.
  const stationOrder = parents.sort((a, b) => b.lat - a.lat).map((p) => p.name);
  return { stopIdToStation, parentIds, stationOrder };
}

/**
 * Derive direction per platform stop_id from RT trip updates: each trip's
 * sorted stops establish whether it's traveling N→S or S→N, and every
 * stop_id observed on that trip inherits that direction. Throws on
 * cross-direction collisions to match the live-script invariant.
 */
function buildStopIdToDirection(
  tripUpdates: TripUpdate[],
  stopIdToStation: Map<string, string>,
  stationOrder: string[],
): Map<string, TrainDirection> {
  const stationIdx = new Map(stationOrder.map((n, i) => [n, i]));
  const directionByStopId = new Map<string, TrainDirection>();
  for (const trip of tripUpdates) {
    const sorted = [...trip.stopTimeUpdates].sort(
      (a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0),
    );
    if (sorted.length < 2) continue;
    const firstStation = sorted[0].stopId
      ? stopIdToStation.get(sorted[0].stopId)
      : undefined;
    const lastStation = sorted[sorted.length - 1].stopId
      ? stopIdToStation.get(sorted[sorted.length - 1].stopId)
      : undefined;
    if (!firstStation || !lastStation) continue;
    const fi = stationIdx.get(firstStation);
    const li = stationIdx.get(lastStation);
    if (fi === undefined || li === undefined || fi === li) continue;
    const direction: TrainDirection = fi < li ? "southbound" : "northbound";
    for (const st of sorted) {
      if (!st.stopId || !stopIdToStation.has(st.stopId)) continue;
      const existing = directionByStopId.get(st.stopId);
      if (existing && existing !== direction) {
        throw new Error(
          `Sample stop_id ${st.stopId} appears in both directions; cannot derive a deterministic platform direction.`,
        );
      }
      directionByStopId.set(st.stopId, direction);
    }
  }
  return directionByStopId;
}

function emitFile(
  stopIdToStation: Map<string, string>,
  stopIdToDirection: Map<string, TrainDirection>,
  parentIds: Set<string>,
): number {
  const platforms: Record<string, { station: string; direction: TrainDirection }> = {};
  const sortedEntries = [...stopIdToStation.entries()]
    .filter(([stopId]) => !parentIds.has(stopId))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [stopId, station] of sortedEntries) {
    const direction = stopIdToDirection.get(stopId);
    if (!direction) {
      throw new Error(
        `Platform stop_id ${stopId} (${station}) has no direction in the sample trip updates; expand the sample or rerun against the live feed.`,
      );
    }
    platforms[stopId] = { station, direction };
  }

  const content = `// Auto-generated by scripts/regenerateStationPlatformsFromSample.ts
// (or scripts/updateTransitFeeds.ts when run against the live 511 feed).
// Do not edit manually.
import type { Station } from "./stations.generated.js";

export type TrainDirection = "northbound" | "southbound";

export interface PlatformInfo {
  readonly station: Station;
  readonly direction: TrainDirection;
}

/**
 * Every SMART platform stop_id (GTFS location_type=0) mapped to the station
 * AND the direction that platform serves. Realtime trip updates carry a
 * per-stop \`stop_id\`, so this map lets us match each update to a specific
 * (station, direction) pair without collapsing opposite-direction platforms
 * onto the same station entry.
 */
export const GTFS_STOP_ID_TO_PLATFORM: Record<string, PlatformInfo> = ${JSON.stringify(
    platforms,
    null,
    2,
  )};

/**
 * Station-only view of \`GTFS_STOP_ID_TO_PLATFORM\`, retained for callers
 * that only need to resolve a stop_id to a station name (vehicle positions,
 * service alerts, map markers) and don't care about direction.
 */
export const GTFS_STOP_ID_TO_STATION: Record<string, Station> = Object.fromEntries(
  Object.entries(GTFS_STOP_ID_TO_PLATFORM).map(([stopId, platform]) => [stopId, platform.station]),
) as Record<string, Station>;
`;
  fs.writeFileSync(OUTPUT_PATH, content, "utf-8");
  return Object.keys(platforms).length;
}

function main(): void {
  const stops = readCsv(STOPS_PATH);
  const tripUpdates = (
    JSON.parse(fs.readFileSync(TRIPUPDATES_PATH, "utf-8")) as {
      updates: TripUpdate[];
    }
  ).updates;

  const { stopIdToStation, parentIds, stationOrder } = buildStopIdToStation(stops);
  const stopIdToDirection = buildStopIdToDirection(tripUpdates, stopIdToStation, stationOrder);
  const count = emitFile(stopIdToStation, stopIdToDirection, parentIds);
  console.log(
    `Wrote ${count} platforms to ${path.relative(ROOT, OUTPUT_PATH)} from sample 511 data.`,
  );
}

main();
