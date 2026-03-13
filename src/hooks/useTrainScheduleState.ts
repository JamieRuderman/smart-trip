import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { Station } from "@/types/smartSchedule";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { isWeekend, createMinuteInterval } from "@/lib/utils";
import { parseDebugTimeFromUrl } from "@/lib/debugTime";

export interface TrainScheduleState {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  showAllTrips: boolean;
  currentTime: Date;
  selectedTripNumber: number | null;
}

/** Returns the schedule type appropriate for the current calendar day. */
const todayScheduleType = (): "weekday" | "weekend" =>
  isWeekend() ? "weekend" : "weekday";

/** Params managed by the state sync — all others are preserved verbatim. */
const MANAGED_PARAMS = new Set(["from", "to", "trip", "type"]);

export function useTrainScheduleState(scheduleDataVersion?: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const debugCurrentTime = useMemo(() => parseDebugTimeFromUrl(), []);

  // Detect shared-link mode on init: URL has both ?trip=N and ?type=T.
  // In shared mode we honour the URL type so the recipient sees the same
  // schedule as the sender, even if it doesn't match their current day.
  // When the user closes the shared trip, we revert to today's type.
  const urlTrip = searchParams.get("trip");
  const urlTripNumber = urlTrip !== null ? parseInt(urlTrip, 10) : NaN;
  const urlType = searchParams.get("type") as "weekday" | "weekend" | null;
  const isSharedLink = !isNaN(urlTripNumber) && urlType !== null;

  // Track whether we entered via a shared link so setSelectedTrip knows to revert.
  const isSharedLinkRef = useRef(isSharedLink);

  const [state, setState] = useState<TrainScheduleState>({
    fromStation: (searchParams.get("from") as Station) ?? "",
    toStation: (searchParams.get("to") as Station) ?? "",
    // Shared-link mode: use the URL type. Normal mode: always auto-detect from today.
    scheduleType: isSharedLink && urlType ? urlType : todayScheduleType(),
    // Expand all trips when deep-linking to a specific trip so it's always visible,
    // even if it's an en-route trip that would otherwise be hidden above the fold.
    showAllTrips: !isNaN(urlTripNumber),
    currentTime: debugCurrentTime ?? new Date(),
    selectedTripNumber: !isNaN(urlTripNumber) ? urlTripNumber : null,
  });

  // Sync state → URL whenever stations or selected trip change.
  // type is included only when a trip is open (shared-link context); without
  // a trip it is omitted so stale type params never affect a fresh page load.
  // Unmanaged params (e.g. debugTime, debugDate) are preserved as-is.
  useEffect(() => {
    const params: Record<string, string> = {};
    // Carry forward any params we don't own (debug helpers, etc.)
    searchParams.forEach((value, key) => {
      if (!MANAGED_PARAMS.has(key)) params[key] = value;
    });
    if (state.fromStation) params.from = state.fromStation;
    if (state.toStation) params.to = state.toStation;
    if (state.selectedTripNumber != null) {
      params.trip = String(state.selectedTripNumber);
      params.type = state.scheduleType;
    }
    setSearchParams(params, { replace: true });
  }, [state.fromStation, state.toStation, state.selectedTripNumber, state.scheduleType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update current time every minute
  useEffect(() => {
    if (debugCurrentTime) return;
    return createMinuteInterval(() => {
      setState((prev) => ({ ...prev, currentTime: new Date() }));
    });
  }, [debugCurrentTime]);

  // Derived values

  const filteredTrips = useMemo(() => {
    void scheduleDataVersion;
    if (!state.fromStation || !state.toStation) return [];
    return getFilteredTrips(
      state.fromStation,
      state.toStation,
      state.scheduleType
    );
  }, [state.fromStation, state.toStation, state.scheduleType, scheduleDataVersion]);

  // Action handlers
  const setFromStation = useCallback((station: Station) => {
    setState((prev) => ({ ...prev, fromStation: station }));
  }, []);

  const setToStation = useCallback((station: Station) => {
    setState((prev) => ({ ...prev, toStation: station }));
  }, []);

  const setScheduleType = useCallback((type: "weekday" | "weekend") => {
    setState((prev) => ({ ...prev, scheduleType: type }));
  }, []);

  const toggleShowAllTrips = useCallback(() => {
    setState((prev) => ({ ...prev, showAllTrips: !prev.showAllTrips }));
  }, []);

  const swapStations = useCallback(() => {
    setState((prev) => ({
      ...prev,
      fromStation: prev.toStation,
      toStation: prev.fromStation,
    }));
  }, []);

  const setSelectedTrip = useCallback((tripNumber: number | null) => {
    setState((prev) => {
      // When closing a shared-link trip, exit shared mode by reverting
      // scheduleType to today's auto-detected value.
      const exitingSharedLink = tripNumber === null && isSharedLinkRef.current;
      if (exitingSharedLink) isSharedLinkRef.current = false;
      return {
        ...prev,
        selectedTripNumber: tripNumber,
        scheduleType: exitingSharedLink ? todayScheduleType() : prev.scheduleType,
      };
    });
  }, []);

  return {
    // State
    ...state,
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
