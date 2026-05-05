/**
 * Raw GTFS static data shape — what 511.org returns for each operator,
 * parsed straight from the CSV files inside the GTFS zip archive.
 *
 * Field names mirror the GTFS spec (snake_case) so each interface lines up
 * 1:1 with its source CSV row. All values stay as `string` because that's
 * the source format; numeric/date/boolean coercion happens in the transform
 * step where the use case dictates the right shape.
 *
 * Foreign-key map (the way the tables actually link):
 *
 *   agency.agency_id ─────┐
 *                         ▼
 *              routes.agency_id
 *              routes.route_id ───────┐
 *                                     ▼
 *                          trips.route_id
 *                          trips.trip_id ─────┐
 *                          trips.service_id ──┼─→ calendar.service_id
 *                          trips.shape_id ─┐  │   calendar_dates.service_id
 *                                          │  ▼
 *                                          │  stop_times.trip_id
 *                                          │  stop_times.stop_id ─→ stops.stop_id
 *                                          ▼
 *                                          shapes.shape_id
 *
 *   stops.parent_station ──→ stops.stop_id  (self-join; location_type=1 row)
 *
 * @see https://gtfs.org/schedule/reference/
 */

/**
 * GTFS `agency.txt` row. Each feed has at least one agency; multi-agency
 * feeds (rare for 511 single-operator downloads) require `agency_id`.
 */
export interface GtfsAgency {
  agency_id?: string;
  agency_name: string;
  agency_url: string;
  agency_timezone: string;
  agency_lang?: string;
  agency_phone?: string;
  agency_fare_url?: string;
  agency_email?: string;
}

/**
 * GTFS `route_type` values — the transit mode for a route.
 * 0=Tram, 1=Subway, 2=Rail, 3=Bus, 4=Ferry, 5=CableTram, 6=AerialLift,
 * 7=Funicular, 11=Trolleybus, 12=Monorail.
 */
export type GtfsRouteType =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "11" | "12";

/**
 * GTFS `routes.txt` row. Joined to trips via `route_id`. SMART's feed has
 * one route_id; Golden Gate Ferry has several but only `LSSF`
 * (Larkspur ↔ SF) is consumed here.
 */
export interface GtfsRoute {
  route_id: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name?: string;
  route_desc?: string;
  route_type: GtfsRouteType;
  route_url?: string;
  /** Hex color without `#`, e.g. "11AB75". */
  route_color?: string;
  route_text_color?: string;
  route_sort_order?: string;
}

/**
 * GTFS `trips.txt` row. The center of the schema — links a route, a service
 * calendar, a sequence of stops (via stop_times), and optionally a polyline
 * (via shapes).
 *
 * - `direction_id`: "0" or "1". For SMART, 0 = southbound (Windsor→Larkspur),
 *   1 = northbound. Convention is feed-defined.
 * - `block_id`: opaque grouping for trips driven by the same vehicle, useful
 *   for through-routing analysis.
 */
export interface GtfsTrip {
  route_id: string;
  service_id: string;
  trip_id: string;
  trip_headsign?: string;
  trip_short_name?: string;
  direction_id?: "0" | "1";
  block_id?: string;
  shape_id?: string;
  wheelchair_accessible?: "0" | "1" | "2";
  bikes_allowed?: "0" | "1" | "2";
}

/**
 * GTFS `location_type` values for stops.
 * 0 (or empty) = platform/stop, 1 = parent station, 2 = entrance/exit,
 * 3 = generic node, 4 = boarding area.
 */
export type GtfsLocationType = "0" | "1" | "2" | "3" | "4";

/**
 * GTFS `stops.txt` row. Two row kinds matter for SMART:
 * - `location_type=1` parent stations (one per geographic station)
 * - `location_type=0` (or empty) platforms (typically two per station, one
 *   per direction). Platforms link to their parent via `parent_station`.
 *
 * `stop_lat`/`stop_lon` are decimal-degree strings; coerce to numbers in the
 * transform step.
 */
export interface GtfsStop {
  stop_id: string;
  stop_code?: string;
  stop_name: string;
  stop_desc?: string;
  stop_lat: string;
  stop_lon: string;
  zone_id?: string;
  stop_url?: string;
  location_type?: GtfsLocationType;
  parent_station?: string;
  stop_timezone?: string;
  wheelchair_boarding?: "0" | "1" | "2";
  level_id?: string;
  platform_code?: string;
}

/**
 * GTFS `stop_times.txt` row. Joins a trip to a sequence of stops with
 * arrival/departure times.
 *
 * - `arrival_time` / `departure_time` are "HH:MM:SS"; for trips that cross
 *   midnight, hours can exceed 24 (e.g. "25:30:00" = 1:30 AM next day).
 * - `stop_sequence` is monotonically increasing within a trip but values
 *   need not be consecutive; sort by it before walking a trip.
 * - `pickup_type`/`drop_off_type` 0=regular, 1=none, 2=phone, 3=coordinate.
 */
export interface GtfsStopTime {
  trip_id: string;
  arrival_time?: string;
  departure_time?: string;
  stop_id: string;
  stop_sequence: string;
  stop_headsign?: string;
  pickup_type?: "0" | "1" | "2" | "3";
  drop_off_type?: "0" | "1" | "2" | "3";
  continuous_pickup?: "0" | "1" | "2" | "3";
  continuous_drop_off?: "0" | "1" | "2" | "3";
  shape_dist_traveled?: string;
  timepoint?: "0" | "1";
}

/**
 * GTFS `calendar.txt` row — a regular weekly service pattern over a date
 * range. Each weekday flag is "1" (active) or "0" (inactive). `start_date`
 * and `end_date` are "YYYYMMDD" (inclusive). Joined by `service_id` to
 * trips.txt and to calendar_dates.txt for exceptions.
 */
export interface GtfsCalendar {
  service_id: string;
  monday: "0" | "1";
  tuesday: "0" | "1";
  wednesday: "0" | "1";
  thursday: "0" | "1";
  friday: "0" | "1";
  saturday: "0" | "1";
  sunday: "0" | "1";
  /** "YYYYMMDD" inclusive. */
  start_date: string;
  /** "YYYYMMDD" inclusive. */
  end_date: string;
}

/**
 * GTFS `calendar_dates.txt` row — explicit exceptions to the weekly
 * pattern in calendar.txt. `exception_type` 1 adds service for that date,
 * 2 removes it. Used heavily for holidays and special schedules.
 */
export interface GtfsCalendarDate {
  service_id: string;
  /** "YYYYMMDD". */
  date: string;
  /** 1 = service added, 2 = service removed. */
  exception_type: "1" | "2";
}

/**
 * GTFS `shapes.txt` row — one point along a route's polyline. Joined to
 * trips via `shape_id`. Sort by `shape_pt_sequence` to walk the line.
 *
 * Optional in GTFS — operators may omit shapes. When absent, `GtfsFeed.shapes`
 * is `null` and consumers must source rail/route geometry elsewhere.
 */
export interface GtfsShape {
  shape_id: string;
  shape_pt_lat: string;
  shape_pt_lon: string;
  shape_pt_sequence: string;
  shape_dist_traveled?: string;
}

/**
 * Identity card for a persisted raw 511 feed. The operator-id literal is
 * narrow on purpose — only the two operators this app consumes are valid.
 */
export type GtfsOperatorId = "SA" | "GF";

/**
 * Envelope for the parsed contents of a single 511 GTFS download.
 * Persisted at `data/511/raw/{smart,ferry}.json` and is the sole input to
 * the transform step.
 *
 * Versioned via `schemaVersion` so we can evolve the JSON layout without
 * silently mismatching downstream readers — bump it when the envelope
 * shape changes.
 */
export interface GtfsFeed {
  /** Bump when the envelope shape (not the GTFS contents) changes. */
  schemaVersion: 1;
  operatorId: GtfsOperatorId;
  /** ISO 8601 timestamp of when the feed was fetched. */
  fetchedAt: string;
  /** The 511 datafeeds URL the bytes came from (api_key redacted). */
  sourceUrl: string;
  agency: GtfsAgency[];
  routes: GtfsRoute[];
  trips: GtfsTrip[];
  stops: GtfsStop[];
  stopTimes: GtfsStopTime[];
  calendar: GtfsCalendar[];
  calendarDates: GtfsCalendarDate[];
  /** `null` when the upstream feed omits shapes.txt. */
  shapes: GtfsShape[] | null;
}

/**
 * Sidecar manifest at `data/511/raw/.fetched-at.json`. Tracks per-operator
 * fetch metadata so a `regen-transit` run can warn when raw data is stale.
 */
export interface GtfsRawManifest {
  schemaVersion: 1;
  smart: { fetchedAt: string; sourceUrl: string; bytes: number };
  ferry: { fetchedAt: string; sourceUrl: string; bytes: number };
}
