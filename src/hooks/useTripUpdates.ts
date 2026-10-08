import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchGtfsRtJson,
  isFeedUnavailable,
  isUpstreamFeedDown,
} from "@/lib/gtfsRtFetch";
import { delayMinutesFromSeconds } from "@/lib/tripDelay";
import {
  GTFS_STOP_ID_TO_PLATFORM,
  stationIndexMap,
  getTripDirection,
  type TrainDirection,
} from "@/lib/stationUtils";
import type {
  GtfsRtTripUpdatesResponse,
  GtfsRtTripUpdate,
  GtfsRtStopTimeUpdate,
  TripRealtimeStatus,
} from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { findRun } from "@/lib/runMatch";
import { agencyClockHHMM, agencyWallTimeToEpochSeconds } from "@/lib/timeUtils";
import { tripOriginStartTime } from "@/lib/tripProgress";

const TRIP_UPDATES_POLL_INTERVAL = 30 * 1000; // 30 seconds

function fetchTripUpdates(): Promise<GtfsRtTripUpdatesResponse> {
  return fetchGtfsRtJson<GtfsRtTripUpdatesResponse>("/api/gtfsrt/tripupdates");
}

/**
 * Convert a Unix timestamp (seconds) to "HH:MM" in the agency timezone — NOT the
 * device's. The static timetable is Pacific wall time, so live times and the
 * delay diff below must read in Pacific to stay correct on an off-region device.
 */
function unixToTimeString(unix: number): string {
  return agencyClockHHMM(unix);
}

/**
 * Convert a static scheduled time ("HH:MM") on a given date ("YYYYMMDD") to Unix
 * seconds, interpreting the wall time in the agency timezone to match
 * unixToTimeString().
 *
 * NOTE: 511.org always sends departureDelay: 0 even for delayed trains — they only
 * update departure.time. To detect real delays we must diff the live departure.time
 * against the scheduled time from the static timetable.
 */
function scheduledHHMMtoUnix(yyyymmdd: string, hhmm: string): number {
  return agencyWallTimeToEpochSeconds(yyyymmdd, hhmm);
}

/**
 * Resolve a feed stop_time_update to a (station, direction) pair via the
 * platform map. Returns null when the stop_id is unknown or absent — those
 * entries are not used for any per-trip matching.
 */
function resolvePlatform(
  stu: GtfsRtStopTimeUpdate
): { station: Station; direction: TrainDirection } | null {
  if (!stu.stopId) return null;
  const platform = GTFS_STOP_ID_TO_PLATFORM[stu.stopId];
  return platform ?? null;
}

/**
 * Find the stop_time_update for a given station ON THIS TRIP'S DIRECTION.
 * Matching is strictly stop_id-based: the feed's stop_id must resolve to a
 * platform whose station matches AND whose direction matches the trip's
 * direction. This rejects entries from the opposite-direction platform that
 * happens to share a station name.
 */
function findStopUpdate(
  stopTimeUpdates: GtfsRtStopTimeUpdate[],
  station: Station,
  direction: TrainDirection
): GtfsRtStopTimeUpdate | undefined {
  return stopTimeUpdates.find((s) => {
    const platform = resolvePlatform(s);
    return platform?.station === station && platform?.direction === direction;
  });
}

/**
 * Diff a live Unix timestamp against a static scheduled "HH:MM" on a given date,
 * returning delay in whole minutes, or undefined if within the on-time threshold.
 * Used for both trip-level and per-stop delay (and by useMapTrains for the map
 * markers) so the logic stays in one place.
 */
export function computeDelayMinutes(
  liveUnix: number,
  scheduledHHMM: string,
  startDate: string
): number | undefined {
  const delaySeconds = liveUnix - scheduledHHMMtoUnix(startDate, scheduledHHMM);
  return delayMinutesFromSeconds(delaySeconds) ?? undefined;
}

/**
 * Build maps of station name → live departure "HH:MM" and per-stop delay minutes
 * from all stop_time_updates. Delay is computed via computeDelayMinutes against
 * the app's own static schedule, so it is immune to rounding noise from
 * differences between the GTFS static feed and the app's hardcoded schedule.
 *
 * Matching is direction-aware ID matching: only stop_time_updates whose
 * `stop_id` resolves to a platform on the trip's direction are considered.
 * This handles SMART's round-trip GTFS encoding — e.g. when a single trip
 * passes through Santa Rosa Downtown northbound (wrong leg) and again
 * southbound (correct leg), only the southbound platform's update is used.
 * `minStopSequence` is retained as a defensive secondary filter for any
 * future case where two same-direction passes coexist on one trip.
 */
function buildStopRealtimeData(
  stopTimeUpdates: GtfsRtStopTimeUpdate[],
  scheduledTimesByStation: Partial<Record<string, string>>,
  startDate: string | undefined,
  direction: TrainDirection,
  minStopSequence?: number
): {
  allStopLiveDepartures: Partial<Record<string, string>>;
  allStopDelayMinutes: Partial<Record<string, number>>;
} {
  const allStopLiveDepartures: Partial<Record<string, string>> = {};
  const allStopDelayMinutes: Partial<Record<string, number>> = {};

  for (const stu of stopTimeUpdates) {
    if (!stu.departureTime) continue;
    if (minStopSequence != null && stu.stopSequence != null && stu.stopSequence < minStopSequence) continue;
    const platform = resolvePlatform(stu);
    if (!platform || platform.direction !== direction) continue;
    const { station } = platform;

    allStopLiveDepartures[station] = unixToTimeString(stu.departureTime);

    const scheduledHHMM = scheduledTimesByStation[station];
    if (scheduledHHMM && startDate) {
      const delay = computeDelayMinutes(stu.departureTime, scheduledHHMM, startDate);
      if (delay != null) allStopDelayMinutes[station] = delay;
    }
  }

  return { allStopLiveDepartures, allStopDelayMinutes };
}

type DerivedStatusResult =
  | { kind: "primary"; scheduledDeparture: string; status: TripRealtimeStatus }
  | { kind: "fallback"; scheduledDeparture: string; status: TripRealtimeStatus }
  | { kind: "none" };

const CANCELED_STATUS: TripRealtimeStatus = {
  isCanceled: true,
  isOriginSkipped: false,
  isDestinationSkipped: false,
};

/**
 * CANCELED branch: pick a usable key for the cancellation badge. Prefers
 * the caller's static scheduled departure; falls back through the feed's
 * own stop_time_updates and finally to the trip startTime (flagged so
 * callers can do a secondary scan against trip.times).
 */
function deriveCanceledStatus(
  update: GtfsRtTripUpdate,
  fromStation: Station,
  direction: TrainDirection,
  scheduledDepartureParam: string | null,
): DerivedStatusResult {
  if (scheduledDepartureParam) {
    return {
      kind: "primary",
      scheduledDeparture: scheduledDepartureParam,
      status: CANCELED_STATUS,
    };
  }
  const fromUpdate = findStopUpdate(update.stopTimeUpdates, fromStation, direction);
  if (fromUpdate?.departureTime) {
    return {
      kind: "primary",
      scheduledDeparture: unixToTimeString(fromUpdate.departureTime),
      status: CANCELED_STATUS,
    };
  }
  if (update.startTime) {
    return {
      kind: "fallback",
      scheduledDeparture: update.startTime.slice(0, 5),
      status: CANCELED_STATUS,
    };
  }
  return { kind: "none" };
}

/**
 * EN-ROUTE branch: the leg's boarding stop has already been served and pruned
 * from the feed (511 drops past stops), so there is no live departure to key
 * on — but the run is still identifiable via its static-schedule match (trip
 * startTime → scheduledDepartureParam). Surface the remaining per-stop live
 * data and the destination arrival, so an en-route train keeps its realtime
 * status — delay accents, live timeline times, live arrival for the trip
 * sheet and auto-clear — instead of silently reverting to schedule-only
 * display. Without this, the map marker (computed from the raw feed) showed a
 * train delayed while its own detail sheet, whose status had vanished with
 * the pruned origin, read "On time".
 */
function deriveEnRouteStatus(
  update: GtfsRtTripUpdate,
  toUpdate: GtfsRtStopTimeUpdate | undefined,
  direction: TrainDirection,
  scheduledDepartureParam: string | null,
  scheduledArrivalParam: string | null,
  scheduledTimesByStation: Partial<Record<string, string>>,
  isOriginSkipped: boolean,
): DerivedStatusResult {
  // No static match → no stable key for the status map; a station-only match
  // could attach this run's data to the wrong trip.
  if (!scheduledDepartureParam) return { kind: "none" };

  const { allStopLiveDepartures, allStopDelayMinutes } = buildStopRealtimeData(
    update.stopTimeUpdates,
    scheduledTimesByStation,
    update.startDate,
    direction,
  );

  let liveArrivalTime: string | undefined;
  let arrivalDelayMinutes: number | undefined;
  if (toUpdate?.arrivalTime && scheduledArrivalParam && update.startDate) {
    arrivalDelayMinutes = computeDelayMinutes(
      toUpdate.arrivalTime,
      scheduledArrivalParam,
      update.startDate,
    );
    if (arrivalDelayMinutes != null) {
      liveArrivalTime = unixToTimeString(toUpdate.arrivalTime);
    }
  }

  const hasRealtimeStopData = Object.keys(allStopLiveDepartures).length > 0;
  // Nothing usable on this leg's direction (e.g. only the opposite leg of a
  // round-trip-encoded GTFS trip remains) — don't key an empty status.
  if (!hasRealtimeStopData && liveArrivalTime == null) return { kind: "none" };

  return {
    kind: "primary",
    scheduledDeparture: scheduledDepartureParam,
    status: {
      isCanceled: false,
      liveArrivalTime,
      arrivalDelayMinutes,
      isOriginSkipped,
      isDestinationSkipped: toUpdate?.scheduleRelationship === "SKIPPED",
      allStopLiveDepartures,
      allStopDelayMinutes,
      hasRealtimeStopData,
    },
  };
}

/**
 * Normal (non-canceled) branch: compute live departure/arrival times,
 * delay minutes, and per-stop realtime data for the requested station pair.
 */
function deriveScheduledStatus(
  update: GtfsRtTripUpdate,
  fromStation: Station,
  toStation: Station,
  direction: TrainDirection,
  scheduledDepartureParam: string | null,
  scheduledArrivalParam: string | null,
  scheduledTimesByStation: Partial<Record<string, string>>,
): DerivedStatusResult {
  const fromUpdate = findStopUpdate(update.stopTimeUpdates, fromStation, direction);
  const toUpdate = findStopUpdate(update.stopTimeUpdates, toStation, direction);

  if (!fromUpdate?.departureTime) {
    return deriveEnRouteStatus(
      update,
      toUpdate,
      direction,
      scheduledDepartureParam,
      scheduledArrivalParam,
      scheduledTimesByStation,
      fromUpdate?.scheduleRelationship === "SKIPPED",
    );
  }

  const isOriginSkipped = fromUpdate.scheduleRelationship === "SKIPPED";
  const isDestinationSkipped = toUpdate?.scheduleRelationship === "SKIPPED";

  // Use departure.time per SMART spec — manually adjusted for holds/delays.
  const liveDepartureTime = unixToTimeString(fromUpdate.departureTime);

  // Compute delay by diffing the live departure.time against the static
  // scheduled time. 511 always sends departureDelay: 0 even for delayed
  // trains, so we cannot use that field for primary detection.
  const delayMinutes =
    scheduledDepartureParam && update.startDate
      ? computeDelayMinutes(fromUpdate.departureTime, scheduledDepartureParam, update.startDate)
      : // Fallback for ADDED/DUPLICATED trips or when no static match was found.
        fromUpdate.departureDelay != null
        ? (delayMinutesFromSeconds(fromUpdate.departureDelay) ?? undefined)
        : undefined;

  // The map key is the static scheduled departure — so ScheduleResults can
  // look it up by trip.departureTime (which also comes from the static schedule).
  const scheduledDeparture =
    scheduledDepartureParam ??
    unixToTimeString(fromUpdate.departureTime - (fromUpdate.departureDelay ?? 0));

  const isDelayed = delayMinutes != null;

  // Live arrival time at destination: 511 also shifts arrivalTime forward
  // when delayed, but arrivalDelay is always 0. Diff the live arrival against
  // the static schedule independently of the departure delay — a train can
  // leave its origin on time and fall behind EN ROUTE, in which case
  // delayMinutes (departure-based) stays undefined while the arrival is late.
  // Gating the live arrival on isDelayed alone made such a trip look like it
  // arrived on schedule, so the app ended it while it was still running.
  let liveArrivalTime: string | undefined;
  let arrivalDelayMinutes: number | undefined;
  if (toUpdate?.arrivalTime) {
    if (scheduledArrivalParam && update.startDate) {
      arrivalDelayMinutes = computeDelayMinutes(
        toUpdate.arrivalTime,
        scheduledArrivalParam,
        update.startDate,
      );
    }
    if (isDelayed || arrivalDelayMinutes != null) {
      liveArrivalTime = unixToTimeString(toUpdate.arrivalTime);
    }
  }

  const { allStopLiveDepartures, allStopDelayMinutes } = buildStopRealtimeData(
    update.stopTimeUpdates,
    scheduledTimesByStation,
    update.startDate,
    direction,
    fromUpdate.stopSequence,
  );
  const hasRealtimeStopData = Object.keys(allStopLiveDepartures).length > 0;

  return {
    kind: "primary",
    scheduledDeparture,
    status: {
      isCanceled: false,
      liveDepartureTime: delayMinutes != null ? liveDepartureTime : undefined,
      liveArrivalTime,
      delayMinutes,
      arrivalDelayMinutes,
      isOriginSkipped: !!isOriginSkipped,
      isDestinationSkipped: !!isDestinationSkipped,
      allStopLiveDepartures,
      allStopDelayMinutes,
      hasRealtimeStopData,
    },
  };
}

// Exported for unit tests (pure dispatcher over the branches above).
export function deriveStatus(
  update: GtfsRtTripUpdate,
  fromStation: Station,
  toStation: Station,
  direction: TrainDirection,
  /**
   * Scheduled departure at fromStation from the static timetable ("HH:MM").
   * When provided this is used as the map key and to compute real delay,
   * since 511 always sends departureDelay: 0 and only shifts departure.time.
   */
  scheduledDepartureParam: string | null,
  /** Scheduled arrival at toStation from the static timetable ("HH:MM"). */
  scheduledArrivalParam: string | null,
  /** All static scheduled times for this trip, keyed by station name. Used to
   *  compute per-stop delay against the app's own schedule (not GTFS static). */
  scheduledTimesByStation: Partial<Record<string, string>>,
): DerivedStatusResult {
  if (update.scheduleRelationship === "CANCELED") {
    return deriveCanceledStatus(update, fromStation, direction, scheduledDepartureParam);
  }
  return deriveScheduledStatus(
    update,
    fromStation,
    toStation,
    direction,
    scheduledDepartureParam,
    scheduledArrivalParam,
    scheduledTimesByStation,
  );
}

export function useTripUpdates() {
  return useQuery({
    queryKey: ["gtfsrt", "tripupdates"],
    queryFn: fetchTripUpdates,
    refetchInterval: TRIP_UPDATES_POLL_INTERVAL,
    staleTime: 25 * 1000,
    retry: 2,
  });
}

export interface TripRealtimeStatusMaps {
  /** Primary map: keyed by scheduled departure time ("HH:MM") at fromStation. */
  statusMap: Map<string, TripRealtimeStatus>;
  /**
   * Secondary map for canceled trips where the RT feed omitted stop_time_updates
   * for the user's fromStation. Keyed by the trip's origin startTime ("HH:MM").
   * Callers should scan ProcessedTrip.times for any matching key as a fallback.
   */
  canceledByStartTime: Map<string, TripRealtimeStatus>;
  /** When the GTFS-RT data was last successfully fetched (null if never). */
  lastUpdated: Date | null;
  /** True when the 511 upstream feed is failing (so the UI can say so). */
  isUpstreamDown: boolean;
  /** True when the most recent fetch failed for ANY reason (502 / 500 / network).
   *  Used to surface "live data unavailable" on a cold start even when the
   *  failure is not specifically a 511 outage. */
  isFeedUnavailable: boolean;
}

/** Pair each feed update with its static trip via {@link findRun}; a trip-id pairing
 *  isn't taken over by another trip's origin-time fallback. */
export function matchUpdatesToTrips<T extends { tripId?: string; times: string[] }>(
  updates: readonly GtfsRtTripUpdate[],
  trips: readonly T[],
  southbound: boolean,
  serviceDay?: string,
): Map<GtfsRtTripUpdate, T> {
  const paired = new Map<GtfsRtTripUpdate, T>();
  const pairedById = new Set<GtfsRtTripUpdate>();
  for (const trip of trips) {
    const update = findRun(
      updates,
      {
        tripId: trip.tripId,
        originStartTime: tripOriginStartTime(trip.times, southbound),
        serviceDay,
        directionId: southbound ? 0 : 1,
      },
      (u) => u,
    );
    if (!update) continue;
    const byId = !!trip.tripId && update.tripId === trip.tripId;
    if (!byId && pairedById.has(update)) continue;
    paired.set(update, trip);
    if (byId) pairedById.add(update);
  }
  return paired;
}

/**
 * A trip's live status from its leg's status maps: by its scheduled departure,
 * else — for a canceled run the feed sent without stop times — by any of its
 * stop times matching a canceled run's start time. Null when the feed has
 * nothing for it.
 */
export function findRealtimeStatus(
  { statusMap, canceledByStartTime }: Pick<TripRealtimeStatusMaps, "statusMap" | "canceledByStartTime">,
  trip: Pick<ProcessedTrip, "departureTime" | "times">,
): TripRealtimeStatus | null {
  const primary = statusMap.get(trip.departureTime);
  if (primary) return primary;
  for (const time of trip.times) {
    const secondary = canceledByStartTime.get(time);
    if (secondary) return secondary;
  }
  return null;
}

/**
 * Builds maps from departure times to TripRealtimeStatus.
 * Primary map is keyed by the SCHEDULED departure time at fromStation (from the
 * static timetable), so it aligns with trip.departureTime in ScheduleResults.
 *
 * Delay detection: 511 always sends departureDelay: 0 and only shifts departure.time,
 * so we match each RT update to its static trip ({@link matchUpdatesToTrips}) and
 * compute the delay by diffing the live departure.time against the static scheduled time.
 */
export function useTripRealtimeStatusMap(
  fromStation: Station | "",
  toStation: Station | "",
  trips: ProcessedTrip[],
  serviceDay?: string,
): TripRealtimeStatusMaps {
  const { data, error } = useTripUpdates();
  const isUpstreamDown = isUpstreamFeedDown(error);
  const feedUnavailable = isFeedUnavailable(error);

  return useMemo(() => {
    const lastUpdated =
      data?.timestamp != null ? new Date(data.timestamp * 1000) : null;
    const empty: TripRealtimeStatusMaps = { statusMap: new Map(), canceledByStartTime: new Map(), lastUpdated, isUpstreamDown, isFeedUnavailable: feedUnavailable };
    if (!data || !fromStation || !toStation) return empty;

    const direction = getTripDirection(fromStation as Station, toStation as Station);
    const staticByUpdate = matchUpdatesToTrips(
      data.updates,
      trips,
      direction === "southbound",
      serviceDay,
    );

    const statusMap = new Map<string, TripRealtimeStatus>();
    const canceledByStartTime = new Map<string, TripRealtimeStatus>();

    for (const update of data.updates) {
      const staticTrip = staticByUpdate.get(update) ?? null;
      const scheduledDepartureParam = staticTrip?.departureTime ?? null;
      const scheduledArrivalParam = staticTrip?.arrivalTime ?? null;

      // Build a per-station schedule map so deriveStatus can compute per-stop delay
      // against the app's own static times (not the official GTFS static schedule).
      const scheduledTimesByStation: Partial<Record<string, string>> = {};
      if (staticTrip) {
        for (const [station, idx] of Object.entries(stationIndexMap) as [Station, number][]) {
          const t = staticTrip.times[idx];
          if (t && t !== "--" && t !== "") scheduledTimesByStation[station] = t;
        }
      }

      const result = deriveStatus(
        update,
        fromStation,
        toStation,
        direction,
        scheduledDepartureParam,
        scheduledArrivalParam,
        scheduledTimesByStation,
      );
      if (result.kind === "primary") {
        statusMap.set(result.scheduledDeparture, result.status);
      } else if (result.kind === "fallback") {
        // Don't add to the main map with a potentially wrong key. Store
        // separately so ScheduleResults can scan trip.times for a match.
        canceledByStartTime.set(result.scheduledDeparture, result.status);
      }
    }
    return { statusMap, canceledByStartTime, lastUpdated, isUpstreamDown, isFeedUnavailable: feedUnavailable };
  }, [data, fromStation, toStation, trips, serviceDay, isUpstreamDown, feedUnavailable]);
}
