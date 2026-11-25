import { isSharedTripPath } from "@/lib/sharedTrip";
import { TRIP_VIEW_PATH } from "@/lib/tripView";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { isFerryLeg, placeStation, type Place } from "@/lib/places";
import { getTodayScheduleType } from "@/lib/scheduleUtils";
import { toLocalDateKey } from "@/lib/timeUtils";
import { APP_CONSTANTS } from "@/lib/fareConstants";
import { useFocusedTrip } from "@/hooks/useFocusedTrip";
import { endTripActivity } from "@/lib/native/liveActivity";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  focusedPlaces,
  loadFocusedTrip,
} from "@/lib/focusedTrip";
import {
  StationSelectionContext,
  type PreviewTrip,
  type StationSelection,
} from "./stationSelection";

// --- Native state persistence ---

interface PersistedState {
  fromStation: Place;
  toStation: Place;
  scheduleType: "weekday" | "weekend";
  savedAt: number;
}

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  fromStation: Place,
  toStation: Place,
  scheduleType: "weekday" | "weekend",
): void {
  try {
    const data: PersistedState = {
      fromStation,
      toStation,
      scheduleType,
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

function sameStation(a: Place | "", b: Place | ""): boolean {
  return a !== "" && b !== "" && placeStation(a) === placeStation(b);
}

/** Params owned by this context — all others are preserved verbatim. */
const MANAGED_PARAMS = new Set(["from", "to", "trip", "type", "tripFrom", "tripTo"]);

const todayScheduleType = (): "weekday" | "weekend" =>
  getTodayScheduleType();

/** The train a URL links to (?trip=N, its schedule in ?type and, when they
 *  differ from the selected leg, its own ends in ?tripFrom / ?tripTo). */
function previewFromParams(
  params: URLSearchParams,
  fromPlace: Place | "",
  toPlace: Place | "",
): PreviewTrip | null {
  const tripNumber = parseInt(params.get("trip") ?? "", 10);
  const from =
    (params.get("tripFrom") as Place) || (params.get("from") as Place) || fromPlace;
  const to = (params.get("tripTo") as Place) || (params.get("to") as Place) || toPlace;
  if (isNaN(tripNumber) || !from || !to) return null;
  const type = params.get("type");
  return {
    tripNumber,
    from,
    to,
    scheduleType: type === "weekday" || type === "weekend" ? type : todayScheduleType(),
  };
}

function samePreview(a: PreviewTrip | null, b: PreviewTrip | null): boolean {
  return (
    a === b ||
    (a != null &&
      b != null &&
      a.tripNumber === b.tripNumber &&
      a.from === b.from &&
      a.to === b.to &&
      a.scheduleType === b.scheduleType)
  );
}

interface ProviderState {
  fromPlace: Place | "";
  toPlace: Place | "";
  scheduleType: "weekday" | "weekend";
  scheduleCheckedOn: string;
  previewTrip: PreviewTrip | null;
}

export function StationSelectionProvider({ children }: { children: ReactNode }) {
  const [urlParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isTripPreview = isSharedTripPath(location.pathname);
  const searchParams = isTripPreview ? new URLSearchParams() : urlParams;

  const [state, setState] = useState<ProviderState>(() => {
    // Source precedence for the selected leg: URL params (shared/bookmarked
    // links win) → localStorage (last selection, web + native, 7-day expiry) →
    // the focused trip's own leg (so My Trip and the schedule stay in sync even
    // if the persisted selection has expired). All three may be absent on a
    // truly cold start, leaving the empty state.
    const persisted = loadPersistedState();
    const focusedOnMount = loadFocusedTrip();
    const focusedOnMountPlaces = focusedOnMount ? focusedPlaces(focusedOnMount) : null;
    const fromPlace: Place | "" =
      (searchParams.get("from") as Place) ||
      (persisted ? persisted.fromStation : "") ||
      (focusedOnMountPlaces ? focusedOnMountPlaces.from : "");
    const toPlace: Place | "" =
      (searchParams.get("to") as Place) ||
      (persisted ? persisted.toStation : "") ||
      (focusedOnMountPlaces ? focusedOnMountPlaces.to : "");
    return {
      fromPlace,
      toPlace,
      // Schedule type is derived from the calendar day, never restored from
      // persistence: a leg saved on a weekday must not force the weekday
      // schedule when reopened on a weekend (and vice-versa). Restoring it
      // desynced the schedule list from "today", which — because train numbers
      // repeat across weekday/weekend — made the focused trip reconstruct a
      // different run than the one shown in the list. A linked train carries
      // its own schedule type in previewTrip instead.
      scheduleType: todayScheduleType(),
      scheduleCheckedOn: toLocalDateKey(new Date()),
      previewTrip: previewFromParams(searchParams, fromPlace, toPlace),
    };
  });

  // Sync state → URL whenever the canonical values OR the pathname change.
  // Including pathname matters because back-navigation may restore a URL whose
  // params predate edits made on another route; we re-assert state onto it.
  // Unmanaged params (e.g. debugTime, debugDate, devTrip) are preserved as-is.
  //
  // Caveat: this resolves "?…" against the pathname captured at render, so a
  // navigation fired from a child's mount effect in the same commit (e.g. a
  // <Navigate> on first render) gets replaced by it. Decide launch-time routes
  // before the router mounts instead (see openTripViewOnLaunch).
  //
  // `searchParams` is read via a ref so we always merge against the latest
  // URL without making this effect depend on it (which would loop, since
  // `setSearchParams` triggers a new `searchParams` identity).
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const lastLocationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isTripPreview) return;
    // A navigation onto the trip page (Back/Forward included) shows the train
    // its URL names; only state changes made on the page write the URL.
    const navigated = lastLocationKeyRef.current !== location.key;
    lastLocationKeyRef.current = location.key;
    if (navigated && location.pathname === TRIP_VIEW_PATH) {
      const linked = previewFromParams(
        searchParamsRef.current,
        state.fromPlace,
        state.toPlace,
      );
      if (!samePreview(linked, state.previewTrip)) {
        setState((prev) => ({ ...prev, previewTrip: linked }));
        return;
      }
    }
    const params: Record<string, string> = {};
    searchParamsRef.current.forEach((value, key) => {
      if (!MANAGED_PARAMS.has(key)) params[key] = value;
    });
    if (state.fromPlace) params.from = state.fromPlace;
    if (state.toPlace) params.to = state.toPlace;
    const preview = state.previewTrip;
    if (preview) {
      params.trip = String(preview.tripNumber);
      params.type = preview.scheduleType;
      if (preview.from !== state.fromPlace) params.tripFrom = preview.from;
      if (preview.to !== state.toPlace) params.tripTo = preview.to;
    }
    const next = new URLSearchParams(params).toString();
    if (next !== searchParamsRef.current.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [
    state.fromPlace,
    state.toPlace,
    state.previewTrip,
    location.pathname,
    location.key,
    isTripPreview,
    setSearchParams,
  ]);

  // Persist the selected leg to localStorage (web + native) so it survives
  // reloads / app restarts (7-day expiry). The URL still takes precedence on the
  // next load; this is the fallback when the URL has no from/to params.
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    if (!state.fromPlace || !state.toPlace) return;
    savePersistedState(state.fromPlace, state.toPlace, state.scheduleType);
  }, [state.fromPlace, state.toPlace, state.scheduleType]);

  // Setters. When one end is set to a place on the same station as the other
  // (San Francisco shares Larkspur's), drop the other so we never produce a
  // zero-length trip — this turns a "swap origin & destination" gesture into a
  // one-tap flow.
  const setFromStation = useCallback((place: Place | "") => {
    setState((prev) => ({
      ...prev,
      fromPlace: place,
      toPlace: sameStation(place, prev.toPlace) ? "" : prev.toPlace,
    }));
  }, []);

  const setToStation = useCallback((place: Place | "") => {
    setState((prev) => ({
      ...prev,
      toPlace: place,
      fromPlace: sameStation(place, prev.fromPlace) ? "" : prev.fromPlace,
    }));
  }, []);

  const swapStations = useCallback(() => {
    setState((prev) => ({
      ...prev,
      fromPlace: prev.toPlace,
      toPlace: prev.fromPlace,
    }));
  }, []);

  const setScheduleType = useCallback((type: "weekday" | "weekend") => {
    setState((prev) => ({
      ...prev,
      scheduleType: type,
      scheduleCheckedOn: toLocalDateKey(new Date()),
    }));
  }, []);

  const confirmScheduleCheckedOn = useCallback((date: string) => {
    setState((prev) =>
      prev.scheduleCheckedOn === date ? prev : { ...prev, scheduleCheckedOn: date },
    );
  }, []);

  const setPreviewTrip = useCallback((previewTrip: PreviewTrip | null) => {
    setState((prev) => ({ ...prev, previewTrip }));
  }, []);


  // The "stations updated" notice — likewise hosted at the app root (by
  // StationsUpdatedHost) so it outlives the sheet that opened it.
  const [stationsUpdatedOpen, setStationsUpdatedOpen] = useState(false);
  const openStationsUpdated = useCallback(() => setStationsUpdatedOpen(true), []);
  const closeStationsUpdated = useCallback(
    () => setStationsUpdatedOpen(false),
    [],
  );

  const {
    focusedTrip,
    focusTrip,
    setReminder,
    rescheduleReminder,
    updateLiveActivity,
    clearFocusedTrip,
  } = useFocusedTrip();

  // Clear the focused trip once the train has arrived AND reconcile a
  // past-fire reminder. loadFocusedTrip() drops the trip record on arrival and
  // stamps the reminder `firedAt` once reminderAt has passed; this tick just
  // notices and dispatches so My Trip / the reminder pill re-renders. On
  // native there's no JS callback when the OS-scheduled alarm fires, so this
  // tick is the only thing that catches up the UI within ~30s. A 30s cadence
  // is prompt without busy-work.
  useEffect(() => {
    if (!focusedTrip) return;
    const tick = window.setInterval(() => {
      if (loadFocusedTrip() === null) {
        // The storage layer auto-cleared the trip (arrival passed / timetable
        // changed) but can't reach the plugin — end its Live Activity here so
        // the lock-screen countdown doesn't linger past arrival.
        if (focusedTrip.liveActivityId) {
          void endTripActivity(focusedTrip.liveActivityId);
        }
        window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
        return;
      }
      // Nudge a re-read exactly once when the reminder first fires — the handler
      // reloads the trip, which stamps `firedAt` and flips the card to its "time
      // to go" state. Guarding on `!firedAt` stops this from re-dispatching every
      // tick for the rest of the (still-focused) trip.
      if (
        focusedTrip.reminder &&
        focusedTrip.reminder.firedAt == null &&
        focusedTrip.reminder.reminderAt <= Date.now()
      ) {
        window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
      }
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [focusedTrip]);

  const value = useMemo<StationSelection>(
    () => ({
      fromPlace: state.fromPlace,
      toPlace: state.toPlace,
      fromStation: state.fromPlace && placeStation(state.fromPlace),
      toStation: state.toPlace && placeStation(state.toPlace),
      viaFerry: isFerryLeg(state.fromPlace, state.toPlace),
      scheduleType: state.scheduleType,
      scheduleCheckedOn: state.scheduleCheckedOn,
      confirmScheduleCheckedOn,
      previewTrip: state.previewTrip,
      setFromStation,
      setToStation,
      swapStations,
      setScheduleType,
      setPreviewTrip,
      stationsUpdatedOpen,
      openStationsUpdated,
      closeStationsUpdated,
      focusedTrip,
      focusTrip,
      setReminder,
      rescheduleReminder,
      updateLiveActivity,
      clearFocusedTrip,
    }),
    [
      state.fromPlace,
      state.toPlace,
      state.scheduleType,
      state.scheduleCheckedOn,
      confirmScheduleCheckedOn,
      state.previewTrip,
      setFromStation,
      setToStation,
      swapStations,
      setScheduleType,
      setPreviewTrip,
      stationsUpdatedOpen,
      openStationsUpdated,
      closeStationsUpdated,
      focusedTrip,
      focusTrip,
      setReminder,
      rescheduleReminder,
      updateLiveActivity,
      clearFocusedTrip,
    ],
  );

  return (
    <StationSelectionContext.Provider value={value}>
      {children}
    </StationSelectionContext.Provider>
  );
}
