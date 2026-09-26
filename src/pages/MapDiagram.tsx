import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { MapDiagramFrame } from "@/components/MapDiagramFrame";

import stations from "@/data/stations";
import { useMapTrains, type MapTrain } from "@/hooks/useMapTrains";
import { useGeolocation } from "@/hooks/useGeolocation";
import { findFullCorridorTrip, getTodayScheduleType } from "@/lib/scheduleUtils";
import { stationIndexMap, getClosestStation, isSouthbound } from "@/lib/stationUtils";
import { pickDisplayFromStation } from "@/lib/pickDisplayFromStation";
import { useStationSelection } from "@/contexts/stationSelection";
import { focusedTripMatchesSchedule } from "@/lib/focusedTrip";
import { useAllRealtimeStatusMaps } from "@/hooks/useAllRealtimeStatusMaps";
import {
  SHEET_ENTER_DELAY_MS,
  SHEET_TRANSITION_MS,
} from "@/lib/animationConstants";
import { useNow } from "@/hooks/useNow";
import { TripDetailSheet } from "@/components/TripDetailSheet";
import { SmartLineDiagram } from "@/components/SmartLineDiagram";
import { StationInfoSheet } from "@/components/StationInfoSheet";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { Station } from "@/types/smartSchedule";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];

export default function MapDiagram() {
  const { trains } = useMapTrains();
  const { sb: sbStatusMaps, nb: nbStatusMaps } = useAllRealtimeStatusMaps();

  const {
    fromStation: fromSelection,
    toStation: toSelection,
    setFromStation,
    setToStation,
    focusedTrip,
  } = useStationSelection();
  const fromStation =
    fromSelection && stationIndexMap[fromSelection] != null
      ? fromSelection
      : null;
  const toStation =
    toSelection && stationIndexMap[toSelection] != null ? toSelection : null;

  const { lat: userLat, lng: userLng } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
    autoRequestOnWeb: true,
  });
  const userStation = useMemo<Station | null>(() => {
    if (userLat == null || userLng == null) return null;
    return getClosestStation(userLat, userLng);
  }, [userLat, userLng]);

  // The user's focused ("Go") trip reads as "my train" on the map — the same
  // blue treatment a focused trip gets in every card. Match the focused run to
  // its live marker by trip number + direction on today's schedule.
  const myTrainKey = useMemo<string | null>(() => {
    if (!focusedTrip) return null;
    const sb = isSouthbound(focusedTrip.fromStation, focusedTrip.toStation);
    if (!focusedTripMatchesSchedule(focusedTrip, sb, getTodayScheduleType())) {
      return null;
    }
    const dir = sb ? 0 : 1;
    const match = trains.find(
      (tr) => tr.tripNumber === focusedTrip.tripNumber && tr.directionId === dir,
    );
    return match?.key ?? null;
  }, [focusedTrip, trains]);

  // Stable Date that only advances on minute boundaries, so child sheets'
  // memos (arrivals/ETA) don't invalidate on every parent render.
  const nowSeconds = useNow(15_000);
  const nowMinute = Math.floor(nowSeconds / 60);
  const currentTime = useMemo(() => new Date(nowMinute * 60_000), [nowMinute]);

  // Fade the diagram into the (already-visible) frame on mount, so the page
  // reads as a deliberate load — green header + blank container first, then the
  // diagram eases in — rather than the whole thing popping in at once.
  const [diagramShown, setDiagramShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDiagramShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const [selectedTrainKey, setSelectedTrainKey] = useState<string | null>(null);
  const [stationSheet, setStationSheet] = useState<Station | null>(null);
  const [stationSheetOpen, setStationSheetOpen] = useState(false);
  const [detailTrip, setDetailTrip] = useState<{
    trip: ProcessedTrip;
    fromStation: Station;
    toStation: Station;
    realtimeStatus: TripRealtimeStatus | null;
  } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const handleTrainClick = useCallback((train: MapTrain) => {
    setSelectedTrainKey(train.key);

    if (
      train.tripNumber == null ||
      train.directionId == null ||
      train.startTime == null
    ) {
      return;
    }

    const isSouthbound = train.directionId === 0;
    const terminus = isSouthbound ? LARKSPUR : WINDSOR;
    const match = findFullCorridorTrip(
      train.directionId,
      train.startTime,
      train.tripNumber,
    );
    if (!match) return;

    const displayFrom = pickDisplayFromStation(train, isSouthbound);
    const displayTrip: ProcessedTrip = {
      ...match,
      fromStation: displayFrom,
      toStation: terminus,
    };
    // Pull live delay/cancellation state for this run. The status map is
    // keyed by scheduled departure at the full-corridor origin, which is
    // exactly match.departureTime here.
    const statusMaps = isSouthbound ? sbStatusMaps : nbStatusMaps;
    const realtimeStatus =
      statusMaps.statusMap.get(match.departureTime) ?? null;
    setDetailTrip({
      trip: displayTrip,
      fromStation: displayFrom,
      toStation: terminus,
      realtimeStatus,
    });
  }, [sbStatusMaps, nbStatusMaps]);

  useEffect(() => {
    if (detailTrip) {
      const id = window.setTimeout(
        () => setDetailOpen(true),
        SHEET_ENTER_DELAY_MS,
      );
      return () => window.clearTimeout(id);
    } else {
      setDetailOpen(false);
    }
  }, [detailTrip]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setTimeout(() => {
      setDetailTrip(null);
      setSelectedTrainKey(null);
    }, SHEET_TRANSITION_MS);
  }, []);

  const handleStationClick = useCallback((station: Station) => {
    setStationSheet(station);
  }, []);

  useEffect(() => {
    if (stationSheet) {
      const id = window.setTimeout(
        () => setStationSheetOpen(true),
        SHEET_ENTER_DELAY_MS,
      );
      return () => window.clearTimeout(id);
    } else {
      setStationSheetOpen(false);
    }
  }, [stationSheet]);

  const closeStationSheet = useCallback(() => {
    setStationSheetOpen(false);
    setTimeout(() => setStationSheet(null), SHEET_TRANSITION_MS);
  }, []);

  // Tap an arrival row in the station sheet → close the station sheet and
  // open the trip detail sheet for that train, with the tapped station as
  // the displayed origin so only the upcoming portion of the trip shows.
  const handleArrivalClick = useCallback(
    (trip: ProcessedTrip, fromStation: Station, toStation: Station) => {
      closeStationSheet();
      // Direction is determined by the terminus passed in: southbound trips
      // arrive at Larkspur, northbound at Windsor. The status map is keyed
      // by departure at the full-corridor origin (trip.departureTime).
      const isSouthbound = toStation === LARKSPUR;
      const statusMaps = isSouthbound ? sbStatusMaps : nbStatusMaps;
      const realtimeStatus =
        statusMaps.statusMap.get(trip.departureTime) ?? null;
      setDetailTrip({
        trip: { ...trip, fromStation, toStation },
        fromStation,
        toStation,
        realtimeStatus,
      });
    },
    [closeStationSheet, sbStatusMaps, nbStatusMaps],
  );

  // The context setters already drop the other endpoint when the new one
  // collides — see StationSelectionContext.
  const handleSetFrom = useCallback(
    (s: Station) => {
      setFromStation(s);
      closeStationSheet();
    },
    [setFromStation, closeStationSheet],
  );

  const handleSetTo = useCallback(
    (s: Station) => {
      setToStation(s);
      closeStationSheet();
    },
    [setToStation, closeStationSheet],
  );

  const handleClearFrom = useCallback(() => {
    setFromStation("");
    closeStationSheet();
  }, [setFromStation, closeStationSheet]);

  const handleClearTo = useCallback(() => {
    setToStation("");
    closeStationSheet();
  }, [setToStation, closeStationSheet]);

  return (
    <>
      <MapDiagramFrame
        trainsCount={trains.length}
        onBackground={() => setSelectedTrainKey(null)}
      >
        {/* h-full (not min-h-full): SmartLineDiagram's root and SVG are
            height:100%, which only resolves against a parent with a DEFINITE
            height. A min-height-only wrapper leaves height auto, so the SVG
            collapses to its tall intrinsic aspect ratio and renders oversized
            with no fit-to-screen. The scroll container has a definite height,
            so h-full here restores the correct fit. */}
        <div
          className={cn(
            "h-full transition-opacity duration-500 ease-out motion-reduce:transition-none",
            diagramShown ? "opacity-100" : "opacity-0",
          )}
        >
          <SmartLineDiagram
            trains={trains}
            selectedTrainKey={selectedTrainKey}
            onTrainClick={handleTrainClick}
            onStationClick={handleStationClick}
            colorTrackByZone
            fromStation={fromStation}
            toStation={toStation}
            userStation={userStation}
            myTrainKey={myTrainKey}
            className="min-h-full"
          />
        </div>
      </MapDiagramFrame>

      {stationSheet && (
        <StationInfoSheet
          isOpen={stationSheetOpen}
          onClose={closeStationSheet}
          station={stationSheet}
          currentTime={currentTime}
          fromStation={fromStation}
          toStation={toStation}
          onSetFrom={handleSetFrom}
          onSetTo={handleSetTo}
          onClearFrom={handleClearFrom}
          onClearTo={handleClearTo}
          onArrivalClick={handleArrivalClick}
        />
      )}

      {detailTrip && (
        <TripDetailSheet
          isOpen={detailOpen}
          onClose={closeDetail}
          trip={detailTrip.trip}
          fromStation={detailTrip.fromStation}
          toStation={detailTrip.toStation}
          currentTime={currentTime}
          lastUpdated={sbStatusMaps.lastUpdated ?? nbStatusMaps.lastUpdated}
          realtimeStatus={detailTrip.realtimeStatus}
          timeFormat="12h"
          isNextTrip={true}
          showFerry={false}
          isFocused={focusedTripMatchesSchedule(
            focusedTrip,
            detailTrip.toStation === LARKSPUR,
            getTodayScheduleType(),
          ) && focusedTrip.tripNumber === detailTrip.trip.trip}
          scheduleType={getTodayScheduleType()}
          userFromStation={fromStation}
          userToStation={toStation}
        />
      )}
    </>
  );
}
