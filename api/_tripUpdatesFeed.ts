import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { TRIP_SCHEDULE_RELATIONSHIP, STOP_SCHEDULE_RELATIONSHIP } from "./_gtfsrt.js";

type FeedMessage = GtfsRealtime.IFeedMessage;
type FeedEntity = GtfsRealtime.IFeedEntity;
type TripUpdateData = GtfsRealtime.ITripUpdate;
type StopTimeUpdate = GtfsRealtime.TripUpdate.IStopTimeUpdate;

/**
 * Max age (ms) before the shared Redis cache refreshes the trip-updates feed
 * from 511 — bounds the GLOBAL upstream poll rate to stay under the rate limit.
 * Shared by the `/api/gtfsrt/tripupdates` endpoint and the in-process read the
 * Live Activity cron does, so both honour the same one-fetch-per-window budget.
 */
export const TRIPUPDATES_FRESHNESS_MS = 40_000;

export interface NormalizedStopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrivalTime?: number; // unix seconds
  departureTime?: number; // unix seconds
  scheduleRelationship: string;
  departureDelay?: number;
}

export interface NormalizedTripUpdate {
  tripId: string;
  routeId?: string;
  startDate?: string;
  startTime?: string;
  scheduleRelationship: string;
  duplicatedTripRef?: string;
  stopTimeUpdates: NormalizedStopTimeUpdate[];
}

/**
 * Normalize a decoded GTFS-RT trip-updates feed to the JSON shape the
 * `/api/gtfsrt/tripupdates` endpoint serves. Pure.
 *
 * Exported so the Live Activity push cron can produce the SAME shape in-process
 * (via `fetchFeedCached` + `decodeFeed`) instead of fetching its own endpoint
 * over HTTP — that round-trip cold-starts a second function and intermittently
 * exceeded the cron's timeout, skipping whole runs. In-process reuses the same
 * Redis-backed 511 cache, so the upstream poll budget is unchanged.
 */
export function normalizeTripUpdates(feed: FeedMessage): {
  timestamp: number;
  updates: NormalizedTripUpdate[];
} {
  const timestamp = Number(feed.header?.timestamp ?? 0);

  const updates = (feed.entity ?? [])
    .filter(
      (entity): entity is FeedEntity & { tripUpdate: TripUpdateData } =>
        entity.tripUpdate != null,
    )
    .map((entity) => {
      const tripUpdate = entity.tripUpdate;
      const trip = tripUpdate.trip ?? {};
      const schedRel = trip.scheduleRelationship ?? 0;
      const schedRelStr = TRIP_SCHEDULE_RELATIONSHIP[schedRel] ?? "SCHEDULED";

      // For DUPLICATED trips, create a unique ID by combining trip_id + start_time
      // to prevent overwriting the original scheduled trip
      const baseTripId = trip.tripId ?? "";
      const tripId =
        schedRelStr === "DUPLICATED" && trip.startTime
          ? `${baseTripId}_${trip.startTime}`
          : baseTripId;

      const stopTimeUpdates = (tripUpdate.stopTimeUpdate ?? []).map(
        (stopTimeUpdate: StopTimeUpdate) => {
          const stopSchedRel = stopTimeUpdate.scheduleRelationship ?? 0;
          // Use departure.time per SMART's specification — they manually adjust these
          // when holds/delays occur that the prediction algorithm can't capture
          const departureTime = stopTimeUpdate.departure?.time
            ? Number(stopTimeUpdate.departure.time)
            : undefined;
          const arrivalTime = stopTimeUpdate.arrival?.time
            ? Number(stopTimeUpdate.arrival.time)
            : undefined;
          const departureDelay = stopTimeUpdate.departure?.delay ?? undefined;

          return {
            stopSequence: stopTimeUpdate.stopSequence ?? undefined,
            stopId: stopTimeUpdate.stopId ?? undefined,
            arrivalTime,
            departureTime,
            scheduleRelationship:
              STOP_SCHEDULE_RELATIONSHIP[stopSchedRel] ?? "SCHEDULED",
            departureDelay:
              departureDelay != null ? Number(departureDelay) : undefined,
          };
        },
      );

      return {
        tripId,
        routeId: trip.routeId ?? undefined,
        startDate: trip.startDate ?? undefined,
        startTime: trip.startTime ?? undefined,
        scheduleRelationship: schedRelStr,
        duplicatedTripRef: schedRelStr === "DUPLICATED" ? baseTripId : undefined,
        stopTimeUpdates,
      };
    });

  return { timestamp, updates };
}
