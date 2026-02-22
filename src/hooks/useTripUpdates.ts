import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiBaseUrl } from "@/lib/env";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type {
  GtfsRtTripUpdatesResponse,
  GtfsRtTripUpdate,
  GtfsRtStopTimeUpdate,
  TripRealtimeStatus,
} from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

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
  toStation: Station
): { scheduledDeparture: string | null; status: TripRealtimeStatus } {
  if (update.scheduleRelationship === "CANCELED") {
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
    // Fallback: match by startTime — only works when fromStation is the trip origin
    if (update.startTime) {
      return {
        scheduledDeparture: update.startTime.slice(0, 5),
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

  // Use departure.time per SMART spec — manually adjusted for holds/delays
  const liveDepartureTime = unixToTimeString(fromUpdate.departureTime);

  // Compute scheduled departure: actual time minus delay
  const delaySeconds = fromUpdate.departureDelay ?? 0;
  const scheduledUnix = fromUpdate.departureTime - delaySeconds;
  const scheduledDeparture = unixToTimeString(scheduledUnix);

  // Delay badge only when > 1 minute (suppress noise)
  const delayMinutes =
    delaySeconds > 60 ? Math.round(delaySeconds / 60) : undefined;

  // Live arrival time at destination, if the feed provides it
  let liveArrivalTime: string | undefined;
  if (toUpdate?.arrivalTime) {
    const arrivalDelaySeconds = toUpdate.arrivalDelay ?? toUpdate.departureDelay ?? 0;
    if (arrivalDelaySeconds > 60) {
      liveArrivalTime = unixToTimeString(toUpdate.arrivalTime);
    }
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

/**
 * Builds a Map from scheduled departure time ("HH:MM") -> TripRealtimeStatus.
 * Keyed by the SCHEDULED departure time at fromStation so it can be matched
 * against ProcessedTrip.departureTime from the static schedule.
 *
 * Note: SMART generates new trip_id values per service date, so we correlate
 * by time rather than by trip_id string.
 */
export function useTripRealtimeStatusMap(
  fromStation: Station | "",
  toStation: Station | ""
): Map<string, TripRealtimeStatus> {
  const { data } = useTripUpdates();

  return useMemo(() => {
    if (!data || !fromStation || !toStation) return new Map();

    const map = new Map<string, TripRealtimeStatus>();
    for (const update of data.updates) {
      const { scheduledDeparture, status } = deriveStatus(
        update,
        fromStation,
        toStation
      );
      if (scheduledDeparture) {
        map.set(scheduledDeparture, status);
      }
    }
    return map;
  }, [data, fromStation, toStation]);
}
