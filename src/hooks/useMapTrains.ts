import { useMemo } from "react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";
import { useScheduleData } from "@/hooks/useScheduleData";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { isWeekend } from "@/lib/utils";
import stations from "@/data/stations";
import type { Station } from "@/types/smartSchedule";
import type { VehicleStopStatus } from "@/types/gtfsRt";

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

/**
 * Build a lookup map from "directionId|startTime" to the trip's human
 * number for today's active schedule (weekday or weekend). Vehicles in the
 * GTFS-RT feed are always running today, so biasing to today avoids the
 * collision case where weekday and weekend share an origin time and would
 * otherwise overwrite each other.
 */
function buildTripNumberIndex(): Map<string, number> {
  const index = new Map<string, number>();
  const north = stations[0];
  const south = stations[stations.length - 1];
  const lastIdx = stations.length - 1;
  const scheduleType = isWeekend() ? "weekend" : "weekday";
  for (const sb of [true, false]) {
    const from = sb ? north : south;
    const to = sb ? south : north;
    const originIdx = sb ? 0 : lastIdx;
    const dirId = sb ? 0 : 1;
    for (const trip of getFilteredTrips(from, to, scheduleType)) {
      const origin = trip.times[originIdx];
      if (origin) index.set(tripNumberKey(dirId, origin), trip.trip);
    }
  }
  return index;
}

export function useMapTrains(): { trains: MapTrain[]; lastUpdated: Date | null } {
  const { data: vehicleData } = useVehiclePositions();
  const { data: tripData } = useTripUpdates();
  // Re-run lookups when cached/remote schedule data swaps in.
  const { version: scheduleVersion } = useScheduleData();

  const tripNumberIndex = useMemo(
    () => buildTripNumberIndex(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when schedule data swaps in
    [scheduleVersion],
  );

  return useMemo(() => {
    const lastUpdated =
      vehicleData?.timestamp != null
        ? new Date(vehicleData.timestamp * 1000)
        : null;

    if (!vehicleData?.vehicles) return { trains: [], lastUpdated };

    const tripDelays = new Map<string, { delayMinutes: number | null; isCanceled: boolean }>();
    if (tripData?.updates) {
      for (const update of tripData.updates) {
        const isCanceled = update.scheduleRelationship === "CANCELED";
        let maxDelay: number | null = null;
        if (!isCanceled) {
          for (const stu of update.stopTimeUpdates) {
            if (stu.departureDelay != null && stu.departureDelay >= 180) {
              const mins = Math.round(stu.departureDelay / 60);
              if (maxDelay === null || mins > maxDelay) maxDelay = mins;
            }
          }
        }
        tripDelays.set(update.tripId, { delayMinutes: maxDelay, isCanceled });
      }
    }

    const trains: MapTrain[] = [];
    for (const vehicle of vehicleData.vehicles) {
      if (!vehicle.trip) continue;
      if (vehicle.position.latitude === 0 && vehicle.position.longitude === 0) continue;

      const tripInfo = tripDelays.get(vehicle.trip.tripId);
      const nextStation = vehicle.stopId
        ? (GTFS_STOP_ID_TO_STATION[vehicle.stopId] ?? null)
        : null;
      const startTime = vehicle.trip.startTime?.slice(0, 5) ?? null;
      const directionId = vehicle.trip.directionId ?? null;

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
            ? (tripNumberIndex.get(tripNumberKey(directionId, startTime)) ??
              null)
            : null,
        nextStation,
        currentStatus: vehicle.currentStatus ?? null,
        delayMinutes: tripInfo?.delayMinutes ?? null,
        isCanceled: tripInfo?.isCanceled ?? false,
        startTime,
      });
    }

    return { trains, lastUpdated };
  }, [vehicleData, tripData, tripNumberIndex]);
}
