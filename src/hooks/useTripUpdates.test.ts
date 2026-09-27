import { describe, expect, it } from "vitest";
import { deriveStatus, matchUpdatesToTrips } from "@/hooks/useTripUpdates";
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

describe("matchUpdatesToTrips", () => {
  const trip = (tripId: string | undefined, origin: string) => ({
    tripId,
    times: ["07:00", "07:10", origin],
  });
  const feed = (tripId: string, startTime: string): GtfsRtTripUpdate => ({
    tripId,
    startDate: DATE,
    startTime,
    scheduleRelationship: "SCHEDULED",
    stopTimeUpdates: [],
  });

  it("leaves an opposite-direction run sharing the origin minute unpaired", () => {
    const opposite = { ...feed("t_sb", "09:44:15"), directionId: 0 };
    expect(matchUpdatesToTrips([opposite], [trip("t16", "09:44")], false).size).toBe(0);
  });

  it("leaves another service day's run unpaired when the day is known", () => {
    const tomorrow = { ...feed("t16", "09:44:15"), startDate: "20260716" };
    expect(matchUpdatesToTrips([tomorrow], [trip("t16", "09:44")], false, DATE).size).toBe(0);
    expect(matchUpdatesToTrips([tomorrow], [trip("t16", "09:44")], false).size).toBe(1);
  });

  it("leaves a same-minute run from another trip unpaired when the trip's own update is present", () => {
    const opposite = feed("t_sb", "09:44:15");
    const own = feed("t16", "09:44:15");
    const paired = matchUpdatesToTrips([opposite, own], [trip("t16", "09:44")], false);
    expect(paired.has(opposite)).toBe(false);
    expect(paired.has(own)).toBe(true);
  });
});
