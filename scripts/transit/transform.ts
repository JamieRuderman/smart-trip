/*
 * Transform step: read the committed raw 511 JSON snapshots and (re)emit
 * every derived TypeScript module under src/data/generated/, plus
 * public/data/schedules.json. Runs without an API key — all input is local.
 *
 * Run via:
 *   tsx scripts/transit/transform.ts
 *   (or `npm run regen-transit`)
 *
 * Output is byte-identical to the previous monolithic updateTransitFeeds.ts
 * implementation, which the Phase-5 idempotency check (`git diff
 * src/data/generated`) verifies.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { GtfsFeed } from "../../src/types/gtfs.js";
import {
  buildFerrySchedules,
  buildStations,
  buildStopIdToDirectionMap,
  buildStopIdToStationMap,
  buildTrainSchedules,
  checkSanityFloors,
  extractStationCoordinates,
  groupStopTimesByTrip,
  renderFerrySchedulesFile,
  renderStationCoordinatesFile,
  renderStationPlatformsFile,
  renderStationsFile,
  renderTrainSchedulesFile,
  type FerrySchedulesOutput,
  type TrainSchedulesOutput,
} from "./shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const RAW_DIR = path.resolve(ROOT, "data/511/raw");
const SMART_RAW_PATH = path.resolve(RAW_DIR, "smart.json");
const FERRY_RAW_PATH = path.resolve(RAW_DIR, "ferry.json");

const OUTPUT_DIR = path.resolve(ROOT, "src/data/generated");
const PUBLIC_DATA_DIR = path.resolve(ROOT, "public/data");

function readFeed(feedPath: string, expectedOperator: "SA" | "GF"): GtfsFeed {
  if (!fs.existsSync(feedPath)) {
    throw new Error(
      `Raw 511 feed missing at ${path.relative(ROOT, feedPath)}. Run \`npm run update-transit\` to fetch it.`,
    );
  }
  const feed = JSON.parse(fs.readFileSync(feedPath, "utf-8")) as GtfsFeed;
  if (feed.schemaVersion !== 1) {
    throw new Error(
      `Unexpected GtfsFeed.schemaVersion=${feed.schemaVersion} at ${path.relative(ROOT, feedPath)}; this transform expects 1.`,
    );
  }
  if (feed.operatorId !== expectedOperator) {
    throw new Error(
      `Operator mismatch at ${path.relative(ROOT, feedPath)}: expected ${expectedOperator}, got ${feed.operatorId}.`,
    );
  }
  return feed;
}

function writeOutput(filename: string, content: string): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.resolve(OUTPUT_DIR, filename), content, "utf-8");
}

function emitPublicScheduleJson(
  trainSchedules: TrainSchedulesOutput,
  ferrySchedules: FerrySchedulesOutput,
): void {
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    trainSchedules,
    ferrySchedules,
  };
  fs.writeFileSync(
    path.resolve(PUBLIC_DATA_DIR, "schedules.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf-8",
  );
}

export function transformRawToGenerated(): void {
  const smartFeed = readFeed(SMART_RAW_PATH, "SA");
  const ferryFeed = readFeed(FERRY_RAW_PATH, "GF");

  console.log("Processing SMART GTFS feed…");
  const stations = buildStations(smartFeed);
  writeOutput("stations.generated.ts", renderStationsFile(stations));

  const stopIdToStation = buildStopIdToStationMap(smartFeed.stops, stations);
  const stopTimesByTrip = groupStopTimesByTrip(smartFeed.stopTimes);
  const stopIdToDirection = buildStopIdToDirectionMap(
    smartFeed.trips,
    stopTimesByTrip,
    stations,
    stopIdToStation,
  );
  const platformsResult = renderStationPlatformsFile(
    stopIdToStation,
    stopIdToDirection,
    stations,
  );
  writeOutput("stationPlatforms.generated.ts", platformsResult.content);

  const trainSchedules = buildTrainSchedules(
    smartFeed,
    stopTimesByTrip,
    stations,
    stopIdToStation,
  );
  writeOutput(
    "trainSchedules.generated.ts",
    renderTrainSchedulesFile(trainSchedules),
  );

  console.log("Extracting station coordinates…");
  const stationCoords = extractStationCoordinates(stations);
  writeOutput(
    "stationCoordinates.generated.ts",
    renderStationCoordinatesFile(stationCoords),
  );

  console.log("Processing Golden Gate Ferry GTFS feed…");
  const ferrySchedules = buildFerrySchedules(ferryFeed);
  writeOutput(
    "ferrySchedule.generated.ts",
    renderFerrySchedulesFile(ferrySchedules),
  );
  emitPublicScheduleJson(trainSchedules, ferrySchedules);

  const trainTripCounts = {
    weekdaySouthbound: trainSchedules.weekday.southbound.length,
    weekdayNorthbound: trainSchedules.weekday.northbound.length,
    weekendSouthbound: trainSchedules.weekend.southbound.length,
    weekendNorthbound: trainSchedules.weekend.northbound.length,
  };
  const ferryCounts = {
    weekday: ferrySchedules.weekdayFerries.length,
    weekend: ferrySchedules.weekendFerries.length,
    weekdayInbound: ferrySchedules.weekdayInboundFerries.length,
    weekendInbound: ferrySchedules.weekendInboundFerries.length,
  };

  const zoneCount = new Set(stations.map((s) => s.zone)).size;
  console.log(
    `Derived ${stations.length} SMART stations with ${zoneCount} fare zones.`,
  );
  console.log("Generated SMART train schedules", trainTripCounts);
  console.log("Generated ferry schedules", ferryCounts);

  const failures = checkSanityFloors({
    stationCount: stations.length,
    platformCount: platformsResult.platformCount,
    trainTripCounts,
    ferryCounts,
  });
  if (failures.length > 0) {
    throw new Error(
      "Transit feed transform produced suspiciously low counts — upstream " +
        "feed format may have changed. Inspect the generator:\n  - " +
        failures.join("\n  - "),
    );
  }
}

// Allow direct invocation: `tsx scripts/transit/transform.ts`.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    transformRawToGenerated();
  } catch (error) {
    console.error("Failed to transform raw 511 feeds:", error);
    process.exitCode = 1;
  }
}
