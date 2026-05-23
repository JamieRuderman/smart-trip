import { useState, useMemo, useEffect, useCallback } from "react";
import type { Station } from "@/types/smartSchedule";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { createMinuteInterval } from "@/lib/utils";
import { parseDebugTimeFromUrl } from "@/lib/debugTime";
import { useStationSelection } from "@/contexts/stationSelection";

export interface TrainScheduleState {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  showAllTrips: boolean;
  currentTime: Date;
  selectedTripNumber: number | null;
}

export function useTrainScheduleState(scheduleDataVersion?: string) {
  const {
    fromStation,
    toStation,
    scheduleType,
    selectedTripNumber,
    setFromStation: setFromStationCtx,
    setToStation: setToStationCtx,
    setScheduleType,
    swapStations,
    setSelectedTrip,
  } = useStationSelection();

  const debugCurrentTime = useMemo(() => parseDebugTimeFromUrl(), []);

  const [showAllTrips, setShowAllTrips] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date>(
    () => debugCurrentTime ?? new Date(),
  );

  // Update current time every minute
  useEffect(() => {
    if (debugCurrentTime) return;
    return createMinuteInterval(() => {
      setCurrentTime(new Date());
    });
  }, [debugCurrentTime]);

  // Derived values
  const filteredTrips = useMemo(() => {
    if (!fromStation || !toStation) return [];
    return getFilteredTrips(fromStation, toStation, scheduleType);
    // `scheduleDataVersion` is a refresh token from useScheduleData().
    // Keep it in the dependency list so trips recompute when cached/remote
    // schedule data is swapped in memory, even though the value is not read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStation, toStation, scheduleType, scheduleDataVersion]);

  const toggleShowAllTrips = useCallback(() => {
    setShowAllTrips((prev) => !prev);
  }, []);

  // Adapter to match the original `(station: Station) => void` signature
  // expected by StickyHeader and friends.
  const setFromStation = useCallback(
    (station: Station) => setFromStationCtx(station),
    [setFromStationCtx],
  );
  const setToStation = useCallback(
    (station: Station) => setToStationCtx(station),
    [setToStationCtx],
  );

  return {
    // State
    fromStation,
    toStation,
    scheduleType,
    showAllTrips,
    currentTime,
    selectedTripNumber,
    filteredTrips,

    // Actions
    setFromStation,
    setToStation,
    setScheduleType,
    toggleShowAllTrips,
    swapStations,
    setSelectedTrip,
  };
}
