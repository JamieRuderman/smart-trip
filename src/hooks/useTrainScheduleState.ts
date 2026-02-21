import { useState, useMemo, useEffect, useCallback } from "react";
import type { Station } from "@/types/smartSchedule";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { useUserPreferences } from "./useUserPreferences";
import { isWeekend, createMinuteInterval } from "@/lib/utils";

export interface TrainScheduleState {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  showAllTrips: boolean;
  currentTime: Date;
}

export function useTrainScheduleState(scheduleDataVersion?: string) {
  const { preferences, isLoaded, updateLastSelected } = useUserPreferences();

  // Initialize state
  const [state, setState] = useState<TrainScheduleState>({
    fromStation: "",
    toStation: "",
    scheduleType: isWeekend() ? "weekend" : "weekday",
    showAllTrips: false,
    currentTime: new Date(),
  });

  // Initialize state from user preferences once loaded
  useEffect(() => {
    if (isLoaded) {
      setState((prev) => ({
        ...prev,
        fromStation: preferences.lastSelectedStations.from,
        toStation: preferences.lastSelectedStations.to,
      }));
    }
  }, [isLoaded, preferences]);

  // Update current time every minute
  useEffect(() => {
    return createMinuteInterval(() => {
      setState((prev) => ({ ...prev, currentTime: new Date() }));
    });
  }, []);

  // Derived values

  const filteredTrips = useMemo(() => {
    if (!state.fromStation || !state.toStation) return [];
    return getFilteredTrips(
      state.fromStation,
      state.toStation,
      state.scheduleType
    );
  }, [state.fromStation, state.toStation, state.scheduleType, scheduleDataVersion]);

  // Action handlers
  const setFromStation = useCallback(
    (station: Station) => {
      setState((prev) => ({ ...prev, fromStation: station }));
      updateLastSelected(station, state.toStation);
    },
    [state.toStation, updateLastSelected]
  );

  const setToStation = useCallback(
    (station: Station) => {
      setState((prev) => ({ ...prev, toStation: station }));
      updateLastSelected(state.fromStation, station);
    },
    [state.fromStation, updateLastSelected]
  );

  const setScheduleType = useCallback((type: "weekday" | "weekend") => {
    setState((prev) => ({ ...prev, scheduleType: type }));
  }, []);

  const toggleShowAllTrips = useCallback(() => {
    setState((prev) => ({ ...prev, showAllTrips: !prev.showAllTrips }));
  }, []);

  const swapStations = useCallback(() => {
    const newFrom = state.toStation;
    const newTo = state.fromStation;
    setState((prev) => ({
      ...prev,
      fromStation: newFrom,
      toStation: newTo,
    }));
    updateLastSelected(newFrom, newTo);
  }, [state.fromStation, state.toStation, updateLastSelected]);

  return {
    // State
    ...state,
    filteredTrips,
    isLoaded,

    // Actions
    setFromStation,
    setToStation,
    setScheduleType,
    toggleShowAllTrips,
    swapStations,
  };
}
