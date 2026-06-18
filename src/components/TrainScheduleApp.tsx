import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStationSelection } from "@/contexts/stationSelection";
import { useScheduleData } from "@/hooks/useScheduleData";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { parseDebugTimeFromUrl } from "@/lib/debugTime";
import { useServiceAlerts } from "@/hooks/useServiceAlerts";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useMapTrains } from "@/hooks/useMapTrains";
import { useUserRiding } from "@/hooks/useUserRiding";
import { getClosestStation, isSouthbound } from "@/lib/stationUtils";
import { focusedTripMatchesSchedule } from "@/lib/focusedTrip";
import { useAutoFocusOnRiding } from "@/hooks/useAutoFocusOnRiding";
import {
  HEADER_HEIGHTS,
  HEADER_MAX_HEIGHTS,
  useResponsiveHeaderHeights,
  useStickyHeaderCollapse,
} from "@/hooks/useHeaderHeights";
import { StickyHeader } from "./StickyHeader";
import { ScheduleResults } from "./ScheduleResults";
import { FareSection } from "./FareSection";
import BottomInfoBar from "./BottomInfoBar";
import { ServiceAlert } from "./ServiceAlert";
import { OfflineBanner } from "./OfflineBanner";
import { NoTripsFound } from "./NoTripsFound";
import { MapPreviewCard } from "./MapPreviewCard";
import { MapDiagramPreviewCard } from "./MapDiagramPreviewCard";
import { TripModeHeader } from "./TripModeHeader";
import { EmptyState } from "./EmptyState";
import { TripDetailSheet } from "./TripDetailSheet";
import { getDevFixture } from "@/lib/devFixtures";

export function TrainScheduleApp() {
  const { version: scheduleDataVersion } = useScheduleData();
  const headerContainerRef = useRef<HTMLDivElement>(null);
  const headerHeights = useResponsiveHeaderHeights();
  useStickyHeaderCollapse(headerContainerRef, headerHeights);
  const maxHeaderHeight =
    headerHeights.logo === HEADER_HEIGHTS.logo.large
      ? HEADER_MAX_HEIGHTS.large
      : HEADER_MAX_HEIGHTS.small;
  // In trip mode the planner header is replaced by the pinned trip card, whose
  // (expanded) height is measured so the page reserves matching top padding.
  const [tripHeaderHeight, setTripHeaderHeight] = useState(0);
  const {
    fromStation,
    toStation,
    scheduleType,
    selectedTripNumber,
    setFromStation,
    setToStation,
    setScheduleType,
    swapStations,
    setSelectedTrip,
    focusedTrip,
  } = useStationSelection();

  const debugCurrentTime = useMemo(() => parseDebugTimeFromUrl(), []);
  const [currentTime, setCurrentTime] = useState<Date>(
    () => debugCurrentTime ?? new Date(),
  );
  useEffect(() => {
    if (debugCurrentTime) return;
    let timeoutId = 0;
    let intervalId = 0;
    const tick = () => setCurrentTime(new Date());
    // Align the tick to the wall-clock minute boundary so the displayed minute
    // flips exactly when the clock rolls over, not up to ~59s late.
    const startAligned = () => {
      timeoutId = window.setTimeout(() => {
        tick();
        intervalId = window.setInterval(tick, 60_000);
      }, 60_000 - (Date.now() % 60_000));
    };
    startAligned();
    // JS timers are suspended while the app is backgrounded, so `currentTime`
    // — and every countdown derived from it — is stale on return. Resync the
    // instant we become visible/focused again, then realign the interval.
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      tick();
      startAligned();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [debugCurrentTime]);

  const [showAllTrips, setShowAllTrips] = useState(false);
  const toggleShowAllTrips = useCallback(() => {
    setShowAllTrips((prev) => !prev);
  }, []);

  // `scheduleDataVersion` is a refresh token from useScheduleData(); included
  // so trips recompute when cached/remote schedule data swaps in memory.
  const filteredTrips = useMemo(() => {
    if (!fromStation || !toStation) return [];
    return getFilteredTrips(fromStation, toStation, scheduleType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStation, toStation, scheduleType, scheduleDataVersion]);

  const { alerts } = useServiceAlerts(fromStation, toStation);

  // Geolocation for closest station + riding detection. `watch: true` keeps
  // speedMps/heading fresh so `useUserRiding` can latch onto the train the
  // user is on while they have the schedule open.
  const {
    lat,
    lng,
    speedMps,
    heading,
    loading: locationLoading,
    requestLocation,
  } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
  });
  const closestStation =
    lat != null && lng != null ? getClosestStation(lat, lng) : null;

  // Live trains + which one the user is currently on. We only need this to
  // highlight the matching row — pass the derived trip number + direction
  // down rather than the full train list.
  const { trains } = useMapTrains();
  const { ridingTrainKey } = useUserRiding({
    userLat: lat,
    userLng: lng,
    userSpeedMps: speedMps,
    userHeading: heading,
    trains,
  });
  const ridingTrain = useMemo(
    () =>
      ridingTrainKey ? trains.find((t) => t.key === ridingTrainKey) ?? null : null,
    [trains, ridingTrainKey],
  );
  const ridingTripNumber = ridingTrain?.tripNumber ?? null;
  const ridingIsSouthbound =
    ridingTrain?.directionId == null ? null : ridingTrain.directionId === 0;

  useAutoFocusOnRiding({
    ridingTripNumber,
    ridingIsSouthbound,
    currentTime,
    homeFromStation: fromStation,
    homeToStation: toStation,
  });

  // Auto-select from station when location first resolves (native or first web grant).
  // Skip if the closest station is already the destination — that would create an invalid route.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (
      closestStation &&
      !fromStation &&
      !didAutoSelect.current &&
      closestStation !== toStation
    ) {
      didAutoSelect.current = true;
      setFromStation(closestStation);
    }
  }, [closestStation, fromStation, toStation, setFromStation]);

  // When the user explicitly taps the location button: snap to closest station
  // immediately if we already have it, otherwise request fresh location.
  // A ref tracks whether a manual request is in flight so we can auto-select
  // when the location resolves without clobbering the user's own selection otherwise.
  const locationRequestedRef = useRef(false);

  const applyClosestStation = useCallback(
    (station: NonNullable<typeof closestStation>) => {
      setFromStation(station);
      if (station === toStation) {
        setToStation("");
      }
    },
    [setFromStation, setToStation, toStation],
  );

  useEffect(() => {
    if (closestStation && locationRequestedRef.current) {
      locationRequestedRef.current = false;
      applyClosestStation(closestStation);
    }
  }, [applyClosestStation, closestStation]);

  const handleRequestLocation = useCallback(() => {
    if (closestStation) {
      applyClosestStation(closestStation);
    } else {
      locationRequestedRef.current = true;
      requestLocation();
    }
  }, [applyClosestStation, closestStation, requestLocation]);

  // Dev-only: ?devTrip=<scenario> opens the sheet with fixture data
  const devFixture = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const param = new URLSearchParams(window.location.search).get("devTrip");
    return param ? getDevFixture(param) : null;
  }, []);

  // Highlight the focused trip's row blue whenever the focused train runs in
  // the displayed schedule's direction (same shared predicate as the station
  // sheet and detail sheet), not only when the home leg exactly equals the
  // focused leg — otherwise the same train reads as focused in the sheets but
  // not in the list. The row stays in the list (it also appears pinned above);
  // the duplication is intentional.
  const focusedTripNumber =
    fromStation &&
    toStation &&
    focusedTripMatchesSchedule(
      focusedTrip,
      isSouthbound(fromStation, toStation),
      scheduleType,
    )
      ? focusedTrip.tripNumber
      : null;

  return (
    <div
      className="min-h-[100dvh] bg-card md:bg-background relative"
      ref={headerContainerRef}
    >
      {focusedTrip ? (
        <TripModeHeader
          currentTime={currentTime}
          timeFormat="12h"
          onHeightChange={setTripHeaderHeight}
        />
      ) : (
        <StickyHeader
          fromStation={fromStation}
          toStation={toStation}
          scheduleType={scheduleType}
          headerHeights={headerHeights}
          onFromStationChange={setFromStation}
          onToStationChange={setToStation}
          onScheduleTypeChange={setScheduleType}
          onSwapStations={swapStations}
          closestStation={closestStation}
          locationLoading={locationLoading}
          onRequestLocation={handleRequestLocation}
        />
      )}

      <main
        className="flex flex-col min-h-[100vh] container mx-auto px-4 pb-4 md:pb-6 space-y-4"
        role="main"
        aria-label="Train schedule planning interface"
        style={{
          overflowAnchor: "none",
          // Trip mode: reserve the measured pinned-card height (already includes
          // the safe-area inset). Planner: the constant header height + inset.
          paddingTop: focusedTrip
            ? `${tripHeaderHeight || maxHeaderHeight}px`
            : `calc(${maxHeaderHeight}px + var(--safe-area-top))`,
        }}
      >
        {/* Connectivity banner — only renders when offline */}
        <OfflineBanner />

        {/* Service Alerts */}
        <ServiceAlert alerts={alerts} />

        {/* Live Train Map */}
        <MapDiagramPreviewCard />

        {/* Empty State - No stations selected */}
        {(!fromStation || !toStation) && <EmptyState />}

        {/* Schedule Results */}
        {filteredTrips.length > 0 && fromStation && toStation && (
          <ScheduleResults
            filteredTrips={filteredTrips}
            fromStation={fromStation}
            toStation={toStation}
            currentTime={currentTime}
            showAllTrips={showAllTrips}
            onToggleShowAllTrips={toggleShowAllTrips}
            timeFormat="12h"
            scheduleType={scheduleType}
            selectedTripNumber={selectedTripNumber}
            onSelectTrip={setSelectedTrip}
            ridingTripNumber={ridingTripNumber}
            ridingIsSouthbound={ridingIsSouthbound}
            focusedTripNumber={focusedTripNumber}
          />
        )}
        {fromStation && toStation && filteredTrips.length === 0 && (
          <NoTripsFound />
        )}

        {/* Fare Section */}
        {fromStation && toStation && (
          <FareSection fromStation={fromStation} toStation={toStation} />
        )}

        {/* Geographic map — secondary; lives below the trip-planning content
            since regulars rarely need it but newcomers may want geographic
            context after they've picked a route. */}
        <MapPreviewCard />

        {/* Bottom bar */}
        <BottomInfoBar />
      </main>

      {/* Dev fixture sheet — only rendered in dev mode via ?devTrip=<scenario> */}
      {devFixture && (
        <TripDetailSheet
          isOpen={true}
          onClose={() => {}}
          trip={devFixture.trip}
          fromStation={devFixture.trip.fromStation}
          toStation={devFixture.trip.toStation}
          currentTime={currentTime}
          lastUpdated={null}
          realtimeStatus={devFixture.realtimeStatus}
          timeFormat="12h"
          isNextTrip={false}
          showFerry={false}
          scheduleType={scheduleType}
          vehiclePositionOverride={devFixture.vehiclePosition}
        />
      )}
    </div>
  );
}
