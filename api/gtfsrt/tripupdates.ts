import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { applyCors } from "../_cors.js";
import { fetchGtfsRt, transit_realtime } from "../_gtfsrt.js";

const { TripDescriptor, TripUpdate } = transit_realtime;
type FeedEntity = GtfsRealtime.IFeedEntity;
type TripUpdateData = GtfsRealtime.ITripUpdate;
type StopTimeUpdate = GtfsRealtime.TripUpdate.IStopTimeUpdate;

const SCHEDULE_RELATIONSHIP: Record<number, string> = {
  [TripDescriptor.ScheduleRelationship.SCHEDULED]: "SCHEDULED",
  [TripDescriptor.ScheduleRelationship.ADDED]: "ADDED",
  [TripDescriptor.ScheduleRelationship.UNSCHEDULED]: "UNSCHEDULED",
  [TripDescriptor.ScheduleRelationship.CANCELED]: "CANCELED",
  [TripDescriptor.ScheduleRelationship.DUPLICATED]: "DUPLICATED",
};

const STOP_SCHEDULE_RELATIONSHIP: Record<number, string> = {
  [TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED]: "SCHEDULED",
  [TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED]: "SKIPPED",
  [TripUpdate.StopTimeUpdate.ScheduleRelationship.NO_DATA]: "NO_DATA",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    if (process.env.USE_SAMPLE_DATA === "true") {
      const samplePath = resolve(process.cwd(), "sample/tripupdates.json");
      const sample = JSON.parse(readFileSync(samplePath, "utf-8"));
      res.setHeader("Cache-Control", "no-store");
      return res.json(sample);
    }

    const feed = await fetchGtfsRt("tripupdates");

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
        const schedRelStr = SCHEDULE_RELATIONSHIP[schedRel] ?? "SCHEDULED";

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
            scheduleRelationship:
              STOP_SCHEDULE_RELATIONSHIP[stopSchedRel] ?? "SCHEDULED",
            departureDelay: departureDelay != null ? Number(departureDelay) : undefined,
          };
        });

        return {
          tripId,
          routeId: trip.routeId ?? undefined,
          startDate: trip.startDate ?? undefined,
          startTime: trip.startTime ?? undefined,
          scheduleRelationship: schedRelStr,
          duplicatedTripRef:
            schedRelStr === "DUPLICATED" ? baseTripId : undefined,
          stopTimeUpdates,
        };
      });

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=15");
    res.json({ timestamp, updates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
