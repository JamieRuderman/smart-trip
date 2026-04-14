import { useMemo } from "react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type { Station } from "@/types/smartSchedule";

export interface MapTrain {
  key: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed: number | null;
  directionId: number | null;
  tripLabel: string | null;
  nextStation: Station | null;
  delayMinutes: number | null;
  isCanceled: boolean;
  startTime: string | null;
}

export function useMapTrains(): { trains: MapTrain[]; lastUpdated: Date | null } {
  const { data: vehicleData } = useVehiclePositions();
  const { data: tripData } = useTripUpdates();

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

      trains.push({
        key: vehicle.vehicleId,
        vehicleId: vehicle.vehicleId,
        latitude: vehicle.position.latitude,
        longitude: vehicle.position.longitude,
        bearing: vehicle.position.bearing ?? null,
        speed: vehicle.position.speed ?? null,
        directionId: vehicle.trip.directionId ?? null,
        tripLabel: vehicle.trip.tripId ?? null,
        nextStation,
        delayMinutes: tripInfo?.delayMinutes ?? null,
        isCanceled: tripInfo?.isCanceled ?? false,
        startTime: vehicle.trip.startTime?.slice(0, 5) ?? null,
      });
    }

    return { trains, lastUpdated };
  }, [vehicleData, tripData]);
}
