import { describe, expect, it } from "vitest";
import { deriveStatus } from "@/hooks/useTripUpdates";
import { agencyWallTimeToEpochSeconds } from "@/lib/timeUtils";
import type { GtfsRtStopTimeUpdate, GtfsRtTripUpdate } from "@/types/gtfsRt";

// Southbound platform stop IDs (see stationPlatforms.generated.ts).
const SRN_SB = "71122"; // Santa Rosa North
const COTATI_SB = "71092"; // Cotati
const PET_N_SB = "71082"; // Petaluma North

const START_DATE = "20260715";

/** Epoch seconds for a Pacific wall time on the test service date. */
const at = (hhmm: string, plusSeconds = 0) =>
  agencyWallTimeToEpochSeconds(START_DATE, hhmm) + plusSeconds;

// Trip 39's leg from the static timetable: Santa Rosa North 17:17 → Petaluma
// North 17:42, with Cotati at 17:31 in between.
const SCHEDULED_DEPARTURE = "17:17";
const SCHEDULED_ARRIVAL = "17:42";
const SCHEDULED_TIMES = {
  "Santa Rosa North": "17:17",
  Cotati: "17:31",
  "Petaluma North": "17:42",
};

const makeUpdate = (stopTimeUpdates: GtfsRtStopTimeUpdate[]): GtfsRtTripUpdate => ({
  tripId: "t_test",
  routeId: "SMART",
  startDate: START_DATE,
  startTime: "16:34:15",
  scheduleRelationship: "SCHEDULED",
  stopTimeUpdates,
});

const derive = (update: GtfsRtTripUpdate) =>
  deriveStatus(
    update,
    "Santa Rosa North",
    "Petaluma North",
    "southbound",
    SCHEDULED_DEPARTURE,
    SCHEDULED_ARRIVAL,
    SCHEDULED_TIMES,
  );

describe("deriveStatus — origin still in the feed (pre-departure)", () => {
  it("computes delay from the origin departure prediction", () => {
    const result = derive(
      makeUpdate([
        {
          stopId: SRN_SB,
          stopSequence: 4,
          departureTime: at("17:26"),
          scheduleRelationship: "SCHEDULED",
          departureDelay: 0, // 511 always sends 0 — must be ignored
        },
        {
          stopId: PET_N_SB,
          stopSequence: 7,
          arrivalTime: at("17:51"),
          departureTime: at("17:51"),
          scheduleRelationship: "SCHEDULED",
          departureDelay: 0,
        },
      ]),
    );
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    expect(result.scheduledDeparture).toBe(SCHEDULED_DEPARTURE);
    expect(result.status.delayMinutes).toBe(9);
    expect(result.status.liveDepartureTime).toBe("17:26");
    expect(result.status.liveArrivalTime).toBe("17:51");
  });
});

describe("deriveStatus — en-route fallback (origin dropped from the feed)", () => {
  // The screenshot scenario: the train has departed Santa Rosa North, so the
  // feed only carries the remaining stops. It's running ~9 min late and has
  // just left Cotati.
  const enRouteStops: GtfsRtStopTimeUpdate[] = [
    {
      stopId: PET_N_SB,
      stopSequence: 7,
      arrivalTime: at("17:51"),
      departureTime: at("17:51", 30),
      scheduleRelationship: "SCHEDULED",
      departureDelay: 0,
    },
  ];

  it("derives a delayed status from the destination arrival prediction", () => {
    const result = derive(makeUpdate(enRouteStops));
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    // Keyed by the STATIC departure so statusMap.get(trip.departureTime) hits.
    expect(result.scheduledDeparture).toBe(SCHEDULED_DEPARTURE);
    expect(result.status.delayMinutes).toBe(9);
    expect(result.status.arrivalDelayMinutes).toBe(9);
    expect(result.status.liveArrivalTime).toBe("17:51");
    expect(result.status.liveDepartureTime).toBeUndefined();
    expect(result.status.isCanceled).toBe(false);
  });

  it("reads on-time (status present, no delay) when the arrival tracks schedule", () => {
    const result = derive(
      makeUpdate([
        {
          stopId: PET_N_SB,
          stopSequence: 7,
          arrivalTime: at(SCHEDULED_ARRIVAL, 20), // sub-minute jitter
          scheduleRelationship: "SCHEDULED",
        },
      ]),
    );
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    expect(result.status.delayMinutes).toBeUndefined();
    expect(result.status.liveArrivalTime).toBeUndefined();
  });

  it("uses arrivalTime even when the destination is a terminal (no departureTime)", () => {
    const result = derive(
      makeUpdate([
        {
          stopId: PET_N_SB,
          stopSequence: 7,
          arrivalTime: at("17:47"),
          scheduleRelationship: "SCHEDULED",
        },
      ]),
    );
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    expect(result.status.delayMinutes).toBe(5);
    expect(result.status.liveArrivalTime).toBe("17:47");
  });

  it("still surfaces per-stop live departures for the remaining stops", () => {
    const result = derive(
      makeUpdate([
        {
          stopId: COTATI_SB,
          stopSequence: 6,
          arrivalTime: at("17:39"),
          departureTime: at("17:40"),
          scheduleRelationship: "SCHEDULED",
        },
        ...enRouteStops,
      ]),
    );
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    expect(result.status.allStopLiveDepartures?.["Cotati"]).toBe("17:40");
    expect(result.status.allStopDelayMinutes?.["Cotati"]).toBe(9);
    expect(result.status.hasRealtimeStopData).toBe(true);
  });

  it("returns none once the destination has also been served (trip over for this leg)", () => {
    const result = derive(
      makeUpdate([
        {
          // Only a stop past the rider's destination remains.
          stopId: "71072", // Petaluma Downtown southbound
          stopSequence: 8,
          arrivalTime: at("17:56"),
          departureTime: at("17:56"),
          scheduleRelationship: "SCHEDULED",
        },
      ]),
    );
    expect(result.kind).toBe("none");
  });

  it("returns none without a static-trip match (no usable map key)", () => {
    const result = deriveStatus(
      makeUpdate(enRouteStops),
      "Santa Rosa North",
      "Petaluma North",
      "southbound",
      null,
      null,
      {},
    );
    expect(result.kind).toBe("none");
  });

  it("ignores the opposite direction's platform at the destination", () => {
    const result = derive(
      makeUpdate([
        {
          stopId: "71081", // Petaluma North NORTHBOUND platform
          stopSequence: 7,
          arrivalTime: at("17:51"),
          scheduleRelationship: "SCHEDULED",
        },
      ]),
    );
    expect(result.kind).toBe("none");
  });
});
