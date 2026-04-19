import stations from "@/data/stations";
import {
  bundledSchedulePayload,
  type SchedulePayload,
} from "@/data/scheduleData";
import type { ScheduleType } from "@/data/trainSchedules";
import { stationIndexMap, calculateZonesBetweenStations } from "./stationUtils";
import { parseTimeToMinutes, isTimeInPast } from "./timeUtils";
import { FARE_CONSTANTS, FERRY_CONSTANTS, FARE_TYPES } from "./fareConstants";
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
  times: string[];
  outboundFerry?: FerryConnection;
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

interface ScheduleCache {
  [key: string]: ProcessedTrip[]; // key: "fromStation-toStation-scheduleType"
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
  const cache: ScheduleCache = {};
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
                  if (!cache[key]) cache[key] = [];

                  const larkspurTime = getTimeForStation(
                    trip.times,
                    FERRY_CONSTANTS.FERRY_STATION
                  );
                  const hasLarkspurTime = !larkspurTime.includes("~~");

                  cache[key].push({
                    trip: trip.trip,
                    times: trip.times,
                    outboundFerry:
                      toStation === FERRY_CONSTANTS.FERRY_STATION &&
                      hasLarkspurTime
                        ? findOutboundFerry(larkspurTime, outboundFerries)
                        : undefined,
                    inboundFerry:
                      fromStation === FERRY_CONSTANTS.FERRY_STATION &&
                      hasLarkspurTime
                        ? findInboundFerry(larkspurTime, inboundFerries)
                        : undefined,
                    departureTime,
                    arrivalTime,
                    fromStation,
                    toStation,
                    isValid: true,
                  });
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
  scheduleCache = {};
}

export function setScheduleData(payload: SchedulePayload): void {
  try {
    scheduleCache = processScheduleData(payload);
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
 * @returns Array of processed trips for the route
 */
export function getFilteredTrips(
  fromStation: Station,
  toStation: Station,
  scheduleType: ScheduleType
): ProcessedTrip[] {
  const key = `${fromStation}-${toStation}-${scheduleType}`;
  return scheduleCache[key] || [];
}

/**
 * Look up a full-corridor trip by its GTFS-RT origin startTime and GTFS
 * directionId (0 = southbound, 1 = northbound). Searches both weekday and
 * weekend schedules so callers don't need to know which service day the
 * vehicle is running. Returns the matched ProcessedTrip or null.
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
  const candidates = [
    ...getFilteredTrips(from, to, "weekday"),
    ...getFilteredTrips(from, to, "weekend"),
  ];
  // When a trip number is provided, disambiguate between reused numbers
  // (e.g. trip 6 runs multiple times a day) by matching startTime as well.
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

// Fast next trip calculation
/**
 * Finds the index of the next trip that hasn't departed yet
 * @param trips - Array of processed trips
 * @param currentTime - Current date/time
 * @returns Index of next trip, or -1 if no future trips
 */
export function getNextTripIndex(
  trips: ProcessedTrip[],
  currentTime: Date
): number {
  for (let i = 0; i < trips.length; i++) {
    const departureTime = trips[i].departureTime;
    if (!isTimeInPast(currentTime, departureTime)) {
      return i;
    }
  }
  return -1;
}

/**
 * Finds the index of the first trip that is still in progress
 * (departure is in the past but arrival is not yet past).
 * Returns -1 if no in-progress trips exist.
 */
export function getFirstInProgressTripIndex(
  trips: ProcessedTrip[],
  currentTime: Date
): number {
  for (let i = 0; i < trips.length; i++) {
    if (
      isTimeInPast(currentTime, trips[i].departureTime) &&
      !isTimeInPast(currentTime, trips[i].arrivalTime)
    ) {
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
 * @param paymentMethod - Payment method (defaults to "clipper")
 * @returns Complete fare information including price and description
 */
export function calculateFare(
  fromStation: Station,
  toStation: Station,
  fareType: FareType,
  paymentMethod: PaymentMethod = "clipper"
): FareInfo {
  const zones = calculateZonesBetweenStations(fromStation, toStation);
  const fareConfig = FARE_TYPES[fareType];

  const price = fareConfig.isFree
    ? 0
    : zones * FARE_CONSTANTS.ADULT_FARE_PER_ZONE * fareConfig.multiplier;

  return {
    fareType,
    paymentMethod,
    zones,
    price,
    description: fareConfig.description,
  };
}

/**
 * Gets all available fare options for a route
 * @param fromStation - Origin station
 * @param toStation - Destination station
 * @returns Array of all fare options with pricing information
 */
export function getAllFareOptions(
  fromStation: Station,
  toStation: Station
): FareInfo[] {
  const fareTypes: FareType[] = [
    "adult",
    "youth",
    "senior",
    "disabled",
    "clipper-start",
  ];
  return fareTypes.map((fareType) =>
    calculateFare(fromStation, toStation, fareType)
  );
}
