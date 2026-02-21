import type { VercelRequest, VercelResponse } from "@vercel/node";
import { transit_realtime } from "gtfs-realtime-bindings";
import { fetchGtfsRt } from "../_gtfsrt";

const { TripDescriptor, TripUpdate } = transit_realtime;

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
  try {
    const feed = await fetchGtfsRt("tripupdates");

    const timestamp = Number(feed.header?.timestamp ?? 0);

    const updates = (feed.entity ?? [])
      .filter((e) => e.tripUpdate)
      .map((e) => {
        const tu = e.tripUpdate!;
        const trip = tu.trip ?? {};
        const schedRel = trip.scheduleRelationship ?? 0;
        const schedRelStr = SCHEDULE_RELATIONSHIP[schedRel] ?? "SCHEDULED";

        // For DUPLICATED trips, create a unique ID by combining trip_id + start_time
        // to prevent overwriting the original scheduled trip
        const baseTripId = trip.tripId ?? "";
        const tripId =
          schedRelStr === "DUPLICATED" && trip.startTime
            ? `${baseTripId}_${trip.startTime}`
            : baseTripId;

        const stopTimeUpdates = (tu.stopTimeUpdate ?? []).map((stu) => {
          const stopSchedRel = stu.scheduleRelationship ?? 0;
          // Use departure.time per SMART's specification — they manually adjust these
          // when holds/delays occur that the prediction algorithm can't capture
          const departureTime = stu.departure?.time
            ? Number(stu.departure.time)
            : undefined;
          const arrivalTime = stu.arrival?.time
            ? Number(stu.arrival.time)
            : undefined;
          const departureDelay = stu.departure?.delay ?? undefined;

          return {
            stopSequence: stu.stopSequence ?? undefined,
            stopId: stu.stopId ?? undefined,
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
