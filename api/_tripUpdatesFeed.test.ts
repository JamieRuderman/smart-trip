import { describe, it, expect } from "vitest";
import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { transit_realtime } from "./_gtfsrt.js";
import { normalizeTripUpdates } from "./_tripUpdatesFeed.js";

const TripSR = transit_realtime.TripDescriptor.ScheduleRelationship;

/** Build a minimal decoded GTFS-RT feed for the normalizer. */
function feed(
  entities: GtfsRealtime.IFeedEntity[],
  timestamp = 1_700_000_000,
): GtfsRealtime.IFeedMessage {
  return {
    header: { gtfsRealtimeVersion: "2.0", timestamp },
    entity: entities,
  } as GtfsRealtime.IFeedMessage;
}

describe("normalizeTripUpdates", () => {
  it("normalizes a scheduled trip with arrival/departure stop times", () => {
    const out = normalizeTripUpdates(
      feed([
        {
          id: "1",
          tripUpdate: {
            trip: {
              tripId: "t_1",
              startTime: "08:10:00",
              startDate: "20260609",
              scheduleRelationship: TripSR.SCHEDULED,
            },
            stopTimeUpdate: [
              {
                stopSequence: 4,
                stopId: "71011",
                arrival: { time: 1_700_000_100 },
                departure: { time: 1_700_000_160, delay: 0 },
              },
            ],
          },
        },
      ]),
    );

    expect(out.timestamp).toBe(1_700_000_000);
    expect(out.updates).toHaveLength(1);
    expect(out.updates[0]).toMatchObject({
      tripId: "t_1",
      startTime: "08:10:00",
      startDate: "20260609",
      scheduleRelationship: "SCHEDULED",
    });
    expect(out.updates[0].stopTimeUpdates[0]).toMatchObject({
      stopId: "71011",
      arrivalTime: 1_700_000_100,
      departureTime: 1_700_000_160,
      scheduleRelationship: "SCHEDULED",
    });
  });

  it("maps a CANCELED trip relationship", () => {
    const out = normalizeTripUpdates(
      feed([
        {
          id: "2",
          tripUpdate: {
            trip: { tripId: "t_2", scheduleRelationship: TripSR.CANCELED },
            stopTimeUpdate: [],
          },
        },
      ]),
    );
    expect(out.updates[0].scheduleRelationship).toBe("CANCELED");
  });

  it("suffixes a DUPLICATED trip id with its start time and keeps the base ref", () => {
    // DUPLICATED runs reuse the base trip_id, so the endpoint disambiguates them
    // by appending the start time — that suffix is also why a DUPLICATED feed id
    // won't trip-id-match a bundled registration and correctly falls back to the
    // origin-time match instead.
    const out = normalizeTripUpdates(
      feed([
        {
          id: "3",
          tripUpdate: {
            trip: {
              tripId: "t_3",
              startTime: "09:15:00",
              scheduleRelationship: TripSR.DUPLICATED,
            },
            stopTimeUpdate: [],
          },
        },
      ]),
    );
    expect(out.updates[0].tripId).toBe("t_3_09:15:00");
    expect(out.updates[0].duplicatedTripRef).toBe("t_3");
  });

  it("ignores entities without a trip update and defaults a missing timestamp", () => {
    const out = normalizeTripUpdates(feed([{ id: "v", vehicle: {} }], 0));
    expect(out.timestamp).toBe(0);
    expect(out.updates).toHaveLength(0);
  });
});
