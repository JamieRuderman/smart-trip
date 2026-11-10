import stations from "@/data/stations";
import {
  bundledSchedulePayload,
  type FerrySchedules,
  type ScheduleOverrides,
  type SchedulePayload,
} from "@/data/scheduleData";
import bundledScheduleOverrides from "@/data/scheduleOverrides";
import type { ScheduleType } from "@/data/trainSchedules";
import { stationIndexMap, calculateZonesBetweenStations } from "./stationUtils";
import {
  calculateTimeDifference,
  parseTimeToMinutes,
  isTimeInPast,
  toLocalDateKey,
} from "./timeUtils";
import { FARE_CONSTANTS, FERRY_CONSTANTS, FARE_TYPES, FERRY_FARES } from "./fareConstants";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type {
  Station,
  TrainTrip,
  TrainSchedule,
  FerryConnection,
  FareType,
  FareInfo,
  PaymentMethod,
} from "@/types/smartSchedule";

// Pre-processed data structures
export interface ProcessedTrip {
  trip: number;
  tripId?: string;
  times: string[];
  /** The ferry on to SF after the train — only on a leg the rider continues to SF. */
  outboundFerry?: FerryConnection;
  /** The ferry from SF before the train — only on a leg the rider starts in SF. */
  inboundFerry?: FerryConnection;
  departureTime: string;
  arrivalTime: string;
  fromStation: Station;
  toStation: Station;
  isValid: boolean; // Pre-calculated validity
}

interface StationPair {
  fromIndex: number;
  toIndex: number;
  direction: "southbound" | "northbound";
  isSouthbound: boolean;
}

/** Keyed by "fromStation-toStation-scheduleType". */
interface ScheduleCache {
  trips: Record<string, ProcessedTrip[]>;
  /** Larkspur legs continued by ferry to or from SF: only the trains with a
   *  connection, each carrying its ferry. */
  ferryTrips: Record<string, ProcessedTrip[]>;
}

// Note: stationIndexMap is now imported from stationUtils

// Pre-calculate all possible station pairs (used for pre-processing)
const stationPairs: Record<string, StationPair> = {};
stations.forEach((fromStation, fromIndex) => {
  stations.forEach((toStation, toIndex) => {
    if (fromIndex !== toIndex) {
      const key = `${fromStation}-${toStation}`;
      const isSouthbound = fromIndex < toIndex;
      stationPairs[key] = {
        fromIndex,
        toIndex,
        direction: isSouthbound ? "southbound" : "northbound",
        isSouthbound,
      };
    }
  });
});

// Pre-process schedule data
function processScheduleData(payload: SchedulePayload): ScheduleCache {
  const cache: ScheduleCache = { trips: {}, ferryTrips: {} };
  const { trainSchedules, ferrySchedules } = payload;

  // Validate that train schedules data is loaded
  if (!trainSchedules || !trainSchedules.weekday || !trainSchedules.weekend) {
    console.error(
      "[ScheduleUtils] trainSchedules data is not loaded correctly:",
      trainSchedules
    );
    return cache;
  }

  /**
   * Finds the next available outbound ferry after a train arrival
   */
  const findOutboundFerry = (
    arrivalTime: string,
    ferries: FerryConnection[]
  ): FerryConnection | undefined => {
    const arrivalMinutes = parseTimeToMinutes(arrivalTime);
    return ferries.find(
      (ferry) => parseTimeToMinutes(ferry.depart) >= arrivalMinutes
    );
  };

  /**
   * Finds the best inbound ferry that arrives before train departure with minimal transfer time
   */
  const findInboundFerry = (
    trainDepartureTime: string,
    ferries: FerryConnection[]
  ): FerryConnection | undefined => {
    if (!ferries.length) return undefined;
    const depMinutes = parseTimeToMinutes(trainDepartureTime);

    // Filter ferries that arrive before train departs
    const validFerries = ferries.filter(
      (ferry) => parseTimeToMinutes(ferry.arrive) < depMinutes
    );

    // If no ferries arrive before train departure, return undefined
    if (validFerries.length === 0) return undefined;

    // Find the one with shortest transfer time
    return validFerries.reduce((best, ferry) => {
      const transferTime = depMinutes - parseTimeToMinutes(ferry.arrive);
      const bestTransferTime = depMinutes - parseTimeToMinutes(best.arrive);
      return transferTime < bestTransferTime ? ferry : best;
    });
  };

  const getTimeForStation = (times: string[], station: Station): string => {
    const stationIndex = stationIndexMap[station];
    if (stationIndex === undefined) return "~~";

    // Schedules list times using the canonical north-to-south station order
    // regardless of travel direction, so we can index directly for both
    // northbound and southbound trips.
    return times[stationIndex] ?? "~~";
  };

  /**
   * Processes schedule data for a given schedule type and adds to cache
   */
  const processScheduleType = (
    scheduleData: TrainSchedule,
    scheduleType: ScheduleType,
    outboundFerries: FerryConnection[],
    inboundFerries: FerryConnection[]
  ) => {
    (
      Object.entries(scheduleData) as [keyof TrainSchedule, TrainTrip[]][]
    ).forEach(([direction, trips]) => {
      trips.forEach((trip) => {
        // Pre-calculate validity for all possible station combinations
        stations.forEach((fromStation, fromIndex) => {
          stations.forEach((toStation, toIndex) => {
            if (fromIndex !== toIndex) {
              // Get the correct direction for this station pair
              const pairKey = `${fromStation}-${toStation}`;
              const stationPair = stationPairs[pairKey];

              // Only include trips that match the correct direction for this station pair
              if (stationPair && stationPair.direction === direction) {
                const departureTime = getTimeForStation(
                  trip.times,
                  fromStation
                );
                const arrivalTime = getTimeForStation(trip.times, toStation);
                const isValid =
                  !departureTime.includes("~~") && !arrivalTime.includes("~~");

                if (isValid) {
                  const key = `${fromStation}-${toStation}-${scheduleType}`;
                  const processed: ProcessedTrip = {
                    trip: trip.trip,
                    tripId: trip.tripId,
                    times: trip.times,
                    departureTime,
                    arrivalTime,
                    fromStation,
                    toStation,
                    isValid: true,
                  };
                  if (!cache.trips[key]) cache.trips[key] = [];
                  cache.trips[key].push(processed);

                  let withFerry: ProcessedTrip | null = null;
                  if (toStation === FERRY_CONSTANTS.FERRY_STATION) {
                    const ferry = findOutboundFerry(arrivalTime, outboundFerries);
                    if (ferry) withFerry = { ...processed, outboundFerry: ferry };
                  } else if (fromStation === FERRY_CONSTANTS.FERRY_STATION) {
                    const ferry = findInboundFerry(departureTime, inboundFerries);
                    if (ferry) withFerry = { ...processed, inboundFerry: ferry };
                  }
                  if (withFerry) {
                    if (!cache.ferryTrips[key]) cache.ferryTrips[key] = [];
                    cache.ferryTrips[key].push(withFerry);
                  }
                }
              }
            }
          });
        });
      });
    });
  };

  // Process both schedule types
  processScheduleType(
    trainSchedules.weekday,
    "weekday",
    ferrySchedules.weekdayFerries,
    ferrySchedules.weekdayInboundFerries
  );
  processScheduleType(
    trainSchedules.weekend,
    "weekend",
    ferrySchedules.weekendFerries,
    ferrySchedules.weekendInboundFerries
  );

  return cache;
}

// Pre-processed schedule cache
let scheduleCache: ScheduleCache;
try {
  scheduleCache = processScheduleData(bundledSchedulePayload);
} catch (error) {
  console.error("[ScheduleUtils] Error processing schedule data:", error);
  scheduleCache = { trips: {}, ferryTrips: {} };
}

/**
 * Where the currently-applied schedule came from. Lives next to the cache
 * so cache + version + source can only transition atomically inside
 * `setScheduleData`. React consumers read via `useSyncExternalStore`
 * against `subscribeSchedule` / `getScheduleMeta` to avoid the cache/version
 * tear that occurred when these lived in separate React state.
 */
export type ScheduleSource = "remote" | "cached" | "bundled";

export interface ScheduleMeta {
  /** Monotonic counter incremented each time `setScheduleData` rebuilds the
   *  cache. Downstream caches (e.g. trainMotion's per-trip memo) watch this
   *  to invalidate without a circular import. */
  version: number;
  source: ScheduleSource;
  generatedAt: Date | null;
}

function parseGeneratedAt(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

let scheduleMeta: ScheduleMeta = {
  version: 0,
  source: "bundled",
  generatedAt: parseGeneratedAt(bundledSchedulePayload.generatedAt),
};

const scheduleSubscribers = new Set<() => void>();

export function subscribeSchedule(listener: () => void): () => void {
  scheduleSubscribers.add(listener);
  return () => scheduleSubscribers.delete(listener);
}

export function getScheduleMeta(): ScheduleMeta {
  return scheduleMeta;
}

export function getScheduleVersion(): number {
  return scheduleMeta.version;
}

/** The rest of today's ferries from Larkspur to SF, or from SF to Larkspur
 *  when `inbound`, in departure order. */
export function upcomingFerries(now: Date, inbound = false): FerryConnection[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return ferryRuns(getTodayScheduleType(now), inbound).filter(
    (f) => parseTimeToMinutes(f.depart) >= nowMinutes,
  );
}

/** The next ferry from Larkspur — or from SF when `inbound` — or null once
 *  the day's last has left. */
export function getNextFerryDeparture(
  now: Date,
  inbound = false,
): FerryConnection | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return (
    ferryRuns(getTodayScheduleType(now), inbound).find(
      (f) => parseTimeToMinutes(f.depart) >= nowMinutes,
    ) ?? null
  );
}

/** Ferry timetables from the currently-applied payload. */
let activeFerrySchedules: FerrySchedules = bundledSchedulePayload.ferrySchedules;

/** The day's Larkspur → SF runs, or SF → Larkspur when `inbound`, in
 *  departure order. */
export function ferryRuns(
  scheduleType: ScheduleType,
  inbound: boolean,
): FerryConnection[] {
  const key: keyof FerrySchedules = inbound
    ? `${scheduleType}InboundFerries`
    : `${scheduleType}Ferries`;
  return activeFerrySchedules[key];
}

/**
 * The run beside `ferry` on the Larkspur ↔ SF timetable: the next departure
 * after it for an outbound (Larkspur → SF) run — the fallback if the train runs
 * late — or the one before it for an inbound run, which allows a longer
 * transfer. Null when `ferry` is the day's last outbound or first inbound run.
 */
export function adjacentFerry(
  ferry: FerryConnection,
  inbound: boolean,
  scheduleType: ScheduleType,
): FerryConnection | null {
  const runs = ferryRuns(scheduleType, inbound);
  const departMinutes = parseTimeToMinutes(ferry.depart);
  if (!inbound) {
    return (
      runs.find((f) => parseTimeToMinutes(f.depart) > departMinutes) ?? null
    );
  }
  const earlier = runs.filter(
    (f) => parseTimeToMinutes(f.depart) < departMinutes,
  );
  return earlier[earlier.length - 1] ?? null;
}

/**
 * The train an SF → Larkspur `ferry` is timed for: the first on to Windsor
 * that takes it as its connection. Null when no train does.
 */
export function inboundFerryTrain(
  ferry: FerryConnection,
  scheduleType: ScheduleType,
): ProcessedTrip | null {
  return (
    getFilteredTrips(
      FERRY_CONSTANTS.FERRY_STATION,
      stations[0],
      scheduleType,
      true,
    ).find((trip) => trip.inboundFerry?.depart === ferry.depart) ?? null
  );
}

/**
 * Effective schedule overrides — starts from the build-time bundled map and
 * is swapped wholesale when `setScheduleData` receives a fresh payload (so
 * the same daily refresh that updates timetables also picks up new holidays).
 */
let activeScheduleOverrides: ScheduleOverrides = { ...bundledScheduleOverrides };

const localDateKey = toLocalDateKey;

/**
 * The schedule type that should be used for `now`. Defers to GTFS-derived
 * calendar-date overrides (Memorial Day Monday → "weekend", etc.) before
 * falling back to the natural day-of-week classification.
 */
export function getTodayScheduleType(now: Date = new Date()): ScheduleType {
  const override = activeScheduleOverrides[localDateKey(now)];
  if (override) return override;
  const day = now.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

/** Today's schedule type when the shown one differs and the schedule wasn't already
 *  picked or confirmed today (`checkedOn`, "YYYY-MM-DD"); otherwise null. */
export function scheduleSwitchOffer(
  shown: ScheduleType,
  checkedOn: string,
  now: Date,
): ScheduleType | null {
  const today = getTodayScheduleType(now);
  return shown !== today && checkedOn !== localDateKey(now) ? today : null;
}

/**
 * The next calendar date ("YYYY-MM-DD"), starting from `from`, whose schedule
 * type matches `scheduleType` (honoring calendar overrides). Lets a trip browsed
 * under a non-today schedule (e.g. a weekday train viewed on a weekend) anchor
 * to the day it actually runs ("Departs Monday") instead of today.
 */
export function nextServiceDate(
  from: Date,
  scheduleType: ScheduleType,
): string {
  const d = new Date(from);
  for (let i = 0; i < 8; i++) {
    if (getTodayScheduleType(d) === scheduleType) return localDateKey(d);
    d.setDate(d.getDate() + 1);
  }
  return localDateKey(from);
}

/**
 * The date ("YYYY-MM-DD") `scheduleType` next runs when that isn't today, else
 * null — e.g. the weekend schedule browsed on a Wednesday → that Saturday.
 * Single definition of "browsing another day's schedule" for the list, the
 * trip sheet and its progress clock.
 */
export function futureServiceDate(
  now: Date,
  scheduleType: ScheduleType,
): string | null {
  return scheduleType === getTodayScheduleType(now)
    ? null
    : nextServiceDate(now, scheduleType);
}

export function setScheduleData(
  payload: SchedulePayload,
  source: ScheduleSource = "remote",
): void {
  try {
    const nextCache = processScheduleData(payload);
    // Apply atomically: only after the new cache is built (so a throw above
    // can't leave the cache and meta out of sync) do we publish.
    scheduleCache = nextCache;
    // When the payload doesn't carry overrides (e.g. a pre-feature cached
    // payload, or a remote endpoint that hasn't been redeployed), reset to
    // the build-time bundled map instead of silently keeping prior state —
    // otherwise stale overrides from an earlier payload can outlive their
    // relevance.
    activeScheduleOverrides = payload.scheduleOverrides
      ? { ...payload.scheduleOverrides }
      : { ...bundledScheduleOverrides };
    activeFerrySchedules = payload.ferrySchedules;
    scheduleMeta = {
      version: scheduleMeta.version + 1,
      source,
      generatedAt: parseGeneratedAt(payload.generatedAt),
    };
    scheduleSubscribers.forEach((listener) => listener());
  } catch (error) {
    console.error("[ScheduleUtils] Error processing schedule data:", error);
  }
}

// Fast lookup functions
// Station index function is now exported from stationUtils
export { getStationIndex } from "./stationUtils";

/**
 * Gets pre-processed trips for a specific route and schedule type
 * @param fromStation - Origin station
 * @param toStation - Destination station
 * @param scheduleType - Type of schedule (weekday or weekend)
 * @param viaFerry - The leg's Larkspur end continues by ferry to or from SF:
 *   only trains with a ferry connection, each carrying it. Otherwise no trip
 *   carries a ferry.
 * @returns Array of processed trips for the route
 */
export function getFilteredTrips(
  fromStation: Station,
  toStation: Station,
  scheduleType: ScheduleType,
  viaFerry = false
): ProcessedTrip[] {
  const key = `${fromStation}-${toStation}-${scheduleType}`;
  return (viaFerry ? scheduleCache.ferryTrips : scheduleCache.trips)[key] || [];
}

/**
 * Whether a given trip number runs on the leg fromStation→toStation under the
 * given schedule type. Used by the "Go" control to decide whether a train
 * tapped from the line map (which displays the full corridor origin→terminus)
 * can adopt the user's selected home-screen leg instead of the terminus.
 */
export function tripServesLeg(
  tripNumber: number,
  fromStation: Station,
  toStation: Station,
  scheduleType: ScheduleType,
  viaFerry = false
): boolean {
  return getFilteredTrips(fromStation, toStation, scheduleType, viaFerry).some(
    (trip) => trip.trip === tripNumber
  );
}

/**
 * Look up a full-corridor trip by its GTFS-RT origin startTime and GTFS
 * directionId (0 = southbound, 1 = northbound). Searches today's active
 * schedule (weekday or weekend) so weekday/weekend trips that share an
 * origin time can't collide. Returns the matched ProcessedTrip or null.
 */
export function findFullCorridorTrip(
  directionId: number,
  startTime: string,
  tripNumber?: number
): ProcessedTrip | null {
  const isSouthbound = directionId === 0;
  const from = isSouthbound ? stations[0] : stations[stations.length - 1];
  const to = isSouthbound ? stations[stations.length - 1] : stations[0];
  const originIndex = isSouthbound ? 0 : stations.length - 1;
  const scheduleType = getTodayScheduleType();
  const candidates = getFilteredTrips(from, to, scheduleType);
  if (tripNumber != null) {
    return (
      candidates.find(
        (t) => t.trip === tripNumber && t.times[originIndex] === startTime,
      ) ??
      candidates.find((t) => t.trip === tripNumber) ??
      null
    );
  }
  return candidates.find((t) => t.times[originIndex] === startTime) ?? null;
}

// Time comparison function is now exported from timeUtils
export { isTimeInPast } from "./timeUtils";

/**
 * A trip's departure time for has-it-left decisions: the live departure when
 * realtime data has one (the status map is keyed by the SCHEDULED departure,
 * as built by useTripRealtimeStatusMap), else the static schedule.
 */
export function effectiveDepartureTime(
  trip: Pick<ProcessedTrip, "departureTime">,
  realtimeStatusMap?: Map<string, TripRealtimeStatus>
): string {
  return (
    realtimeStatusMap?.get(trip.departureTime)?.liveDepartureTime ??
    trip.departureTime
  );
}

/** Live-aware arrival counterpart of {@link effectiveDepartureTime}. */
export function effectiveArrivalTime(
  trip: Pick<ProcessedTrip, "departureTime" | "arrivalTime">,
  realtimeStatusMap?: Map<string, TripRealtimeStatus>
): string {
  return (
    realtimeStatusMap?.get(trip.departureTime)?.liveArrivalTime ??
    trip.arrivalTime
  );
}

/**
 * A trip's two ends as the rider sees them: the SF ferry's time at an end the
 * trip starts or ends with one — it runs to its own timetable and has no live
 * feed — else the train's time there, live when `status` has it. `live*` says
 * which end shows a live time.
 */
export function tripEnds(
  trip: Pick<ProcessedTrip, "departureTime" | "arrivalTime" | "inboundFerry" | "outboundFerry">,
  status?: TripRealtimeStatus | null
): { start: string; end: string; liveStart: boolean; liveEnd: boolean } {
  const liveDeparture = trip.inboundFerry ? undefined : status?.liveDepartureTime;
  const liveArrival = trip.outboundFerry ? undefined : status?.liveArrivalTime;
  return {
    start: trip.inboundFerry?.depart ?? liveDeparture ?? trip.departureTime,
    end: trip.outboundFerry?.arrive ?? liveArrival ?? trip.arrivalTime,
    liveStart: liveDeparture != null,
    liveEnd: liveArrival != null,
  };
}

/**
 * A trip's ferry and the minutes between it and the train at Larkspur, against
 * the train's live time there when `status` has it; null on a trip with no ferry.
 */
export function ferryTransfer(
  trip: Pick<ProcessedTrip, "departureTime" | "arrivalTime" | "inboundFerry" | "outboundFerry">,
  status?: TripRealtimeStatus | null
): { ferry: FerryConnection; inbound: boolean; minutes: number } | null {
  if (trip.inboundFerry) {
    return {
      ferry: trip.inboundFerry,
      inbound: true,
      minutes: calculateTimeDifference(
        trip.inboundFerry.arrive,
        status?.liveDepartureTime ?? trip.departureTime
      ),
    };
  }
  if (trip.outboundFerry) {
    return {
      ferry: trip.outboundFerry,
      inbound: false,
      minutes: calculateTimeDifference(
        status?.liveArrivalTime ?? trip.arrivalTime,
        trip.outboundFerry.depart
      ),
    };
  }
  return null;
}

// Fast next trip calculation
/**
 * Finds the index of the first trip that hasn't departed yet, in schedule
 * order. "Departed" is judged by the live departure time when realtime data
 * is available — a delayed train past its scheduled slot but still short of
 * its live departure hasn't left and must not be sliced away as departed.
 * NOTE: with live delays, departure order is no longer monotonic; this is
 * the SLICE anchor (earliest schedule row still worth showing), not "the
 * next train to physically depart".
 * @param trips - Array of processed trips
 * @param currentTime - Current date/time
 * @param realtimeStatusMap - Optional live status keyed by trip.departureTime
 * @returns Index of next trip, or -1 if no future trips
 */
export function getNextTripIndex(
  trips: ProcessedTrip[],
  currentTime: Date,
  realtimeStatusMap?: Map<string, TripRealtimeStatus>
): number {
  for (let i = 0; i < trips.length; i++) {
    const { start } = tripEnds(trips[i], realtimeStatusMap?.get(trips[i].departureTime));
    if (!isTimeInPast(currentTime, start)) {
      return i;
    }
  }
  return -1;
}

/**
 * Finds the index of the first trip that is still in progress
 * (departure is in the past but arrival is not yet past), judged by live
 * times when available so a delayed run stays "in progress" until its live
 * arrival rather than dropping out at the scheduled one.
 * Returns -1 if no in-progress trips exist.
 */
export function getFirstInProgressTripIndex(
  trips: ProcessedTrip[],
  currentTime: Date,
  realtimeStatusMap?: Map<string, TripRealtimeStatus>
): number {
  for (let i = 0; i < trips.length; i++) {
    const { start, end } = tripEnds(trips[i], realtimeStatusMap?.get(trips[i].departureTime));
    if (isTimeInPast(currentTime, start) && !isTimeInPast(currentTime, end)) {
      return i;
    }
  }
  return -1;
}

// Station and fare utilities are now exported from stationUtils
export { getStationZone, calculateZonesBetweenStations } from "./stationUtils";

/**
 * Calculates fare information for a trip between two stations
 * @param fromStation - Origin station
 * @param toStation - Destination station  
 * @param fareType - Type of fare (adult, youth, senior, etc.)
 * @param viaFerry - The trip also rides the Larkspur ferry, whose fare is added
 * @param paymentMethod - Payment method (defaults to "clipper")
 * @returns Complete fare information including price and description
 */
export function calculateFare(
  fromStation: Station,
  toStation: Station,
  fareType: FareType,
  viaFerry = false,
  paymentMethod: PaymentMethod = "clipper"
): FareInfo {
  const zones = calculateZonesBetweenStations(fromStation, toStation);
  const fareConfig = FARE_TYPES[fareType];

  const trainPrice = fareConfig.isFree
    ? 0
    : zones * FARE_CONSTANTS.ADULT_FARE_PER_ZONE * fareConfig.multiplier;
  const ferryPrice = viaFerry ? FERRY_FARES[fareType] : null;

  return {
    fareType,
    paymentMethod,
    zones,
    price: trainPrice + (ferryPrice ?? 0),
    trainPrice,
    ferryPrice,
    description: fareConfig.description,
  };
}

/**
 * Gets all available fare options for a route
 * @param fromStation - Origin station
 * @param toStation - Destination station
 * @param viaFerry - The trip also rides the Larkspur ferry
 * @returns Array of all fare options with pricing information
 */
export function getAllFareOptions(
  fromStation: Station,
  toStation: Station,
  viaFerry = false
): FareInfo[] {
  const fareTypes: FareType[] = [
    "adult",
    "youth",
    "senior",
    "disabled",
    "clipper-start",
  ];
  return fareTypes.map((fareType) =>
    calculateFare(fromStation, toStation, fareType, viaFerry)
  );
}
