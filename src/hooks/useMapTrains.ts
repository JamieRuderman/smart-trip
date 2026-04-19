import { useMemo } from "react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";
import { useScheduleData } from "@/hooks/useScheduleData";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import stations from "@/data/stations";
import type { Station } from "@/types/smartSchedule";
import type { VehicleStopStatus } from "@/types/gtfsRt";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];
const LAST_STATION_INDEX = stations.length - 1;

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

/**
 * Look up a trip's human number (e.g. 41) by matching the vehicle's origin
 * start time against the static schedule. Searches both weekday and weekend
 * schedules so callers don't need to know which day the vehicle is running.
 */
function findTripNumber(
  startTime: string | null,
  directionId: number | null
): number | null {
  if (!startTime || directionId == null) return null;
  const isSouthbound = directionId === 0;
  const from = isSouthbound ? WINDSOR : LARKSPUR;
  const to = isSouthbound ? LARKSPUR : WINDSOR;
  const originIndex = isSouthbound ? 0 : LAST_STATION_INDEX;
  const candidates = [
    ...getFilteredTrips(from, to, "weekday"),
    ...getFilteredTrips(from, to, "weekend"),
  ];
  const match = candidates.find((t) => t.times[originIndex] === startTime);
  return match?.trip ?? null;
}

export function useMapTrains(): { trains: MapTrain[]; lastUpdated: Date | null } {
  const { data: vehicleData } = useVehiclePositions();
  const { data: tripData } = useTripUpdates();
  // Re-run the memo when cached/remote schedule data swaps in so trip-number
  // lookups pick up the latest schedule.
  const { version: scheduleVersion } = useScheduleData();

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
        tripNumber: findTripNumber(startTime, directionId),
        nextStation,
        currentStatus: vehicle.currentStatus ?? null,
        delayMinutes: tripInfo?.delayMinutes ?? null,
        isCanceled: tripInfo?.isCanceled ?? false,
        startTime,
      });
    }

    return { trains, lastUpdated };
    // scheduleVersion intentionally included so trip-number lookups refresh
    // when cached/remote schedule data is swapped in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleData, tripData, scheduleVersion]);
}
