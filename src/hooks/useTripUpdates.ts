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

function deriveStatus(
  update: GtfsRtTripUpdate,
  fromStation: Station,
  toStation: Station,
  /**
   * Scheduled departure at fromStation from the static timetable ("HH:MM").
   * When provided this is used as the map key and to compute real delay,
   * since 511 always sends departureDelay: 0 and only shifts departure.time.
   */
  scheduledDepartureParam: string | null
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
  let delaySeconds: number;
  if (scheduledDepartureParam && update.startDate) {
    const scheduledUnix = scheduledHHMMtoUnix(update.startDate, scheduledDepartureParam);
    delaySeconds = fromUpdate.departureTime - scheduledUnix;
  } else {
    // Fallback for ADDED/DUPLICATED trips or when no static match was found.
    delaySeconds = fromUpdate.departureDelay ?? 0;
  }

  // The map key is the static scheduled departure — so ScheduleResults can look it
  // up by trip.departureTime (which also comes from the static schedule).
  const scheduledDeparture =
    scheduledDepartureParam ??
    unixToTimeString(fromUpdate.departureTime - (fromUpdate.departureDelay ?? 0));

  // Show any positive delay in seconds (no minimum threshold)
  const delayMinutes = delaySeconds > 0 ? Math.round(delaySeconds / 60) : undefined;

  // Live arrival time at destination: 511 also shifts arrivalTime forward when delayed,
  // but arrivalDelay is always 0 (same issue as departureDelay). Show the live arrival
  // time whenever the train is running late on departure.
  let liveArrivalTime: string | undefined;
  if (toUpdate?.arrivalTime && delaySeconds > 0) {
    liveArrivalTime = unixToTimeString(toUpdate.arrivalTime);
  }

  return {
    scheduledDeparture,
    status: {
      isCanceled: false,
      liveDepartureTime: delayMinutes != null ? liveDepartureTime : undefined,
      liveArrivalTime,
      delayMinutes,
      isOriginSkipped,
      isDestinationSkipped,
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
    const empty: TripRealtimeStatusMaps = { statusMap: new Map(), canceledByStartTime: new Map() };
    if (!data || !fromStation || !toStation) return empty;

    const fromIdx = stationIndexMap[fromStation] ?? -1;
    const toIdx = stationIndexMap[toStation] ?? -1;
    const isSouthbound = fromIdx < toIdx;

    // Build a lookup from a trip's origin departure time ("HH:MM") to the scheduled
    // departure at fromStation ("HH:MM"). Southbound trips originate at the northernmost
    // station (times[0]); northbound trips originate at the southernmost (times[last]).
    const scheduledByOrigin = new Map<string, string>();
    for (const trip of trips) {
      const originTime = isSouthbound
        ? trip.times[0]
        : trip.times[trip.times.length - 1];
      if (originTime) {
        scheduledByOrigin.set(originTime, trip.departureTime);
      }
    }

    const statusMap = new Map<string, TripRealtimeStatus>();
    const canceledByStartTime = new Map<string, TripRealtimeStatus>();

    for (const update of data.updates) {
      // Match this RT update to a static trip via its scheduled origin startTime.
      const originHHMM = update.startTime?.slice(0, 5) ?? null;
      const scheduledDepartureParam = originHHMM
        ? (scheduledByOrigin.get(originHHMM) ?? null)
        : null;

      const { scheduledDeparture, isStartTimeFallback, status } = deriveStatus(
        update,
        fromStation,
        toStation,
        scheduledDepartureParam
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
    return { statusMap, canceledByStartTime };
  }, [data, fromStation, toStation, trips]);
}
