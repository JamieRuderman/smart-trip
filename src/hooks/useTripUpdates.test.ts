import { describe, expect, it } from "vitest";
import { deriveStatus } from "@/hooks/useTripUpdates";
import { GTFS_STOP_ID_TO_PLATFORM } from "@/lib/stationUtils";
import { agencyWallTimeToEpochSeconds } from "@/lib/timeUtils";
import type { GtfsRtTripUpdate } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

const DATE = "20260715";

/** Platform stop_id for a station+direction, from the generated GTFS map. */
function stopIdFor(station: Station, direction: "northbound" | "southbound"): string {
  const entry = Object.entries(GTFS_STOP_ID_TO_PLATFORM).find(
    ([, p]) => p.station === station && p.direction === direction,
  );
  if (!entry) throw new Error(`no platform for ${station} ${direction}`);
  return entry[0];
}

const wall = (hhmm: string) => agencyWallTimeToEpochSeconds(DATE, hhmm);

// Northbound Larkspur → Windsor leg; trip departed Larkspur 09:44.
const FROM: Station = "Larkspur";
const TO: Station = "Windsor";
const SCHED_TIMES: Partial<Record<string, string>> = {
  "Novato Downtown": "10:08",
  Windsor: "11:05",
};

function update(stopTimeUpdates: GtfsRtTripUpdate["stopTimeUpdates"]): GtfsRtTripUpdate {
  return {
    tripId: "t16",
    startDate: DATE,
    startTime: "09:44:15",
    scheduleRelationship: "SCHEDULED",
    stopTimeUpdates,
  };
}

describe("deriveStatus — en-route (boarding stop pruned from the feed)", () => {
  it("still surfaces per-stop delays and the live arrival, keyed by the static departure", () => {
    // 511 has pruned the served Larkspur origin; the train is running +3 min
    // at its next stop and predicted +4 min at the terminus.
    const result = deriveStatus(
      update([
        {
          stopId: stopIdFor("Novato Downtown", "northbound"),
          departureTime: wall("10:08") + 180,
          scheduleRelationship: "SCHEDULED",
        },
        {
          stopId: stopIdFor("Windsor", "northbound"),
          arrivalTime: wall("11:05") + 240,
          scheduleRelationship: "SCHEDULED",
        },
      ]),
      FROM,
      TO,
      "northbound",
      "09:44",
      "11:05",
      SCHED_TIMES,
    );
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    expect(result.scheduledDeparture).toBe("09:44");
    expect(result.status.allStopDelayMinutes?.["Novato Downtown"]).toBe(3);
    expect(result.status.arrivalDelayMinutes).toBe(4);
    expect(result.status.liveArrivalTime).toBe("11:09");
    // The origin has departed — there is no live departure to report.
    expect(result.status.liveDepartureTime).toBeUndefined();
    expect(result.status.delayMinutes).toBeUndefined();
    expect(result.status.hasRealtimeStopData).toBe(true);
  });

  it("returns none without a static-schedule match (no stable key)", () => {
    const result = deriveStatus(
      update([
        {
          stopId: stopIdFor("Novato Downtown", "northbound"),
          departureTime: wall("10:08") + 180,
          scheduleRelationship: "SCHEDULED",
        },
      ]),
      FROM,
      TO,
      "northbound",
      null,
      null,
      {},
    );
    expect(result.kind).toBe("none");
  });

  it("returns none when only opposite-direction stops remain (round-trip GTFS encoding)", () => {
    const result = deriveStatus(
      update([
        {
          stopId: stopIdFor("Novato Downtown", "southbound"),
          departureTime: wall("10:08") + 180,
          scheduleRelationship: "SCHEDULED",
        },
      ]),
      FROM,
      TO,
      "northbound",
      "09:44",
      "11:05",
      SCHED_TIMES,
    );
    expect(result.kind).toBe("none");
  });
});

describe("deriveStatus — boarding stop still present (unchanged path)", () => {
  it("reports the departure delay from the origin's live departure", () => {
    const result = deriveStatus(
      update([
        {
          stopId: stopIdFor("Larkspur", "northbound"),
          departureTime: wall("09:44") + 180,
          scheduleRelationship: "SCHEDULED",
        },
        {
          stopId: stopIdFor("Windsor", "northbound"),
          arrivalTime: wall("11:05") + 180,
          scheduleRelationship: "SCHEDULED",
        },
      ]),
      FROM,
      TO,
      "northbound",
      "09:44",
      "11:05",
      SCHED_TIMES,
    );
    expect(result.kind).toBe("primary");
    if (result.kind !== "primary") return;
    expect(result.status.delayMinutes).toBe(3);
    expect(result.status.liveDepartureTime).toBe("09:47");
    expect(result.status.liveArrivalTime).toBe("11:08");
  });
});
