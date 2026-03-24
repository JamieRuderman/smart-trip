import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { createGtfsRtHandler } from "../_handler.js";
import { TRIP_SCHEDULE_RELATIONSHIP, STOP_SCHEDULE_RELATIONSHIP } from "../_gtfsrt.js";

type FeedEntity = GtfsRealtime.IFeedEntity;
type TripUpdateData = GtfsRealtime.ITripUpdate;
type StopTimeUpdate = GtfsRealtime.TripUpdate.IStopTimeUpdate;

export default createGtfsRtHandler({
  feed: "tripupdates",
  sampleFile: "sample/tripupdates.json",
  cacheControl: "s-maxage=30, stale-while-revalidate=15",
  transform(feed) {
    const timestamp = Number(feed.header?.timestamp ?? 0);

    const updates = (feed.entity ?? [])
      .filter(
        (entity): entity is FeedEntity & { tripUpdate: TripUpdateData } =>
          entity.tripUpdate != null
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

        const stopTimeUpdates = (tripUpdate.stopTimeUpdate ?? []).map((stopTimeUpdate: StopTimeUpdate) => {
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
            scheduleRelationship: STOP_SCHEDULE_RELATIONSHIP[stopSchedRel] ?? "SCHEDULED",
            departureDelay: departureDelay != null ? Number(departureDelay) : undefined,
          };
        });

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
  },
});
