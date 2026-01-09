import { useRef } from "react";
import { useTrainScheduleState } from "@/hooks/useTrainScheduleState";
import { useScheduleData } from "@/hooks/useScheduleData";
import {
  HEADER_HEIGHTS,
  HEADER_MAX_HEIGHTS,
  useResponsiveHeaderHeights,
  useStickyHeaderCollapse,
} from "@/hooks/useHeaderHeights";
import { StickyHeader } from "./StickyHeader";
import { ServiceAlert } from "./ServiceAlert";
import { ScheduleResults } from "./ScheduleResults";
import { FareSection } from "./FareSection";
import BottomInfoBar from "./BottomInfoBar";
import { NoTripsFound } from "./NoTripsFound";
import { EmptyState } from "./EmptyState";

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
    showServiceAlert,
    filteredTrips,
    setFromStation,
    setToStation,
    setScheduleType,
    toggleShowAllTrips,
    toggleServiceAlert,
    swapStations,
  } = useTrainScheduleState(scheduleDataVersion);

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
      />

      <main
        className="container mx-auto px-4 pb-4 md:pb-6 space-y-4"
        role="main"
        aria-label="Train schedule planning interface"
        style={{
          overflowAnchor: "none",
          paddingTop: `calc(${maxHeaderHeight}px + 1rem)`,
        }}
      >
        {/* Service Alerts */}
        <ServiceAlert
          showServiceAlert={showServiceAlert}
          onToggleServiceAlert={toggleServiceAlert}
        />

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
          />
        )}
        {fromStation && toStation && filteredTrips.length === 0 && (
          <NoTripsFound />
        )}

        {/* Fare Section */}
        {fromStation && toStation && (
          <FareSection fromStation={fromStation} toStation={toStation} />
        )}

        {/* Theme Toggle and Service Alerts */}
        <BottomInfoBar />
      </main>
    </div>
  );
}
