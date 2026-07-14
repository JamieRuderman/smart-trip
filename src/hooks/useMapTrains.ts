import { useMemo } from "react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { computeDelayMinutes, useTripUpdates } from "@/hooks/useTripUpdates";
import { useScheduleData } from "@/hooks/useScheduleData";
import { isUpstreamFeedDown } from "@/lib/gtfsRtFetch";
import {
  GTFS_STOP_ID_TO_PLATFORM,
  GTFS_STOP_ID_TO_STATION,
  stationIndexMap,
} from "@/lib/stationUtils";
import { getFilteredTrips, getTodayScheduleType } from "@/lib/scheduleUtils";
import { delayMinutesFromSeconds } from "@/lib/tripDelay";
import stations from "@/data/stations";
import type { Station } from "@/types/smartSchedule";
import type { GtfsRtTripUpdate, VehicleStopStatus } from "@/types/gtfsRt";

export interface MapTrain {
  key: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed: number | null;
  directionId: number | null;
  /** Raw GTFS trip ID from the feed (not user-facing). */
  tripLabel: string | null;
  /** Human-facing trip number matched against the static schedule. */
  tripNumber: number | null;
  nextStation: Station | null;
  /** Relationship between the vehicle and nextStation (STOPPED_AT,
   *  IN_TRANSIT_TO, INCOMING_AT). Drives what counts as "upcoming". */
  currentStatus: VehicleStopStatus | null;
  delayMinutes: number | null;
  isCanceled: boolean;
  startTime: string | null;
}

/** Map key encoding trip direction + origin start time → human trip number. */
const tripNumberKey = (directionId: number, startTime: string) =>
  `${directionId}|${startTime}`;

interface TripIndexEntry {
  tripNumber: number;
  /** Static per-station scheduled times ("HH:MM"), indexed by stationIndexMap. */
  times: string[];
}

/**
 * Build a lookup map from "directionId|startTime" to the trip's human
 * number and static per-station times for today's active schedule (weekday
 * or weekend). Vehicles in the GTFS-RT feed are always running today, so
 * biasing to today avoids the collision case where weekday and weekend share
 * an origin time and would otherwise overwrite each other.
 */
function buildTripIndex(): Map<string, TripIndexEntry> {
  const index = new Map<string, TripIndexEntry>();
  const north = stations[0];
  const south = stations[stations.length - 1];
  const lastIdx = stations.length - 1;
  const scheduleType = getTodayScheduleType();
  for (const sb of [true, false]) {
    const from = sb ? north : south;
    const to = sb ? south : north;
    const originIdx = sb ? 0 : lastIdx;
    const dirId = sb ? 0 : 1;
    for (const trip of getFilteredTrips(from, to, scheduleType)) {
      const origin = trip.times[originIdx];
      if (origin) {
        index.set(tripNumberKey(dirId, origin), {
          tripNumber: trip.trip,
          times: trip.times,
        });
      }
    }
  }
  return index;
}

export function useMapTrains(): {
  trains: MapTrain[];
  lastUpdated: Date | null;
  isUpstreamDown: boolean;
} {
  const { data: vehicleData, error: vehicleError } = useVehiclePositions();
  const { data: tripData, error: tripError } = useTripUpdates();
  // The live train layer is driven by vehicle positions; trip updates only
  // annotate delays. So "feed down" tracks the vehicle feed primarily, falling
  // back to the trip feed when vehicles haven't errored yet.
  const isUpstreamDown =
    isUpstreamFeedDown(vehicleError) || isUpstreamFeedDown(tripError);
  // Re-run lookups when cached/remote schedule data swaps in.
  const { version: scheduleVersion } = useScheduleData();

  const tripIndex = useMemo(
    () => buildTripIndex(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when schedule data swaps in
    [scheduleVersion],
  );

  return useMemo(() => {
    const lastUpdated =
      vehicleData?.timestamp != null
        ? new Date(vehicleData.timestamp * 1000)
        : null;

    if (!vehicleData?.vehicles) return { trains: [], lastUpdated, isUpstreamDown };

    const updatesByTripId = new Map<string, GtfsRtTripUpdate>();
    for (const update of tripData?.updates ?? []) {
      updatesByTripId.set(update.tripId, update);
    }

    // Max delay across the stops on the VEHICLE'S OWN direction. 511 always
    // reports departureDelay: 0 for late trains and only shifts the absolute
    // departure.time, so delay is derived by diffing each stop's live
    // departure against the static schedule (computeDelayMinutes — the same
    // method the schedule surfaces use). Direction matters: SMART encodes
    // round trips as one GTFS trip whose stop_time_updates span BOTH legs, so
    // opposite-direction platforms must be skipped or their times would be
    // diffed against the wrong trip's schedule (mirrors the direction guard
    // in useTripUpdates.buildStopRealtimeData). Falls back to the feed's own
    // departureDelay for ADDED/DUPLICATED runs with no static match.
    const delayForVehicle = (
      update: GtfsRtTripUpdate,
      directionId: number,
      startTime: string,
    ): number | null => {
      const direction = directionId === 0 ? "southbound" : "northbound";
      const entry = tripIndex.get(tripNumberKey(directionId, startTime));
      let maxDelay: number | null = null;
      for (const stu of update.stopTimeUpdates) {
        if (stu.departureTime == null || !stu.stopId) continue;
        const platform = GTFS_STOP_ID_TO_PLATFORM[stu.stopId];
        if (!platform || platform.direction !== direction) continue;
        const scheduledHHMM = entry?.times[stationIndexMap[platform.station]];
        const mins =
          scheduledHHMM && scheduledHHMM !== "--" && update.startDate
            ? (computeDelayMinutes(
                stu.departureTime,
                scheduledHHMM,
                update.startDate,
              ) ?? null)
            : stu.departureDelay != null
              ? delayMinutesFromSeconds(stu.departureDelay)
              : null;
        if (mins != null && (maxDelay === null || mins > maxDelay)) {
          maxDelay = mins;
        }
      }
      return maxDelay;
    };

    const trains: MapTrain[] = [];
    for (const vehicle of vehicleData.vehicles) {
      if (!vehicle.trip) continue;
      if (vehicle.position.latitude === 0 && vehicle.position.longitude === 0) continue;

      const update = updatesByTripId.get(vehicle.trip.tripId) ?? null;
      const isCanceled = update?.scheduleRelationship === "CANCELED";
      const nextStation = vehicle.stopId
        ? (GTFS_STOP_ID_TO_STATION[vehicle.stopId] ?? null)
        : null;
      const startTime = vehicle.trip.startTime?.slice(0, 5) ?? null;
      const directionId = vehicle.trip.directionId ?? null;
      const delayMinutes =
        update != null && !isCanceled && directionId != null && startTime != null
          ? delayForVehicle(update, directionId, startTime)
          : null;

      trains.push({
        key: vehicle.vehicleId,
        vehicleId: vehicle.vehicleId,
        latitude: vehicle.position.latitude,
        longitude: vehicle.position.longitude,
        bearing: vehicle.position.bearing ?? null,
        speed: vehicle.position.speed ?? null,
        directionId,
        tripLabel: vehicle.trip.tripId ?? null,
        tripNumber:
          startTime != null && directionId != null
            ? (tripIndex.get(tripNumberKey(directionId, startTime))
                ?.tripNumber ?? null)
            : null,
        nextStation,
        currentStatus: vehicle.currentStatus ?? null,
        delayMinutes,
        isCanceled,
        startTime,
      });
    }

    return { trains, lastUpdated, isUpstreamDown };
  }, [vehicleData, tripData, tripIndex, isUpstreamDown]);
}
