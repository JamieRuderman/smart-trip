import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import type { Station } from "@/types/smartSchedule";
import { getTodayScheduleType } from "@/lib/scheduleUtils";
import { APP_CONSTANTS } from "@/lib/fareConstants";
import {
  StationSelectionContext,
  type StationSelection,
} from "./stationSelection";

// --- Native state persistence ---

interface PersistedState {
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  tripNumber: number | null;
  savedAt: number;
}

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(APP_CONSTANTS.ACTIVE_TRIP_STORAGE_KEY);
    if (!raw) return null;
    const parsed: PersistedState = JSON.parse(raw);
    // Reject anything missing required fields. `scheduleType` is checked
    // explicitly because an earlier persistence schema (used by the original
    // useTrainScheduleState hook) omitted it; surviving records would
    // otherwise inject `undefined` into the schedule cache key and yield
    // empty trip lists after upgrade.
    if (
      !parsed.fromStation ||
      !parsed.toStation ||
      !parsed.savedAt ||
      (parsed.scheduleType !== "weekday" && parsed.scheduleType !== "weekend")
    ) {
      localStorage.removeItem(APP_CONSTANTS.ACTIVE_TRIP_STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > EXPIRY_MS) {
      localStorage.removeItem(APP_CONSTANTS.ACTIVE_TRIP_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedState(
  fromStation: Station,
  toStation: Station,
  scheduleType: "weekday" | "weekend",
  tripNumber: number | null,
): void {
  try {
    const data: PersistedState = {
      fromStation,
      toStation,
      scheduleType,
      tripNumber,
      savedAt: Date.now(),
    };
    localStorage.setItem(
      APP_CONSTANTS.ACTIVE_TRIP_STORAGE_KEY,
      JSON.stringify(data),
    );
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded).
  }
}

/** Params owned by this context — all others are preserved verbatim. */
const MANAGED_PARAMS = new Set(["from", "to", "trip", "type"]);

const todayScheduleType = (): "weekday" | "weekend" =>
  getTodayScheduleType();

interface ProviderState {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  selectedTripNumber: number | null;
}

export function StationSelectionProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  // Detect shared-link mode on init: URL has both ?trip=N and ?type=T.
  // In shared mode we honour the URL type so the recipient sees the same
  // schedule as the sender, even if it doesn't match their current day.
  // When the user closes the shared trip, we revert to today's type.
  const initialUrlTrip = searchParams.get("trip");
  const initialUrlTripNumber =
    initialUrlTrip !== null ? parseInt(initialUrlTrip, 10) : NaN;
  const initialUrlType = searchParams.get("type") as
    | "weekday"
    | "weekend"
    | null;
  const isSharedLinkOnMount =
    !isNaN(initialUrlTripNumber) && initialUrlType !== null;
  const isSharedLinkRef = useRef(isSharedLinkOnMount);

  const [state, setState] = useState<ProviderState>(() => {
    const persisted = Capacitor.isNativePlatform() ? loadPersistedState() : null;
    return {
      fromStation:
        (searchParams.get("from") as Station) ||
        (persisted ? persisted.fromStation : ""),
      toStation:
        (searchParams.get("to") as Station) ||
        (persisted ? persisted.toStation : ""),
      scheduleType:
        isSharedLinkOnMount && initialUrlType
          ? initialUrlType
          : persisted
            ? persisted.scheduleType
            : todayScheduleType(),
      selectedTripNumber: !isNaN(initialUrlTripNumber)
        ? initialUrlTripNumber
        : persisted
          ? persisted.tripNumber
          : null,
    };
  });

  // Sync state → URL whenever the canonical values OR the pathname change.
  // Including pathname matters because back-navigation may restore a URL whose
  // params predate edits made on another route; we re-assert state onto it.
  // Unmanaged params (e.g. debugTime, debugDate, devTrip) are preserved as-is.
  //
  // `searchParams` is read via a ref so we always merge against the latest
  // URL without making this effect depend on it (which would loop, since
  // `setSearchParams` triggers a new `searchParams` identity).
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  useEffect(() => {
    const params: Record<string, string> = {};
    searchParamsRef.current.forEach((value, key) => {
      if (!MANAGED_PARAMS.has(key)) params[key] = value;
    });
    if (state.fromStation) params.from = state.fromStation;
    if (state.toStation) params.to = state.toStation;
    if (state.selectedTripNumber != null) {
      params.trip = String(state.selectedTripNumber);
      params.type = state.scheduleType;
    }
    setSearchParams(params, { replace: true });
  }, [
    state.fromStation,
    state.toStation,
    state.selectedTripNumber,
    state.scheduleType,
    location.pathname,
    setSearchParams,
  ]);

  // Persist state to localStorage on native so it survives app restarts (24h expiry).
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    if (
      !Capacitor.isNativePlatform() ||
      !state.fromStation ||
      !state.toStation
    )
      return;
    savePersistedState(
      state.fromStation,
      state.toStation,
      state.scheduleType,
      state.selectedTripNumber,
    );
  }, [
    state.fromStation,
    state.toStation,
    state.scheduleType,
    state.selectedTripNumber,
  ]);

  // Setters. When one endpoint is set to a station that equals the other,
  // drop the other so we never produce a zero-length trip — this turns a
  // "swap origin & destination" gesture into a one-tap flow.
  const setFromStation = useCallback((station: Station | "") => {
    setState((prev) => ({
      ...prev,
      fromStation: station,
      toStation: station && prev.toStation === station ? "" : prev.toStation,
    }));
  }, []);

  const setToStation = useCallback((station: Station | "") => {
    setState((prev) => ({
      ...prev,
      toStation: station,
      fromStation:
        station && prev.fromStation === station ? "" : prev.fromStation,
    }));
  }, []);

  const swapStations = useCallback(() => {
    setState((prev) => ({
      ...prev,
      fromStation: prev.toStation,
      toStation: prev.fromStation,
    }));
  }, []);

  const setScheduleType = useCallback((type: "weekday" | "weekend") => {
    setState((prev) => ({ ...prev, scheduleType: type }));
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
        scheduleType: exitingSharedLink
          ? todayScheduleType()
          : prev.scheduleType,
      };
    });
  }, []);

  const value = useMemo<StationSelection>(
    () => ({
      fromStation: state.fromStation,
      toStation: state.toStation,
      scheduleType: state.scheduleType,
      selectedTripNumber: state.selectedTripNumber,
      setFromStation,
      setToStation,
      swapStations,
      setScheduleType,
      setSelectedTrip,
    }),
    [
      state.fromStation,
      state.toStation,
      state.scheduleType,
      state.selectedTripNumber,
      setFromStation,
      setToStation,
      swapStations,
      setScheduleType,
      setSelectedTrip,
    ],
  );

  return (
    <StationSelectionContext.Provider value={value}>
      {children}
    </StationSelectionContext.Provider>
  );
}
