import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTrainScheduleState } from "@/hooks/useTrainScheduleState";
import { useScheduleData } from "@/hooks/useScheduleData";
import { useServiceAlerts } from "@/hooks/useServiceAlerts";
import { useGeolocation } from "@/hooks/useGeolocation";
import { getClosestStation } from "@/lib/stationUtils";
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
import { NoTripsFound } from "./NoTripsFound";
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
  const {
    fromStation,
    toStation,
    scheduleType,
    showAllTrips,
    currentTime,
    filteredTrips,
    selectedTripNumber,
    setFromStation,
    setToStation,
    setScheduleType,
    toggleShowAllTrips,
    swapStations,
    setSelectedTrip,
  } = useTrainScheduleState(scheduleDataVersion);

  const { alerts } = useServiceAlerts(fromStation, toStation);

  // Geolocation for closest station
  const { lat, lng, loading: locationLoading, requestLocation } = useGeolocation({
    watch: false,
    autoRequestOnNative: true,
  });
  const closestStation = lat != null && lng != null ? getClosestStation(lat, lng) : null;

  // Auto-select from station when location first resolves (native or first web grant).
  // Skip if the closest station is already the destination — that would create an invalid route.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (closestStation && !fromStation && !didAutoSelect.current && closestStation !== toStation) {
      didAutoSelect.current = true;
      setFromStation(closestStation);
    }
  }, [closestStation, fromStation, toStation, setFromStation]);

  // When the user explicitly taps the location button: snap to closest station
  // immediately if we already have it, otherwise request fresh location.
  // A ref tracks whether a manual request is in flight so we can auto-select
  // when the location resolves without clobbering the user's own selection otherwise.
  const locationRequestedRef = useRef(false);
  useEffect(() => {
    if (closestStation && locationRequestedRef.current && closestStation !== toStation) {
      locationRequestedRef.current = false;
      setFromStation(closestStation);
    }
  }, [closestStation, toStation, setFromStation]);

  const handleRequestLocation = useCallback(() => {
    if (closestStation && closestStation !== toStation) {
      setFromStation(closestStation);
    } else {
      locationRequestedRef.current = true;
      requestLocation();
    }
  }, [closestStation, toStation, requestLocation, setFromStation]);

  // Dev-only: ?devTrip=<scenario> opens the sheet with fixture data
  const devFixture = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const param = new URLSearchParams(window.location.search).get("devTrip");
    return param ? getDevFixture(param) : null;
  }, []);

  return (
    <div
      className="min-h-[100dvh] bg-card md:bg-background relative"
      ref={headerContainerRef}
    >
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

      <main
        className="flex flex-col min-h-[100vh] container mx-auto px-4 pb-4 md:pb-6 space-y-4"
        role="main"
        aria-label="Train schedule planning interface"
        style={{
          overflowAnchor: "none",
          paddingTop: `calc(${maxHeaderHeight}px + var(--safe-area-top))`,
        }}
      >
        {/* Empty State - No stations selected */}
        {(!fromStation || !toStation) && <EmptyState />}

        {/* Service Alerts */}
        <ServiceAlert alerts={alerts} />

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
            selectedTripNumber={selectedTripNumber}
            onSelectTrip={setSelectedTrip}
          />
        )}
        {fromStation && toStation && filteredTrips.length === 0 && (
          <NoTripsFound />
        )}

        {/* Fare Section */}
        {fromStation && toStation && (
          <FareSection fromStation={fromStation} toStation={toStation} />
        )}

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
          realtimeStatus={devFixture.realtimeStatus}
          timeFormat="12h"
          isNextTrip={false}
          showFerry={false}
        />
      )}
    </div>
  );
}
