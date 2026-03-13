import type { ProcessedTrip } from "./scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

// ---------------------------------------------------------------------------
// Dev-only fixture data for testing TripDetailSheet states via ?devTrip=<id>
// Times are computed relative to now() so the countdown / progress are always
// meaningful no matter when you open the URL.
// ---------------------------------------------------------------------------

const STATIONS: Station[] = [
  "Windsor",
  "Sonoma County Airport",
  "Santa Rosa North",
  "Santa Rosa Downtown",
  "Rohnert Park",
  "Cotati",
  "Petaluma North",
  "Petaluma Downtown",
  "Novato San Marin",
  "Novato Downtown",
  "Novato Hamilton",
  "Marin Civic Center",
  "San Rafael",
  "Larkspur",
];

// Minutes from departure station (Santa Rosa North, index 2) to each stop.
// null = train doesn't serve that stop (before origin).
const OFFSETS_FROM_DEPARTURE: (number | null)[] = [
  null, //  0 Windsor
  null, //  1 Sonoma County Airport
  0,    //  2 Santa Rosa North      ← from
  5,    //  3 Santa Rosa Downtown
  13,   //  4 Rohnert Park
  18,   //  5 Cotati
  26,   //  6 Petaluma North
  31,   //  7 Petaluma Downtown
  41,   //  8 Novato San Marin
  46,   //  9 Novato Downtown
  51,   // 10 Novato Hamilton
  59,   // 11 Marin Civic Center
  64,   // 12 San Rafael
  71,   // 13 Larkspur               ← to
];

const FROM: Station = "Santa Rosa North";
const TO: Station = "Larkspur";
const DURATION = 71; // minutes FROM → TO

function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function addMin(base: Date, minutes: number): string {
  return toHHMM(new Date(base.getTime() + minutes * 60_000));
}

function makeTimes(departureOffsetMin: number, now: Date): string[] {
  return OFFSETS_FROM_DEPARTURE.map((stopOffset) => {
    if (stopOffset === null) return "";
    return addMin(now, departureOffsetMin + stopOffset);
  });
}

function makeLiveDepartures(
  departureOffsetMin: number,
  delayMin: number,
  now: Date
): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  OFFSETS_FROM_DEPARTURE.forEach((stopOffset, i) => {
    if (stopOffset === null) return;
    result[STATIONS[i]] = addMin(now, departureOffsetMin + stopOffset + delayMin);
  });
  return result;
}

export interface DevFixture {
  trip: ProcessedTrip;
  realtimeStatus: TripRealtimeStatus | null;
}

export const DEV_FIXTURE_IDS = [
  "on-time",
  "boarding",
  "delayed",
  "canceled",
  "mid-trip",
  "arriving",
] as const;

export type DevFixtureId = (typeof DEV_FIXTURE_IDS)[number];

export function getDevFixture(scenario: string): DevFixture | null {
  const now = new Date();

  const makeTrip = (tripNumber: number, depOffset: number): ProcessedTrip => ({
    trip: tripNumber,
    times: makeTimes(depOffset, now),
    departureTime: addMin(now, depOffset),
    arrivalTime: addMin(now, depOffset + DURATION),
    fromStation: FROM,
    toStation: TO,
    isValid: true,
  });

  switch (scenario) {
    case "on-time": {
      return {
        trip: makeTrip(101, 5), // departs in 5 min
        realtimeStatus: null,
      };
    }

    case "delayed": {
      const depOffset = -2; // scheduled 2 min ago
      const delayMin = 8;
      return {
        trip: makeTrip(103, depOffset),
        realtimeStatus: {
          isCanceled: false,
          liveDepartureTime: addMin(now, depOffset + delayMin),
          liveArrivalTime: addMin(now, depOffset + DURATION + delayMin),
          delayMinutes: delayMin,
          isOriginSkipped: false,
          isDestinationSkipped: false,
          hasRealtimeStopData: true,
          allStopLiveDepartures: makeLiveDepartures(depOffset, delayMin, now),
        },
      };
    }

    case "boarding": {
      return {
        trip: makeTrip(102, 1),
        realtimeStatus: null,
      };
    }

    case "canceled": {
      return {
        trip: makeTrip(105, 10), // departs in 10 min
        realtimeStatus: {
          isCanceled: true,
          isOriginSkipped: false,
          isDestinationSkipped: false,
        },
      };
    }

    case "mid-trip": {
      // Departed 20 min ago — currently between Cotati and Petaluma North
      return {
        trip: makeTrip(107, -20),
        realtimeStatus: {
          isCanceled: false,
          isOriginSkipped: false,
          isDestinationSkipped: false,
          hasRealtimeStopData: false,
        },
      };
    }

    case "arriving": {
      // Departed 65 min ago — ~6 min from Larkspur
      return {
        trip: makeTrip(109, -65),
        realtimeStatus: null,
      };
    }

    default:
      return null;
  }
}
