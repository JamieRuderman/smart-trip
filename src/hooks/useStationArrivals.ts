import { useMemo } from "react";
import stations from "@/data/stations";
import {
  getFilteredTrips,
  getTodayScheduleType,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { getTripDirection, stationIndexMap } from "@/lib/stationUtils";
import { DELAY_MINUTES_THRESHOLD } from "@/lib/realtimeConstants";
import { placeStation, type Place } from "@/lib/places";
import type { Station } from "@/types/smartSchedule";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];

export interface Arrival {
  tripNumber: number;
  terminus: Station;
  isSouthbound: boolean;
  etaMinutes: number;
  /** Effective arrival time at this station, "HH:MM" — includes live updates
   *  when present so the displayed clock time reflects real-world delay. */
  effectiveTime: string;
  /** Scheduled arrival time at this station — used to show a struck-through
   *  comparison when the live time differs (delayed). */
  scheduledTime: string;
  /** The user's destination if they've picked one in the matching direction;
   *  otherwise the train's end-of-line terminus. */
  destinationStation: Station;
  /** Effective arrival time at {@link destinationStation}, or null when the
   *  station IS the destination (so we don't render a redundant time). */
  destinationTime: string | null;
  delayMinutes: number | null;
  isCanceled: boolean;
  /** The train passes this station without stopping. */
  skipsStation: boolean;
  /** The train passes {@link destinationStation} without stopping. */
  skipsDestination: boolean;
  /** Underlying schedule trip, for opening the train's page. */
  trip: ProcessedTrip;
}

/**
 * Every train still to arrive at `station` today, soonest first. With both
 * trip ends picked, only trains heading the rider's way — trains going the
 * other way aren't actionable from the station.
 */
export function useStationArrivals(
  station: Station,
  currentTime: Date,
  fromStation: Place | null,
  toStation: Place | null,
): Arrival[] {
  const scheduleType = getTodayScheduleType(currentTime);
  const southboundTrips = useMemo(
    () => getFilteredTrips(WINDSOR, LARKSPUR, scheduleType),
    [scheduleType],
  );
  const northboundTrips = useMemo(
    () => getFilteredTrips(LARKSPUR, WINDSOR, scheduleType),
    [scheduleType],
  );
  const sbStatus = useTripRealtimeStatusMap(WINDSOR, LARKSPUR, southboundTrips);
  const nbStatus = useTripRealtimeStatusMap(LARKSPUR, WINDSOR, northboundTrips);

  const directionFilter =
    fromStation && toStation
      ? getTripDirection(placeStation(fromStation), placeStation(toStation))
      : null;

  return useMemo<Arrival[]>(() => {
    const stationIdx = stationIndexMap[station];
    if (stationIdx == null) return [];
    const nowMinutes = minutesOfDay(currentTime);

    const collect = (
      trips: ProcessedTrip[],
      isSouthbound: boolean,
      statusMaps: typeof sbStatus,
    ): Arrival[] =>
      trips
        .map((trip) => {
          const staticTime = trip.times[stationIdx];
          if (!staticTime || staticTime === "~~") return null;

          const rt = statusMaps.statusMap.get(trip.departureTime) ?? null;
          const terminus = isSouthbound ? LARKSPUR : WINDSOR;

          // allStopLiveDepartures/allStopDelayMinutes are built from each
          // stop's live DEPARTURE — the feed usually has no departure for
          // the trip's own terminus, only an arrival. So when this row's
          // station IS the trip's terminus, use the trip-level live arrival /
          // arrival delay instead of the per-stop map, which would miss it.
          const isTerminalRow = station === terminus;
          const live = isTerminalRow
            ? (rt?.liveArrivalTime ?? rt?.allStopLiveDepartures?.[station])
            : rt?.allStopLiveDepartures?.[station];
          const effectiveTime = live ?? staticTime;
          const etaMinutes = parseTimeToMinutes(effectiveTime) - nowMinutes;

          // Delay at THIS station: a train on time at its origin can be late
          // by the time it reaches this stop, and one delayed at its origin
          // can have recovered. A per-stop live time is authoritative; the
          // trip-level origin delay is only the fallback without per-stop data.
          const delayMinutes = isTerminalRow
            ? (rt?.arrivalDelayMinutes ??
                rt?.allStopDelayMinutes?.[station] ??
                (live != null ? null : (rt?.delayMinutes ?? null)))
            : (rt?.allStopDelayMinutes?.[station] ??
                (live != null ? null : (rt?.delayMinutes ?? null)));

          const destinationStation: Station =
            directionFilter && toStation && (directionFilter === "southbound") === isSouthbound
              ? placeStation(toStation)
              : terminus;
          let destinationTime: string | null = null;
          if (destinationStation !== station) {
            const destIdx = stationIndexMap[destinationStation];
            const destStatic = destIdx != null ? trip.times[destIdx] : null;
            if (destStatic && destStatic !== "~~") {
              const destLive =
                destinationStation === terminus
                  ? (rt?.liveArrivalTime ?? rt?.allStopLiveDepartures?.[destinationStation])
                  : rt?.allStopLiveDepartures?.[destinationStation];
              destinationTime = destLive ?? destStatic;
            }
          }

          return {
            tripNumber: trip.trip,
            terminus,
            isSouthbound,
            etaMinutes,
            effectiveTime,
            scheduledTime: staticTime,
            destinationStation,
            destinationTime,
            delayMinutes:
              delayMinutes != null && delayMinutes >= DELAY_MINUTES_THRESHOLD
                ? delayMinutes
                : null,
            isCanceled: rt?.isCanceled === true,
            skipsStation: rt?.skippedStations?.includes(station) ?? false,
            skipsDestination: rt?.skippedStations?.includes(destinationStation) ?? false,
            trip,
          } satisfies Arrival;
        })
        .filter((a): a is Arrival => a != null);

    return [
      ...collect(southboundTrips, true, sbStatus),
      ...collect(northboundTrips, false, nbStatus),
    ]
      .filter(
        (a) =>
          a.etaMinutes >= 0 &&
          (directionFilter == null ||
            (directionFilter === "southbound") === a.isSouthbound),
      )
      .sort((a, b) => a.etaMinutes - b.etaMinutes);
  }, [
    station,
    currentTime,
    southboundTrips,
    northboundTrips,
    sbStatus,
    nbStatus,
    directionFilter,
    toStation,
  ]);
}
