import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiBaseUrl } from "@/lib/env";
import { GTFS_STOP_ID_TO_STATION, stationIndexMap } from "@/lib/stationUtils";
import type {
  GtfsRtTripUpdatesResponse,
  GtfsRtTripUpdate,
  GtfsRtStopTimeUpdate,
  TripRealtimeStatus,
} from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import type { ProcessedTrip } from "@/lib/scheduleUtils";

const TRIP_UPDATES_POLL_INTERVAL = 30 * 1000; // 30 seconds
// GTFS-RT timestamps have second-level precision while our app schedule is minute-level.
// A 1-2 minute threshold creates too many false positives when feeds drift slightly.
// Treat only >=3 minutes as delayed to reduce incorrect "Delayed" badges.
const MIN_DELAY_SECONDS = 3 * 60;

async function fetchTripUpdates(): Promise<GtfsRtTripUpdatesResponse> {
  const res = await fetch(`${apiBaseUrl}/api/gtfsrt/tripupdates`);
  if (!res.ok) throw new Error(`Trip updates fetch failed: ${res.status}`);
  return res.json() as Promise<GtfsRtTripUpdatesResponse>;
}

/** Convert a Unix timestamp (seconds) to "HH:MM" string in local time */
function unixToTimeString(unix: number): string {
  const date = new Date(unix * 1000);
  const h = date.getHours();
  const m = date.getMinutes();
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Convert a static scheduled time ("HH:MM") on a given date ("YYYYMMDD") to Unix seconds.
 * Uses local time to match unixToTimeString().
 *
 * NOTE: 511.org always sends departureDelay: 0 even for delayed trains — they only
 * update departure.time. To detect real delays we must diff the live departure.time
 * against the scheduled time from the static timetable.
 */
function scheduledHHMMtoUnix(yyyymmdd: string, hhmm: string): number {
  const year = parseInt(yyyymmdd.slice(0, 4), 10);
  const month = parseInt(yyyymmdd.slice(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(yyyymmdd.slice(6, 8), 10);
  const [h, m] = hhmm.split(":").map(Number);
  return Math.floor(new Date(year, month, day, h, m, 0).getTime() / 1000);
}

function findStopUpdate(
  stopTimeUpdates: GtfsRtStopTimeUpdate[],
  station: Station
): GtfsRtStopTimeUpdate | undefined {
  return stopTimeUpdates.find(
    (s) => s.stopId != null && GTFS_STOP_ID_TO_STATION[s.stopId] === station
  );
}

/**
 * Diff a live Unix timestamp against a static scheduled "HH:MM" on a given date,
 * returning delay in whole minutes, or undefined if within the on-time threshold.
 * Used for both trip-level and per-stop delay so the logic stays in one place.
 */
function computeDelayMinutes(
  liveUnix: number,
  scheduledHHMM: string,
  startDate: string
): number | undefined {
  const delaySeconds = liveUnix - scheduledHHMMtoUnix(startDate, scheduledHHMM);
  return delaySeconds >= MIN_DELAY_SECONDS ? Math.round(delaySeconds / 60) : undefined;
}

/**
 * Build maps of station name → live departure "HH:MM" and per-stop delay minutes
 * from all stop_time_updates. Delay is computed via computeDelayMinutes against
 * the app's own static schedule, so it is immune to rounding noise from
 * differences between the GTFS static feed and the app's hardcoded schedule.
 *
 * minStopSequence: when provided, entries with a stopSequence strictly less than
 * this value are skipped. SMART encodes some trips as a single round-trip GTFS
 * trip (e.g. southbound → northern terminus → southbound), so a station like
 * "Santa Rosa Downtown" can appear twice: once on the northbound leg (lower
 * stopSequence, wrong departure time) and once on the southbound leg (higher
 * stopSequence, correct time). Passing the origin station's stopSequence here
 * excludes the pre-origin pass-through entries.
 */
function buildStopRealtimeData(
  stopTimeUpdates: GtfsRtStopTimeUpdate[],
  scheduledTimesByStation: Partial<Record<string, string>>,
  startDate: string | undefined,
  minStopSequence?: number
): {
  allStopLiveDepartures: Partial<Record<string, string>>;
  allStopDelayMinutes: Partial<Record<string, number>>;
} {
  const allStopLiveDepartures: Partial<Record<string, string>> = {};
  const allStopDelayMinutes: Partial<Record<string, number>> = {};

  for (const stu of stopTimeUpdates) {
    if (!stu.stopId || !stu.departureTime) continue;
    // Skip stops that belong to the pre-origin leg of the trip (earlier in the
    // stop sequence than the user's boarding station).
    if (minStopSequence != null && stu.stopSequence != null && stu.stopSequence < minStopSequence) continue;
    const station = GTFS_STOP_ID_TO_STATION[stu.stopId];
    if (!station) continue;

    // Each station has two platform IDs (northbound/southbound); last one wins.
    allStopLiveDepartures[station] = unixToTimeString(stu.departureTime);

    const scheduledHHMM = scheduledTimesByStation[station];
    if (scheduledHHMM && startDate) {
      const delay = computeDelayMinutes(stu.departureTime, scheduledHHMM, startDate);
      if (delay != null) allStopDelayMinutes[station] = delay;
    }
  }

  return { allStopLiveDepartures, allStopDelayMinutes };
}

function deriveStatus(
  update: GtfsRtTripUpdate,
  fromStation: Station,
  toStation: Station,
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
  scheduledTimesByStation: Partial<Record<string, string>>
): { scheduledDeparture: string | null; isStartTimeFallback?: boolean; status: TripRealtimeStatus } {
  if (update.scheduleRelationship === "CANCELED") {
    // Prefer the static scheduled departure as the key so the canceled badge
    // lines up with the correct trip card even when 511 omits stop_time_updates.
    if (scheduledDepartureParam) {
      return {
        scheduledDeparture: scheduledDepartureParam,
        status: { isCanceled: true, isOriginSkipped: false, isDestinationSkipped: false },
      };
    }
    // Some feeds include stop_time_updates with scheduled times even for CANCELED trips.
    // Use those to key by scheduled departure so the canceled badge shows for any station pair.
    const fromUpdate = findStopUpdate(update.stopTimeUpdates, fromStation);
    if (fromUpdate?.departureTime) {
      const scheduledDeparture = unixToTimeString(fromUpdate.departureTime);
      return {
        scheduledDeparture,
        status: {
          isCanceled: true,
          isOriginSkipped: false,
          isDestinationSkipped: false,
        },
      };
    }
    // Fallback: the feed omitted stop_time_updates for this station pair.
    // Key by startTime (origin departure), but flag it so callers can do a secondary
    // scan against trip.times instead of relying on a direct departureTime match.
    if (update.startTime) {
      return {
        scheduledDeparture: update.startTime.slice(0, 5),
        isStartTimeFallback: true,
        status: {
          isCanceled: true,
          isOriginSkipped: false,
          isDestinationSkipped: false,
        },
      };
    }
    return {
      scheduledDeparture: null,
      status: {
        isCanceled: true,
        isOriginSkipped: false,
        isDestinationSkipped: false,
      },
    };
  }

  const fromUpdate = findStopUpdate(update.stopTimeUpdates, fromStation);
  const toUpdate = findStopUpdate(update.stopTimeUpdates, toStation);

  if (!fromUpdate?.departureTime) {
    // No data for this station pair in this update
    return {
      scheduledDeparture: null,
      status: {
        isCanceled: false,
        isOriginSkipped: false,
        isDestinationSkipped: false,
      },
    };
  }

  const isOriginSkipped = fromUpdate.scheduleRelationship === "SKIPPED";
  const isDestinationSkipped = toUpdate?.scheduleRelationship === "SKIPPED";

  // Use departure.time per SMART spec — manually adjusted for holds/delays.
  const liveDepartureTime = unixToTimeString(fromUpdate.departureTime);

  // Compute delay by diffing the live departure.time against the static scheduled time.
  // 511 always sends departureDelay: 0 even for delayed trains, so we cannot use
  // that field. Instead we rely on the static timetable passed in from the caller.
  const delayMinutes =
    scheduledDepartureParam && update.startDate
      ? computeDelayMinutes(fromUpdate.departureTime, scheduledDepartureParam, update.startDate)
      : // Fallback for ADDED/DUPLICATED trips or when no static match was found.
        fromUpdate.departureDelay != null && fromUpdate.departureDelay >= MIN_DELAY_SECONDS
        ? Math.round(fromUpdate.departureDelay / 60)
        : undefined;

  // The map key is the static scheduled departure — so ScheduleResults can look it
  // up by trip.departureTime (which also comes from the static schedule).
  const scheduledDeparture =
    scheduledDepartureParam ??
    unixToTimeString(fromUpdate.departureTime - (fromUpdate.departureDelay ?? 0));

  const isDelayed = delayMinutes != null;

  // Live arrival time at destination: 511 also shifts arrivalTime forward when delayed,
  // but arrivalDelay is always 0 (same issue as departureDelay). Show the live arrival
  // time whenever the train is running late on departure.
  let liveArrivalTime: string | undefined;
  let arrivalDelayMinutes: number | undefined;
  if (toUpdate?.arrivalTime && isDelayed) {
    liveArrivalTime = unixToTimeString(toUpdate.arrivalTime);
    if (scheduledArrivalParam && update.startDate) {
      arrivalDelayMinutes = computeDelayMinutes(
        toUpdate.arrivalTime,
        scheduledArrivalParam,
        update.startDate
      );
    }
  }

  const { allStopLiveDepartures, allStopDelayMinutes } = buildStopRealtimeData(
    update.stopTimeUpdates,
    scheduledTimesByStation,
    update.startDate,
    fromUpdate?.stopSequence
  );
  const hasRealtimeStopData = Object.keys(allStopLiveDepartures).length > 0;

  return {
    scheduledDeparture,
    status: {
      isCanceled: false,
      liveDepartureTime: delayMinutes != null ? liveDepartureTime : undefined,
      liveArrivalTime,
      delayMinutes,
      arrivalDelayMinutes,
      isOriginSkipped,
      isDestinationSkipped,
      allStopLiveDepartures,
      allStopDelayMinutes,
      hasRealtimeStopData,
    },
  };
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
}

/**
 * Builds maps from departure times to TripRealtimeStatus.
 * Primary map is keyed by the SCHEDULED departure time at fromStation (from the
 * static timetable), so it aligns with trip.departureTime in ScheduleResults.
 *
 * Delay detection: 511 always sends departureDelay: 0 and only shifts departure.time,
 * so we match each RT update to a static trip via startTime and compute the delay
 * by diffing the live departure.time against the static scheduled time.
 */
export function useTripRealtimeStatusMap(
  fromStation: Station | "",
  toStation: Station | "",
  trips: ProcessedTrip[]
): TripRealtimeStatusMaps {
  const { data } = useTripUpdates();

  return useMemo(() => {
    const lastUpdated =
      data?.timestamp != null ? new Date(data.timestamp * 1000) : null;
    const empty: TripRealtimeStatusMaps = { statusMap: new Map(), canceledByStartTime: new Map(), lastUpdated };
    if (!data || !fromStation || !toStation) return empty;

    const fromIdx = stationIndexMap[fromStation] ?? -1;
    const toIdx = stationIndexMap[toStation] ?? -1;
    const isSouthbound = fromIdx < toIdx;

    // Build a lookup from a trip's origin departure time ("HH:MM") to the scheduled
    // departure and arrival times at fromStation/toStation ("HH:MM"). Southbound trips
    // originate at the northernmost station (times[0]); northbound at the southernmost (times[last]).
    const scheduledByOrigin = new Map<string, { departureTime: string; arrivalTime: string; times: string[] }>();
    for (const trip of trips) {
      const originTime = isSouthbound
        ? trip.times[0]
        : trip.times[trip.times.length - 1];
      if (originTime) {
        scheduledByOrigin.set(originTime, { departureTime: trip.departureTime, arrivalTime: trip.arrivalTime, times: trip.times });
      }
    }

    const statusMap = new Map<string, TripRealtimeStatus>();
    const canceledByStartTime = new Map<string, TripRealtimeStatus>();

    for (const update of data.updates) {
      // Match this RT update to a static trip via its scheduled origin startTime.
      const originHHMM = update.startTime?.slice(0, 5) ?? null;
      const staticTrip = originHHMM ? (scheduledByOrigin.get(originHHMM) ?? null) : null;
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

      const { scheduledDeparture, isStartTimeFallback, status } = deriveStatus(
        update,
        fromStation,
        toStation,
        scheduledDepartureParam,
        scheduledArrivalParam,
        scheduledTimesByStation
      );
      if (scheduledDeparture) {
        if (isStartTimeFallback) {
          // Don't add to the main map with a potentially wrong key.
          // Store separately so ScheduleResults can scan trip.times for a match.
          canceledByStartTime.set(scheduledDeparture, status);
        } else {
          statusMap.set(scheduledDeparture, status);
        }
      }
    }
    return { statusMap, canceledByStartTime, lastUpdated };
  }, [data, fromStation, toStation, trips]);
}
