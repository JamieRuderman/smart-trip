/*
 * I/O-free helpers shared between scripts/transit/fetch.ts (511 → raw JSON)
 * and scripts/transit/transform.ts (raw JSON → generated TS modules).
 *
 * Everything here is a pure function: parse a GTFS archive into the
 * GtfsFeed envelope, derive stations/schedules/platforms from a GtfsFeed,
 * or render a generated-TS file as a string. No fs writes, no fetches.
 *
 * The render*File functions emit byte-identical output to the previous
 * single-script pipeline so the Phase-5 idempotency check (regen vs git)
 * passes cleanly.
 */

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

import type {
  GtfsAgency,
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsFeed,
  GtfsOperatorId,
  GtfsRoute,
  GtfsShape,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
} from "../../src/types/gtfs.js";

export type ScheduleType = "weekday" | "weekend";

export type TrainDirection = "northbound" | "southbound";

export type StationParent = {
  /** GTFS `stop_id` of the parent station (location_type=1). */
  stopId: string;
  /** Display name (GTFS stop_name with the "SMART " prefix stripped). */
  name: string;
  lat: number;
  lng: number;
  /** Fare-zone number (1 at the north end, ascending southward). */
  zone: number;
};

export type TrainTripOutput = {
  trip: number;
  times: string[];
};

export type TrainScheduleOutput = Record<TrainDirection, TrainTripOutput[]>;

export type TrainSchedulesOutput = Record<ScheduleType, TrainScheduleOutput>;

export type FerryTrip = {
  depart: string;
  arrive: string;
};

export type FerrySchedulesOutput = {
  weekdayFerries: FerryTrip[];
  weekendFerries: FerryTrip[];
  weekdayInboundFerries: FerryTrip[];
  weekendInboundFerries: FerryTrip[];
};

/**
 * Map of "YYYY-MM-DD" → effective schedule type for dates where SMART runs
 * a schedule different from the natural day-of-week (e.g. Memorial Day
 * Monday running the weekend schedule). Derived from GTFS calendar_dates.
 */
export type ScheduleOverridesOutput = Record<string, ScheduleType>;

/** GGF's stable route_id for the Larkspur ↔ San Francisco ferry. */
export const LARKSPUR_SF_ROUTE_ID = "LSSF";

// ── CSV / Zip extraction ─────────────────────────────────────────────────────

function parseCsv<T>(content: string): T[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[];
}

function readEntry(
  zip: AdmZip,
  filename: string,
  optional = false,
): string | null {
  const entry = zip.getEntry(filename);
  if (!entry) {
    if (optional) return null;
    throw new Error(
      `Expected ${filename} in GTFS archive but it was not found.`,
    );
  }
  return entry.getData().toString("utf-8");
}

/**
 * Extract every GTFS table this app uses out of an in-memory zip into the
 * `GtfsFeed` envelope. `agency.txt` and `shapes.txt` are treated as optional
 * because not every operator ships them. Required tables (stops, stop_times,
 * trips, routes, calendar, calendar_dates) throw if missing — that's a sign
 * the upstream feed format changed and we should fail loudly rather than
 * persist a silently-truncated snapshot.
 */
export function extractGtfsFeedFromZip(
  zip: AdmZip,
  operatorId: GtfsOperatorId,
  sourceUrl: string,
  fetchedAt: string,
): GtfsFeed {
  const agencyContent = readEntry(zip, "agency.txt", true);
  const shapesContent = readEntry(zip, "shapes.txt", true);
  return {
    schemaVersion: 1,
    operatorId,
    fetchedAt,
    sourceUrl,
    agency: agencyContent ? parseCsv<GtfsAgency>(agencyContent) : [],
    routes: parseCsv<GtfsRoute>(readEntry(zip, "routes.txt")!),
    trips: parseCsv<GtfsTrip>(readEntry(zip, "trips.txt")!),
    stops: parseCsv<GtfsStop>(readEntry(zip, "stops.txt")!),
    stopTimes: parseCsv<GtfsStopTime>(readEntry(zip, "stop_times.txt")!),
    calendar: parseCsv<GtfsCalendar>(readEntry(zip, "calendar.txt")!),
    calendarDates: parseCsv<GtfsCalendarDate>(
      readEntry(zip, "calendar_dates.txt")!,
    ),
    shapes: shapesContent ? parseCsv<GtfsShape>(shapesContent) : null,
  };
}

// ── Time / direction helpers ─────────────────────────────────────────────────

export function toTimeString(raw: string): string {
  const [hours, minutes] = raw.split(":");
  const hourNumber = Number(hours);
  const adjustedHours = ((hourNumber % 24) + 24) % 24; // guard against negatives
  return `${adjustedHours.toString().padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function allTimesPresent(times: (string | undefined)[]): times is string[] {
  return times.every((time): time is string => typeof time === "string");
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Look-ahead applied when deciding whether a calendar.txt row is in scope
// for classification. 511 occasionally publishes a fresh GTFS bundle whose
// service window starts a few days in the future — e.g. the weekend
// service starts on Saturday but the bundle goes live on Friday. Without
// the look-ahead, the Friday refresh sees zero weekend trips and the
// sanity floor trips (issue #43). Two weeks comfortably covers the
// typical publication cadence without admitting services many weeks out.
const SERVICE_LOOKAHEAD_DAYS = 14;

function formatGtfsDate(date: Date): string {
  // Use UTC components so the build is timezone-independent. Local-time
  // getters would shift the reference date when the CI build (UTC) runs vs a
  // local-tz dev box, reintroducing the non-determinism we're trying to kill.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Classify each calendar.txt service as weekday or weekend.
 *
 * `referenceDate` is required and intentionally not defaulted to `new Date()`.
 * This is the build-time transform — the output is the *static* schedule
 * shipped with the app, and must be reproducible across builds. Call sites
 * pass `new Date(feed.fetchedAt)` so the same committed feed produces the
 * same output whether CI runs the build today, on Memorial Day, or six
 * months from now. Wall-clock dependence here has caused a string of
 * production failures (issues #43, holiday Mondays, etc.).
 *
 * Today-only calendar_dates exceptions are also intentionally ignored:
 * classification is by canonical day-of-week flags. The SPA has its own
 * runtime getTodayScheduleType() that flips display to "weekend" on
 * holidays — that's where today-awareness belongs.
 */
export function deriveServiceTypes(
  calendarRows: GtfsCalendar[],
  referenceDate: Date,
): Map<string, ScheduleType> {
  const refDateStr = formatGtfsDate(referenceDate);
  const horizon = new Date(referenceDate);
  horizon.setUTCDate(horizon.getUTCDate() + SERVICE_LOOKAHEAD_DAYS);
  const horizonDateStr = formatGtfsDate(horizon);

  const serviceTypes = new Map<string, ScheduleType>();

  for (const row of calendarRows) {
    const startDate = row.start_date ?? "";
    const endDate = row.end_date ?? "";

    // Overlap [today, today + lookahead] with [startDate, endDate]: only
    // consider services whose date window intersects the near future, so
    // we don't classify services that haven't started or have expired.
    const overlapsWindow =
      startDate <= horizonDateStr && refDateStr <= endDate;
    if (!overlapsWindow) continue;

    const weekdayActive = (
      ["monday", "tuesday", "wednesday", "thursday", "friday"] as const
    ).some((day) => row[day] === "1");
    const weekendActive = (["saturday", "sunday"] as const).some(
      (day) => row[day] === "1",
    );

    if (weekdayActive && !weekendActive) {
      serviceTypes.set(row.service_id, "weekday");
    } else if (weekendActive && !weekdayActive) {
      serviceTypes.set(row.service_id, "weekend");
    }
  }

  return serviceTypes;
}

const GTFS_DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function parseGtfsDate(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function classifyServicePattern(
  row: GtfsCalendar,
): ScheduleType | "mixed" | "empty" {
  const weekday = (
    ["monday", "tuesday", "wednesday", "thursday", "friday"] as const
  ).some((day) => row[day] === "1");
  const weekend = (["saturday", "sunday"] as const).some(
    (day) => row[day] === "1",
  );
  if (weekday && weekend) return "mixed";
  if (weekday) return "weekday";
  if (weekend) return "weekend";
  return "empty";
}

/**
 * Return the schedule type actually running on `date` after applying any
 * `calendar_dates` exceptions:
 * - "weekday"/"weekend" — exactly that schedule is active
 * - "mixed" — both schedules run simultaneously (e.g. extra service added
 *   alongside the regular pattern); the natural day-of-week service is
 *   still in effect, so no override is needed
 * - "unknown" — an added service_id has no calendar.txt row so we can't
 *   classify its pattern; bail out instead of guessing
 * - "none" — no service at all (e.g. Thanksgiving), distinct from "mixed"
 */
function effectiveScheduleType(
  date: string,
  dayOfWeek: number,
  calendarRows: GtfsCalendar[],
  exceptionsByDate: Map<string, { added: Set<string>; removed: Set<string> }>,
): ScheduleType | "mixed" | "unknown" | "none" {
  const exceptions = exceptionsByDate.get(date);
  const added = exceptions?.added ?? new Set<string>();
  const removed = exceptions?.removed ?? new Set<string>();
  const dayKey = GTFS_DAY_KEYS[dayOfWeek];

  // GTFS permits service_ids that only exist in calendar_dates.txt (date-only
  // services with no weekly pattern). We can't classify their weekday/weekend
  // nature, so flag any such add and bail out conservatively below.
  const calendarServiceIds = new Set(calendarRows.map((r) => r.service_id));
  for (const id of added) {
    if (!calendarServiceIds.has(id)) return "unknown";
  }

  let weekdayActive = false;
  let weekendActive = false;

  for (const row of calendarRows) {
    if (removed.has(row.service_id)) continue;
    const inRange = row.start_date <= date && date <= row.end_date;
    const dayActive = inRange && row[dayKey] === "1";
    const isActive = dayActive || added.has(row.service_id);
    if (!isActive) continue;

    const pattern = classifyServicePattern(row);
    if (pattern === "weekday") weekdayActive = true;
    else if (pattern === "weekend") weekendActive = true;
  }

  if (weekdayActive && weekendActive) return "mixed";
  if (weekdayActive) return "weekday";
  if (weekendActive) return "weekend";
  return "none";
}

/**
 * Derive a map of "YYYY-MM-DD" → effective schedule type for every date in
 * `calendar_dates.txt` whose effective service differs from the natural
 * day-of-week. So Memorial Day Monday lands in the map as "weekend".
 *
 * `minDate` filters out far-past holidays so the emitted map stays small.
 * If a date has no service at all (e.g. Christmas), we fall back to
 * "weekend" — the reduced view is less misleading than the full weekday
 * grid when no trains are actually running.
 */
export function deriveScheduleOverrides(
  calendarRows: GtfsCalendar[],
  calendarDateRows: GtfsCalendarDate[],
  options?: { minDate?: Date },
): ScheduleOverridesOutput {
  const exceptionsByDate = new Map<
    string,
    { added: Set<string>; removed: Set<string> }
  >();
  for (const row of calendarDateRows) {
    const entry = exceptionsByDate.get(row.date) ?? {
      added: new Set<string>(),
      removed: new Set<string>(),
    };
    if (row.exception_type === "1") entry.added.add(row.service_id);
    if (row.exception_type === "2") entry.removed.add(row.service_id);
    exceptionsByDate.set(row.date, entry);
  }

  const minDateStr = options?.minDate
    ? formatGtfsDate(options.minDate)
    : null;

  const dates = [...exceptionsByDate.keys()].sort();
  const overrides: ScheduleOverridesOutput = {};

  for (const date of dates) {
    if (minDateStr && date < minDateStr) continue;
    const parsed = parseGtfsDate(date);
    if (!parsed) continue;

    const dayOfWeek = parsed.getDay();
    const naturalType: ScheduleType =
      dayOfWeek === 0 || dayOfWeek === 6 ? "weekend" : "weekday";

    const active = effectiveScheduleType(
      date,
      dayOfWeek,
      calendarRows,
      exceptionsByDate,
    );
    // "mixed" means natural day-of-week service still runs alongside extras
    // — no override needed. "unknown" means we encountered a date-only
    // service_id with no calendar.txt row; defer to natural day-of-week
    // rather than guess. "none" (true no-service day) falls back to the
    // weekend view since it's less misleading than a full weekday grid.
    if (active === "mixed" || active === "unknown") continue;
    const effective: ScheduleType = active === "none" ? "weekend" : active;
    if (effective === naturalType) continue;

    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    overrides[iso] = effective;
  }

  return overrides;
}

// ── Stations / platforms ─────────────────────────────────────────────────────

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
export function buildStations(feed: GtfsFeed): StationParent[] {
  const displayName = (raw: string): string =>
    raw.replace(/^SMART\s+/i, "").trim();

  const platformZonesByParent = new Map<string, Set<string>>();
  for (const s of feed.stops) {
    if (s.location_type !== "0") continue;
    const parent = s.parent_station ?? "";
    const zone = s.zone_id ?? "";
    if (!parent || !zone) continue;
    const set = platformZonesByParent.get(parent) ?? new Set<string>();
    set.add(zone);
    platformZonesByParent.set(parent, set);
  }

  const raw = feed.stops
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

/**
 * Resolve every platform `stop_id` to its station display name via GTFS's
 * `parent_station` relationship. Parent rows also map to themselves so
 * stop_times that reference a parent directly still resolve.
 */
export function buildStopIdToStationMap(
  stops: GtfsStop[],
  stations: StationParent[],
): Map<string, string> {
  const nameByParentId = new Map(stations.map((s) => [s.stopId, s.name]));
  const stationMap = new Map<string, string>();
  for (const stop of stops) {
    const stopId = stop.stop_id;
    if (!stopId) continue;
    const parentId =
      stop.location_type === "1" ? stopId : stop.parent_station ?? "";
    const name = nameByParentId.get(parentId);
    if (name) stationMap.set(stopId, name);
  }
  return stationMap;
}

/**
 * Group every stop_time by trip_id so per-trip walks don't have to re-scan
 * the full stop_times table.
 */
export function groupStopTimesByTrip(
  stopTimes: GtfsStopTime[],
): Map<string, GtfsStopTime[]> {
  const stopTimesByTrip = new Map<string, GtfsStopTime[]>();
  for (const stopTime of stopTimes) {
    const list = stopTimesByTrip.get(stopTime.trip_id) ?? [];
    list.push(stopTime);
    stopTimesByTrip.set(stopTime.trip_id, list);
  }
  return stopTimesByTrip;
}

/**
 * Determine the direction of a trip from its sorted stop_times by comparing
 * the first and last station indices in the canonical station order.
 * Returns null if the trip doesn't traverse two distinct known stations.
 */
function inferTripDirection(
  sortedStopTimes: GtfsStopTime[],
  stopToStation: Map<string, string>,
  stationIndexByName: Map<string, number>,
): TrainDirection | null {
  let firstIdx: number | undefined;
  let lastIdx: number | undefined;
  for (const st of sortedStopTimes) {
    const station = stopToStation.get(st.stop_id);
    const idx = station ? stationIndexByName.get(station) : undefined;
    if (idx === undefined) continue;
    if (firstIdx === undefined) firstIdx = idx;
    lastIdx = idx;
  }
  if (firstIdx === undefined || lastIdx === undefined || firstIdx === lastIdx)
    return null;
  return firstIdx < lastIdx ? "southbound" : "northbound";
}

/**
 * Walk every trip's stop_times to determine which direction each platform
 * `stop_id` serves. Throws if a single stop_id is observed in both
 * directions, since that breaks the deterministic ID-to-direction match
 * relied on by the realtime trip-update pipeline.
 */
export function buildStopIdToDirectionMap(
  trips: GtfsTrip[],
  stopTimesByTrip: Map<string, GtfsStopTime[]>,
  stations: StationParent[],
  stopToStation: Map<string, string>,
): Map<string, TrainDirection> {
  const stationIndexByName = new Map(stations.map((s, i) => [s.name, i]));
  const directionByStopId = new Map<string, TrainDirection>();
  for (const trip of trips) {
    const tripStopTimes = stopTimesByTrip.get(trip.trip_id);
    if (!tripStopTimes || tripStopTimes.length === 0) continue;

    const sorted = [...tripStopTimes].sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence),
    );

    const direction = inferTripDirection(
      sorted,
      stopToStation,
      stationIndexByName,
    );
    if (!direction) continue;

    for (const st of sorted) {
      const stopId = st.stop_id;
      if (!stopId || !stopToStation.has(stopId)) continue;
      const existing = directionByStopId.get(stopId);
      if (existing && existing !== direction) {
        throw new Error(
          `GTFS stop_id ${stopId} is used by both directions; cannot derive a deterministic platform direction.`,
        );
      }
      directionByStopId.set(stopId, direction);
    }
  }
  return directionByStopId;
}

// ── Schedules ────────────────────────────────────────────────────────────────

export function buildTrainSchedules(
  feed: GtfsFeed,
  stopTimesByTrip: Map<string, GtfsStopTime[]>,
  stations: StationParent[],
  stopToStation: Map<string, string>,
): TrainSchedulesOutput {
  const stationCount = stations.length;
  const stationIndexByName = new Map(stations.map((s, i) => [s.name, i]));
  const serviceTypes = deriveServiceTypes(feed.calendar, new Date(feed.fetchedAt));

  const schedules: TrainSchedulesOutput = {
    weekday: { northbound: [], southbound: [] },
    weekend: { northbound: [], southbound: [] },
  };

  for (const trip of feed.trips) {
    const { trip_id: tripId, service_id: serviceId } = trip;
    if (!tripId || !serviceId) continue;

    const scheduleType = serviceTypes.get(serviceId);
    if (!scheduleType) continue; // Ignore service IDs that do not map cleanly to weekday/weekend

    const tripStopTimes = stopTimesByTrip.get(tripId);
    if (!tripStopTimes || tripStopTimes.length === 0) continue;

    const sortedStopTimes = [...tripStopTimes].sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence),
    );

    const stationTimes = new Array<string | undefined>(stationCount).fill(
      undefined,
    );
    for (const stopTime of sortedStopTimes) {
      const stationName = stopToStation.get(stopTime.stop_id);
      if (!stationName) continue;

      const stationIndex = stationIndexByName.get(stationName);
      if (stationIndex === undefined) continue;

      const timeRaw = stopTime.departure_time || stopTime.arrival_time;
      if (!timeRaw) continue;

      stationTimes[stationIndex] = toTimeString(timeRaw);
    }

    if (!allTimesPresent(stationTimes)) {
      continue; // Skip trips that do not serve every SMART station
    }

    const direction = inferTripDirection(
      sortedStopTimes,
      stopToStation,
      stationIndexByName,
    );
    if (!direction) continue;

    const times = stationTimes.slice();

    const bucket = schedules[scheduleType][direction];
    const duplicateTrip = bucket.find((existing) =>
      existing.times.every((value, index) => value === times[index]),
    );

    if (duplicateTrip) {
      continue;
    }

    const tripIdentifier = trip.trip_short_name || trip.trip_id;
    const numericId = Number(tripIdentifier.replace(/[^0-9]/g, ""));
    const tripNumber =
      Number.isFinite(numericId) && numericId > 0
        ? numericId
        : bucket.length + 1;

    bucket.push({
      trip: tripNumber,
      times,
    });
  }

  for (const scheduleType of Object.keys(schedules) as ScheduleType[]) {
    for (const direction of ["northbound", "southbound"] as TrainDirection[]) {
      const index = direction === "southbound" ? 0 : stationCount - 1;
      schedules[scheduleType][direction].sort(
        (a, b) => timeToMinutes(a.times[index]) - timeToMinutes(b.times[index]),
      );
    }
  }

  return schedules;
}

export function buildFerrySchedules(feed: GtfsFeed): FerrySchedulesOutput {
  const serviceTypes = deriveServiceTypes(feed.calendar, new Date(feed.fetchedAt));

  // Anchor on the route_id so the trip set doesn't depend on stop names.
  // If the route disappears the sanity floor fails the run.
  if (!feed.routes.some((r) => r.route_id === LARKSPUR_SF_ROUTE_ID)) {
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
  for (const s of feed.stops) {
    const lat = Number(s.stop_lat);
    if (Number.isFinite(lat)) stopLatById.set(s.stop_id, lat);
  }
  const stopRoleMap = new Map<string, "larkspur" | "sf">();
  const stopTimesByTrip = groupStopTimesByTrip(feed.stopTimes);

  const relevantStopIds = new Set<string>();
  for (const trip of feed.trips) {
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

  for (const trip of feed.trips) {
    if (trip.route_id !== LARKSPUR_SF_ROUTE_ID) continue;
    const serviceType = serviceTypes.get(trip.service_id ?? "");
    if (!serviceType) continue;

    const tripStopTimes = stopTimesByTrip.get(trip.trip_id ?? "");
    if (!tripStopTimes) continue;

    const sortedStops = [...tripStopTimes].sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence),
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
    const isInbound = departStop.role === "sf";

    const departureTimeRaw =
      departStop.stopTime.departure_time || departStop.stopTime.arrival_time;
    const arrivalTimeRaw =
      arriveStop.stopTime.arrival_time || arriveStop.stopTime.departure_time;

    if (!departureTimeRaw || !arrivalTimeRaw) continue;

    const depart = toTimeString(departureTimeRaw);
    const arrive = toTimeString(arrivalTimeRaw);

    const key: keyof FerrySchedulesOutput = isInbound
      ? `${serviceType}InboundFerries`
      : `${serviceType}Ferries`;
    ferrySchedules[key].push({ depart, arrive });
  }

  for (const key of Object.keys(
    ferrySchedules,
  ) as (keyof FerrySchedulesOutput)[]) {
    ferrySchedules[key].sort(
      (a, b) => timeToMinutes(a.depart) - timeToMinutes(b.depart),
    );
  }

  return ferrySchedules;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function extractStationCoordinates(
  parents: StationParent[],
): Record<string, { lat: number; lng: number }> {
  const coords: Record<string, { lat: number; lng: number }> = {};
  for (const p of parents) {
    coords[p.name] = { lat: round4(p.lat), lng: round4(p.lng) };
  }
  return coords;
}

// ── Render generated TS as strings ────────────────────────────────────────────
//
// Every renderer below produces byte-identical output to the previous
// emit*File implementations in scripts/updateTransitFeeds.ts. Don't reflow
// these strings — diffing against the committed generated/* files is the
// idempotency check Phase 5 relies on.

export function renderStationsFile(stations: StationParent[]): string {
  const orderLiteral = stations
    .map((s) => `  ${JSON.stringify(s.name)},`)
    .join("\n");
  const zonesLiteral = stations
    .map((s) => `  { station: ${JSON.stringify(s.name)}, zone: ${s.zone} },`)
    .join("\n");
  return `// Auto-generated by scripts/updateTransitFeeds.ts
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
}

/**
 * Build the platform-level stop_id map used by client and server code to
 * resolve realtime `stop_id` references to station names. Every GTFS stop
 * with `location_type=0` is emitted; parent rows are excluded so a feed that
 * drops platforms trips the sanity floor below instead of silently shrinking.
 * Returns the rendered file content + count of platform entries.
 */
export function renderStationPlatformsFile(
  stopIdToStation: Map<string, string>,
  stopIdToDirection: Map<string, TrainDirection>,
  stations: StationParent[],
): { content: string; platformCount: number } {
  const parentIds = new Set(stations.map((s) => s.stopId));
  const platformEntries = [...stopIdToStation.entries()]
    .filter(([stopId]) => !parentIds.has(stopId))
    .sort(([a], [b]) => a.localeCompare(b));

  const platforms: Record<
    string,
    { station: string; direction: TrainDirection }
  > = {};
  for (const [stopId, station] of platformEntries) {
    const direction = stopIdToDirection.get(stopId);
    if (!direction) {
      throw new Error(
        `Platform stop_id ${stopId} (${station}) is not used by any trip; cannot determine direction.`,
      );
    }
    platforms[stopId] = { station, direction };
  }

  const content = `// Auto-generated by scripts/updateTransitFeeds.ts
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
  return { content, platformCount: Object.keys(platforms).length };
}

export function renderStationCoordinatesFile(
  coords: Record<string, { lat: number; lng: number }>,
): string {
  return `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.
import type { Station } from "@/types/smartSchedule";

export const STATION_COORDINATES: Record<Station, { lat: number; lng: number }> = ${JSON.stringify(
    coords,
    null,
    2,
  )};
`;
}

export function renderTrainSchedulesFile(data: TrainSchedulesOutput): string {
  return `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.
import type { TrainSchedule } from "@/types/smartSchedule";

export type ScheduleType = "weekday" | "weekend";

export const trainSchedules: Record<ScheduleType, TrainSchedule> = ${JSON.stringify(
    data,
    null,
    2,
  )};

export default trainSchedules;
`;
}

export function renderScheduleOverridesFile(
  overrides: ScheduleOverridesOutput,
): string {
  return `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.

export type ScheduleType = "weekday" | "weekend";

/**
 * Calendar-date overrides for SMART's effective schedule type, derived
 * from GTFS \`calendar_dates.txt\`. Keys are local "YYYY-MM-DD"; values are
 * the schedule that actually runs that day (e.g. Memorial Day Monday →
 * "weekend"). Dates not in this map fall back to the natural day-of-week
 * classification.
 */
export const scheduleOverrides: Record<string, ScheduleType> = ${JSON.stringify(
    overrides,
    null,
    2,
  )};

export default scheduleOverrides;
`;
}

export function renderFerrySchedulesFile(data: FerrySchedulesOutput): string {
  return `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.
import type { FerryConnection } from "@/types/smartSchedule";

export const weekdayFerries: FerryConnection[] = ${JSON.stringify(
    data.weekdayFerries,
    null,
    2,
  )};

export const weekendFerries: FerryConnection[] = ${JSON.stringify(
    data.weekendFerries,
    null,
    2,
  )};

export const weekdayInboundFerries: FerryConnection[] = ${JSON.stringify(
    data.weekdayInboundFerries,
    null,
    2,
  )};

export const weekendInboundFerries: FerryConnection[] = ${JSON.stringify(
    data.weekendInboundFerries,
    null,
    2,
  )};

export default {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
};
`;
}

export function renderScheduleMetaFile(generatedAt: string): string {
  return `// Auto-generated by scripts/updateTransitFeeds.ts
// Do not edit manually.

/**
 * When the bundled schedule data was derived — the 511 feed's \`fetchedAt\`,
 * the same value stamped into public/data/schedules.json's \`generatedAt\`.
 * Lets the bundled fallback report a real timestamp instead of "unavailable"
 * on a genuine offline cold-launch (before any remote/cached payload loads).
 */
export const SCHEDULE_GENERATED_AT = ${JSON.stringify(generatedAt)};

export default SCHEDULE_GENERATED_AT;
`;
}

// ── Sanity floors ────────────────────────────────────────────────────────────

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
const MIN_PLATFORMS = 28;

/**
 * Sanity-check the derived counts. Returns an array of human-readable
 * failure messages (empty array = healthy). Numbers are well below typical
 * daily counts so seasonal thinning won't trip them — they exist to catch
 * upstream feed-format breakage that silently produces empty arrays.
 */
export function checkSanityFloors(args: {
  stationCount: number;
  platformCount: number;
  trainTripCounts: {
    weekdaySouthbound: number;
    weekdayNorthbound: number;
    weekendSouthbound: number;
    weekendNorthbound: number;
  };
  ferryCounts: {
    weekday: number;
    weekend: number;
    weekdayInbound: number;
    weekendInbound: number;
  };
}): string[] {
  const failures: string[] = [];
  if (args.stationCount < MIN_STATIONS) {
    failures.push(
      `stations: got ${args.stationCount}, expected ≥ ${MIN_STATIONS}`,
    );
  }
  if (args.platformCount < MIN_PLATFORMS) {
    failures.push(
      `platforms: got ${args.platformCount}, expected ≥ ${MIN_PLATFORMS}`,
    );
  }
  for (const [key, min] of Object.entries(MIN_TRIPS)) {
    const got = args.trainTripCounts[key as keyof typeof MIN_TRIPS];
    if (got < min) failures.push(`train.${key}: got ${got}, expected ≥ ${min}`);
  }
  for (const [key, min] of Object.entries(MIN_FERRIES)) {
    const got = args.ferryCounts[key as keyof typeof MIN_FERRIES];
    if (got < min) failures.push(`ferry.${key}: got ${got}, expected ≥ ${min}`);
  }
  return failures;
}
