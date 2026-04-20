/*
 * Updates SMART train and Golden Gate Ferry schedules using 511.org GTFS feeds.
 *
 * Usage:
 *   TRANSIT_511_API_KEY=your_key npm run update-transit
 *
 * The script fetches the GTFS zip files, extracts the portions we use, and
 * regenerates the TypeScript data modules under src/data/generated/.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, "../src/data/generated");
const PUBLIC_DATA_DIR = path.resolve(__dirname, "../public/data");

const BASE_GTFS_URL = "https://api.511.org/transit/datafeeds";
const SMART_OPERATOR_ID = "SA"; // Sonoma Marin Area Rail Transit
const GOLDEN_GATE_FERRY_OPERATOR_ID = "GF";
/** GGF's stable route_id for the Larkspur ↔ San Francisco ferry. */
const LARKSPUR_SF_ROUTE_ID = "LSSF";

const SMART_FEED_URL = (token: string) =>
  `${BASE_GTFS_URL}?api_key=${token}&operator_id=${SMART_OPERATOR_ID}`;

const FERRY_FEED_URL = (token: string) =>
  `${BASE_GTFS_URL}?api_key=${token}&operator_id=${GOLDEN_GATE_FERRY_OPERATOR_ID}`;

type ScheduleType = "weekday" | "weekend";

type TrainDirection = "northbound" | "southbound";

type TrainTripOutput = {
  trip: number;
  times: string[];
};

type TrainScheduleOutput = Record<TrainDirection, TrainTripOutput[]>;

type TrainSchedulesOutput = Record<ScheduleType, TrainScheduleOutput>;

type FerryTrip = {
  depart: string;
  arrive: string;
};

type FerrySchedulesOutput = {
  weekdayFerries: FerryTrip[];
  weekendFerries: FerryTrip[];
  weekdayInboundFerries: FerryTrip[];
  weekendInboundFerries: FerryTrip[];
};

type CsvRow = Record<string, string>;

type GtfsFiles = {
  stops: CsvRow[];
  stopTimes: CsvRow[];
  trips: CsvRow[];
  calendar: CsvRow[];
  calendarDates: CsvRow[];
  routes: CsvRow[];
};

type StationParent = {
  /** GTFS `stop_id` of the parent station (location_type=1). */
  stopId: string;
  /** Display name (GTFS stop_name with the "SMART " prefix stripped). */
  name: string;
  lat: number;
  lng: number;
  /** Fare-zone number (1 at the north end, ascending southward). */
  zone: number;
};

function assertOutputDir(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function fetchZip(url: string): Promise<AdmZip> {
  const response = await fetch(url);

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch (error) {
      errorBody = `unable to read error body: ${(error as Error).message}`;
    }

    throw new Error(
      `Failed to fetch GTFS feed (${response.status} ${response.statusText}) - ${errorBody.trim()}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return new AdmZip(Buffer.from(arrayBuffer));
}

function loadGtfs(zip: AdmZip): GtfsFiles {
  const parseFile = (filename: string): CsvRow[] => {
    const entry = zip.getEntry(filename);

    if (!entry) {
      throw new Error(`Expected ${filename} in GTFS archive but it was not found.`);
    }

    const content = entry.getData().toString("utf-8");
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
  };

  return {
    stops: parseFile("stops.txt"),
    stopTimes: parseFile("stop_times.txt"),
    trips: parseFile("trips.txt"),
    calendar: parseFile("calendar.txt"),
    calendarDates: parseFile("calendar_dates.txt"),
    routes: parseFile("routes.txt"),
  };
}

/**
 * Derive SMART stations from the GTFS feed.
 *
 * - Stations = parent stops (`location_type=1`); display name strips the
 *   "SMART " prefix.
 * - Order is N→S by latitude.
 * - Fare zones come from the *platform* rows (`location_type=0`). Parent
 *   rows carry an inconsistent `zone_id` that disagrees with their own
 *   platforms, and fares are keyed to the platform zone.
 * - Zone numbers 1..N are assigned in the order each `zone_id` first appears
 *   going N→S, giving the app's canonical "1 = north, N = south" numbering.
 *
 * Throws if a station has conflicting or missing platform zones — the CI
 * sanity check then fails loud instead of emitting a subtly broken file.
 */
function buildStations(gtfs: GtfsFiles): StationParent[] {
  const displayName = (raw: string): string =>
    raw.replace(/^SMART\s+/i, "").trim();

  const platformZonesByParent = new Map<string, Set<string>>();
  for (const s of gtfs.stops) {
    if (s.location_type !== "0") continue;
    const parent = s.parent_station ?? "";
    const zone = s.zone_id ?? "";
    if (!parent || !zone) continue;
    const set = platformZonesByParent.get(parent) ?? new Set();
    set.add(zone);
    platformZonesByParent.set(parent, set);
  }

  const raw = gtfs.stops
    .filter((s) => s.location_type === "1")
    .map((s) => ({
      stopId: s.stop_id ?? "",
      name: displayName(s.stop_name ?? ""),
      lat: Number(s.stop_lat),
      lng: Number(s.stop_lon),
      platformZones:
        platformZonesByParent.get(s.stop_id ?? "") ?? new Set<string>(),
    }))
    .filter(
      (s) =>
        s.stopId && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lng),
    )
    .sort((a, b) => b.lat - a.lat);

  if (raw.length === 0) {
    throw new Error("SMART GTFS feed has no parent stops (location_type=1).");
  }

  const unzoned = raw.filter((r) => r.platformZones.size !== 1);
  if (unzoned.length > 0) {
    const detail = unzoned
      .map(
        (r) => `${r.name} (${[...r.platformZones].join(",") || "<none>"})`,
      )
      .join(", ");
    throw new Error(
      `SMART feed has stations whose platform zone_ids are missing or disagree: ${detail}`,
    );
  }

  // From here every `r.platformZones` has exactly one element.
  const resolved = raw.map((r) => ({
    ...r,
    zoneId: r.platformZones.values().next().value as string,
  }));

  const zoneNumberById = new Map<string, number>();
  for (const r of resolved) {
    if (!zoneNumberById.has(r.zoneId)) {
      zoneNumberById.set(r.zoneId, zoneNumberById.size + 1);
    }
  }

  return resolved.map((r) => ({
    stopId: r.stopId,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    zone: zoneNumberById.get(r.zoneId)!,
  }));
}

function emitStationsFile(stations: StationParent[]): void {
  const outputPath = path.resolve(OUTPUT_DIR, "stations.generated.ts");
  const orderLiteral = stations
    .map((s) => `  ${JSON.stringify(s.name)},`)
    .join("\n");
  const zonesLiteral = stations
    .map((s) => `  { station: ${JSON.stringify(s.name)}, zone: ${s.zone} },`)
    .join("\n");
  const content = `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.

/** Canonical SMART station order, north → south. */
export const STATION_ORDER = [
${orderLiteral}
] as const;

/** The Station string-literal union, sourced from the GTFS feed. */
export type Station = (typeof STATION_ORDER)[number];

/** Number of SMART stations. Literal-typed so it can drive tuple lengths. */
export const STATION_COUNT = ${stations.length} as const;

/** Fare zone per station. Zone numbers ascend going south. */
export const STATION_ZONES: readonly { station: Station; zone: number }[] = [
${zonesLiteral}
];
`;
  fs.writeFileSync(outputPath, content, "utf-8");
}

function toTimeString(raw: string): string {
  const [hours, minutes] = raw.split(":");
  const hourNumber = Number(hours);
  const adjustedHours = ((hourNumber % 24) + 24) % 24; // guard against negatives
  return `${adjustedHours.toString().padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function deriveServiceTypes(
  calendarRows: CsvRow[],
  calendarDateRows: CsvRow[],
  referenceDate?: Date
): Map<string, ScheduleType> {
  const ref = referenceDate ?? new Date();
  const y = ref.getFullYear();
  const m = String(ref.getMonth() + 1).padStart(2, "0");
  const d = String(ref.getDate()).padStart(2, "0");
  const refDateStr = `${y}${m}${d}`;

  const addedServices = new Set<string>();
  const removedServices = new Set<string>();
  for (const row of calendarDateRows) {
    if (row.date === refDateStr) {
      if (row.exception_type === "1") addedServices.add(row.service_id);
      if (row.exception_type === "2") removedServices.add(row.service_id);
    }
  }

  const serviceTypes = new Map<string, ScheduleType>();

  for (const row of calendarRows) {
    const startDate = row.start_date ?? "";
    const endDate = row.end_date ?? "";

    const inRange = startDate <= refDateStr && refDateStr <= endDate;
    const isActive =
      (inRange && !removedServices.has(row.service_id)) ||
      addedServices.has(row.service_id);
    if (!isActive) continue;

    const weekdayActive = ["monday", "tuesday", "wednesday", "thursday", "friday"].some(
      (day) => row[day] === "1"
    );
    const weekendActive = ["saturday", "sunday"].some((day) => row[day] === "1");

    if (weekdayActive && !weekendActive) {
      serviceTypes.set(row.service_id, "weekday");
    } else if (weekendActive && !weekdayActive) {
      serviceTypes.set(row.service_id, "weekend");
    }
  }

  return serviceTypes;
}

function allTimesPresent(times: (string | undefined)[]): times is string[] {
  return times.every((time): time is string => typeof time === "string");
}

/**
 * Resolve every platform `stop_id` to its station display name via GTFS's
 * `parent_station` relationship. Parent rows also map to themselves so
 * stop_times that reference a parent directly still resolve.
 */
function buildStopIdToStationMap(
  stops: CsvRow[],
  stations: StationParent[],
): Map<string, string> {
  const nameByParentId = new Map(stations.map((s) => [s.stopId, s.name]));
  const stationMap = new Map<string, string>();
  for (const stop of stops) {
    const stopId = stop.stop_id;
    if (!stopId) continue;
    const parentId = stop.location_type === "1" ? stopId : stop.parent_station ?? "";
    const name = nameByParentId.get(parentId);
    if (name) stationMap.set(stopId, name);
  }
  return stationMap;
}

function buildTrainSchedules(
  gtfs: GtfsFiles,
  stations: StationParent[],
): TrainSchedulesOutput {
  const stationCount = stations.length;
  const stationIndexByName = new Map(stations.map((s, i) => [s.name, i]));
  const serviceTypes = deriveServiceTypes(gtfs.calendar, gtfs.calendarDates);
  const stopToStation = buildStopIdToStationMap(gtfs.stops, stations);

  const stopTimesByTrip = new Map<string, CsvRow[]>();
  for (const stopTime of gtfs.stopTimes) {
    const tripStopTimes = stopTimesByTrip.get(stopTime.trip_id) ?? [];
    tripStopTimes.push(stopTime);
    stopTimesByTrip.set(stopTime.trip_id, tripStopTimes);
  }

  const schedules: TrainSchedulesOutput = {
    weekday: { northbound: [], southbound: [] },
    weekend: { northbound: [], southbound: [] },
  };

  for (const trip of gtfs.trips) {
    const { trip_id: tripId, service_id: serviceId } = trip;
    if (!tripId || !serviceId) continue;

    const scheduleType = serviceTypes.get(serviceId);
    if (!scheduleType) continue; // Ignore service IDs that do not map cleanly to weekday/weekend

    const tripStopTimes = stopTimesByTrip.get(tripId);
    if (!tripStopTimes || tripStopTimes.length === 0) continue;

    const sortedStopTimes = [...tripStopTimes].sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
    );

    const stationTimes = new Array<string | undefined>(stationCount).fill(undefined);
    let firstStationIndex: number | undefined;
    let lastStationIndex: number | undefined;

    for (const stopTime of sortedStopTimes) {
      const stationName = stopToStation.get(stopTime.stop_id);
      if (!stationName) continue;

      const stationIndex = stationIndexByName.get(stationName);
      if (stationIndex === undefined) continue;

      const timeRaw = stopTime.departure_time || stopTime.arrival_time;
      if (!timeRaw) continue;

      stationTimes[stationIndex] = toTimeString(timeRaw);

      if (firstStationIndex === undefined) {
        firstStationIndex = stationIndex;
      }

      lastStationIndex = stationIndex;
    }

    if (!allTimesPresent(stationTimes)) {
      continue; // Skip trips that do not serve every SMART station
    }

    if (firstStationIndex === undefined || lastStationIndex === undefined) {
      continue;
    }

    const direction: TrainDirection = firstStationIndex < lastStationIndex ? "southbound" : "northbound";
    const times = stationTimes.slice();

    const bucket = schedules[scheduleType][direction];
    const duplicateTrip = bucket.find((existing) =>
      existing.times.every((value, index) => value === times[index])
    );

    if (duplicateTrip) {
      continue;
    }

    const tripIdentifier = trip.trip_short_name || trip.trip_id;
    const numericId = Number(tripIdentifier.replace(/[^0-9]/g, ""));
    const tripNumber = Number.isFinite(numericId) && numericId > 0 ? numericId : bucket.length + 1;

    bucket.push({
      trip: tripNumber,
      times,
    });
  }

  for (const scheduleType of Object.keys(schedules) as ScheduleType[]) {
    for (const direction of ["northbound", "southbound"] as TrainDirection[]) {
      schedules[scheduleType][direction].sort((a, b) => {
        const index = direction === "southbound" ? 0 : stationCount - 1;
        const [aHours, aMinutes] = a.times[index].split(":").map(Number);
        const [bHours, bMinutes] = b.times[index].split(":").map(Number);
        return aHours * 60 + aMinutes - (bHours * 60 + bMinutes);
      });
    }
  }

  return schedules;
}

function buildFerrySchedules(gtfs: GtfsFiles): FerrySchedulesOutput {
  const serviceTypes = deriveServiceTypes(gtfs.calendar, gtfs.calendarDates);

  // Anchor on the route_id so the trip set doesn't depend on stop names.
  // If the route disappears the sanity floor fails the run.
  if (!gtfs.routes.some((r) => r.route_id === LARKSPUR_SF_ROUTE_ID)) {
    console.warn(
      `Golden Gate Ferry feed has no route_id="${LARKSPUR_SF_ROUTE_ID}"; ferry schedule will be empty.`,
    );
    return {
      weekdayFerries: [],
      weekendFerries: [],
      weekdayInboundFerries: [],
      weekendInboundFerries: [],
    };
  }

  // Within that route only two stops appear (Larkspur and one SF gate).
  // Classify them by latitude — Larkspur is ~20 km north of SF, so the
  // northernmost stop is always Larkspur.
  const stopLatById = new Map<string, number>();
  for (const s of gtfs.stops) {
    const lat = Number(s.stop_lat);
    if (Number.isFinite(lat)) stopLatById.set(s.stop_id, lat);
  }
  const stopRoleMap = new Map<string, "larkspur" | "sf">();
  const stopTimesByTrip = new Map<string, CsvRow[]>();
  for (const stopTime of gtfs.stopTimes) {
    const list = stopTimesByTrip.get(stopTime.trip_id) ?? [];
    list.push(stopTime);
    stopTimesByTrip.set(stopTime.trip_id, list);
  }

  const relevantStopIds = new Set<string>();
  for (const trip of gtfs.trips) {
    if (trip.route_id !== LARKSPUR_SF_ROUTE_ID) continue;
    const list = stopTimesByTrip.get(trip.trip_id ?? "") ?? [];
    for (const st of list) relevantStopIds.add(st.stop_id);
  }
  for (const id of relevantStopIds) {
    const lat = stopLatById.get(id);
    if (lat == null) continue;
    // ~37.85° splits Marin (Larkspur 37.94) from SF waterfront (37.79).
    stopRoleMap.set(id, lat > 37.85 ? "larkspur" : "sf");
  }

  const ferrySchedules: FerrySchedulesOutput = {
    weekdayFerries: [],
    weekendFerries: [],
    weekdayInboundFerries: [],
    weekendInboundFerries: [],
  };

  for (const trip of gtfs.trips) {
    if (trip.route_id !== LARKSPUR_SF_ROUTE_ID) continue;
    const serviceType = serviceTypes.get(trip.service_id ?? "");
    if (!serviceType) continue;

    const tripStopTimes = stopTimesByTrip.get(trip.trip_id ?? "");
    if (!tripStopTimes) continue;

    const sortedStops = [...tripStopTimes].sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
    );

    const withRoles = sortedStops
      .map((stopTime) => ({
        role: stopRoleMap.get(stopTime.stop_id ?? ""),
        stopTime,
      }))
      .filter((item) => item.role);

    const larkspurStop = withRoles.find((item) => item.role === "larkspur");
    const sfStop = withRoles.find((item) => item.role === "sf");

    if (!larkspurStop || !sfStop) continue;

    const larkspurSequence = Number(larkspurStop.stopTime.stop_sequence);
    const sfSequence = Number(sfStop.stopTime.stop_sequence);

    const departStop = larkspurSequence < sfSequence ? larkspurStop : sfStop;
    const arriveStop = larkspurSequence < sfSequence ? sfStop : larkspurStop;
    const arrayKeyPrefix = departStop.role === "larkspur" ? "" : "Inbound";

    const departureTimeRaw = departStop.stopTime.departure_time || departStop.stopTime.arrival_time;
    const arrivalTimeRaw = arriveStop.stopTime.arrival_time || arriveStop.stopTime.departure_time;

    if (!departureTimeRaw || !arrivalTimeRaw) continue;

    const depart = toTimeString(departureTimeRaw);
    const arrive = toTimeString(arrivalTimeRaw);

    if (arrayKeyPrefix === "") {
      ferrySchedules[`${serviceType}Ferries` as keyof FerrySchedulesOutput].push({ depart, arrive });
    } else {
      ferrySchedules[`${serviceType}${arrayKeyPrefix}Ferries` as keyof FerrySchedulesOutput].push({
        depart,
        arrive,
      });
    }
  }

  for (const key of Object.keys(ferrySchedules) as (keyof FerrySchedulesOutput)[]) {
    ferrySchedules[key].sort((a, b) => {
      const [aHours, aMinutes] = a.depart.split(":").map(Number);
      const [bHours, bMinutes] = b.depart.split(":").map(Number);
      return aHours * 60 + aMinutes - (bHours * 60 + bMinutes);
    });
  }

  return ferrySchedules;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function extractStationCoordinates(
  parents: StationParent[],
): Record<string, { lat: number; lng: number }> {
  const coords: Record<string, { lat: number; lng: number }> = {};
  for (const p of parents) {
    coords[p.name] = { lat: round4(p.lat), lng: round4(p.lng) };
  }
  return coords;
}

function emitStationCoordinatesFile(coords: Record<string, { lat: number; lng: number }>): void {
  const outputPath = path.resolve(OUTPUT_DIR, "stationCoordinates.generated.ts");
  const content = `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.
import type { Station } from "@/types/smartSchedule";

export const STATION_COORDINATES: Record<Station, { lat: number; lng: number }> = ${JSON.stringify(
    coords,
    null,
    2
  )};
`;
  fs.writeFileSync(outputPath, content, "utf-8");
}

function emitTrainSchedulesFile(data: TrainSchedulesOutput): void {
  const outputPath = path.resolve(OUTPUT_DIR, "trainSchedules.generated.ts");
  const content = `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.
import type { TrainSchedule } from "@/types/smartSchedule";

export type ScheduleType = "weekday" | "weekend";

export const trainSchedules: Record<ScheduleType, TrainSchedule> = ${JSON.stringify(
    data,
    null,
    2
  )};

export default trainSchedules;
`;

  fs.writeFileSync(outputPath, content, "utf-8");
}

function emitFerrySchedulesFile(data: FerrySchedulesOutput): void {
  const outputPath = path.resolve(OUTPUT_DIR, "ferrySchedule.generated.ts");
  const content = `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.
import type { FerryConnection } from "@/types/smartSchedule";

export const weekdayFerries: FerryConnection[] = ${JSON.stringify(
    data.weekdayFerries,
    null,
    2
  )};

export const weekendFerries: FerryConnection[] = ${JSON.stringify(
    data.weekendFerries,
    null,
    2
  )};

export const weekdayInboundFerries: FerryConnection[] = ${JSON.stringify(
    data.weekdayInboundFerries,
    null,
    2
  )};

export const weekendInboundFerries: FerryConnection[] = ${JSON.stringify(
    data.weekendInboundFerries,
    null,
    2
  )};

export default {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
};
`;

  fs.writeFileSync(outputPath, content, "utf-8");
}

function emitPublicScheduleJson(
  trainSchedules: TrainSchedulesOutput,
  ferrySchedules: FerrySchedulesOutput
): void {
  if (!fs.existsSync(PUBLIC_DATA_DIR)) {
    fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    trainSchedules,
    ferrySchedules,
  };

  const outputPath = path.resolve(PUBLIC_DATA_DIR, "schedules.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function updateFeeds(): Promise<void> {
  const apiKey = process.env.TRANSIT_511_API_KEY;

  if (!apiKey) {
    throw new Error("TRANSIT_511_API_KEY environment variable is required to update transit feeds.");
  }

  assertOutputDir();

  console.log("Fetching SMART + Golden Gate Ferry GTFS feeds...");
  const [smartZip, ferryZip] = await Promise.all([
    fetchZip(SMART_FEED_URL(apiKey)),
    fetchZip(FERRY_FEED_URL(apiKey)),
  ]);
  const smartGtfs = loadGtfs(smartZip);
  const ferryGtfs = loadGtfs(ferryZip);

  console.log("Processing SMART GTFS feed...");
  const stations = buildStations(smartGtfs);
  emitStationsFile(stations);

  const trainSchedules = buildTrainSchedules(smartGtfs, stations);
  emitTrainSchedulesFile(trainSchedules);

  console.log("Extracting station coordinates...");
  const stationCoords = extractStationCoordinates(stations);
  emitStationCoordinatesFile(stationCoords);

  console.log("Processing Golden Gate Ferry GTFS feed...");
  const ferrySchedules = buildFerrySchedules(ferryGtfs);
  emitFerrySchedulesFile(ferrySchedules);
  emitPublicScheduleJson(trainSchedules, ferrySchedules);

  const trainTripCounts = {
    weekdaySouthbound: trainSchedules.weekday.southbound.length,
    weekdayNorthbound: trainSchedules.weekday.northbound.length,
    weekendSouthbound: trainSchedules.weekend.southbound.length,
    weekendNorthbound: trainSchedules.weekend.northbound.length,
  };

  const zoneCount = new Set(stations.map((s) => s.zone)).size;
  console.log(
    `Derived ${stations.length} SMART stations with ${zoneCount} fare zones.`,
  );
  console.log("Generated SMART train schedules", trainTripCounts);
  const ferryCounts = {
    weekday: ferrySchedules.weekdayFerries.length,
    weekend: ferrySchedules.weekendFerries.length,
    weekdayInbound: ferrySchedules.weekdayInboundFerries.length,
    weekendInbound: ferrySchedules.weekendInboundFerries.length,
  };
  console.log("Generated ferry schedules", ferryCounts);

  // Sanity floors — if the feed's shape shifts and we silently emit empty
  // arrays (as happened when GGF renamed their stops), the workflow catches
  // it instead of committing a broken file. Numbers are well below typical
  // daily counts so seasonal thinning won't trip them.
  const MIN_TRIPS = {
    weekdaySouthbound: 10,
    weekdayNorthbound: 10,
    weekendSouthbound: 4,
    weekendNorthbound: 4,
  };
  const MIN_FERRIES = {
    weekday: 5,
    weekend: 2,
    weekdayInbound: 5,
    weekendInbound: 2,
  };
  const MIN_STATIONS = 14;
  const failures: string[] = [];
  if (stations.length < MIN_STATIONS) {
    failures.push(`stations: got ${stations.length}, expected ≥ ${MIN_STATIONS}`);
  }
  for (const [key, min] of Object.entries(MIN_TRIPS)) {
    const got = trainTripCounts[key as keyof typeof trainTripCounts];
    if (got < min) failures.push(`train.${key}: got ${got}, expected ≥ ${min}`);
  }
  for (const [key, min] of Object.entries(MIN_FERRIES)) {
    const got = ferryCounts[key as keyof typeof ferryCounts];
    if (got < min) failures.push(`ferry.${key}: got ${got}, expected ≥ ${min}`);
  }
  if (failures.length > 0) {
    throw new Error(
      "Transit feed refresh produced suspiciously low counts — upstream " +
        "feed format may have changed. Inspect the generator:\n  - " +
        failures.join("\n  - "),
    );
  }
}

updateFeeds().catch((error) => {
  console.error("Failed to update transit feeds:", error);
  process.exitCode = 1;
});
