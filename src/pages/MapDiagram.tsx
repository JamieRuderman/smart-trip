import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Hand } from "lucide-react";

import stations from "@/data/stations";
import { useMapTrains, type MapTrain } from "@/hooks/useMapTrains";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useUserRiding } from "@/hooks/useUserRiding";
import { findFullCorridorTrip } from "@/lib/scheduleUtils";
import { stationIndexMap, getClosestStation } from "@/lib/stationUtils";
import { pickDisplayFromStation } from "@/lib/pickDisplayFromStation";
import { useStationSelection } from "@/contexts/stationSelection";
import { useAllRealtimeStatusMaps } from "@/hooks/useAllRealtimeStatusMaps";
import {
  SHEET_ENTER_DELAY_MS,
  SHEET_TRANSITION_MS,
} from "@/lib/animationConstants";
import { useTranslation } from "react-i18next";
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
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const backToSchedule = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate({ pathname: "/", search: location.search });
    }
  };

  const { trains } = useMapTrains();
  const { sb: sbStatusMaps, nb: nbStatusMaps } = useAllRealtimeStatusMaps();

  const {
    fromStation: fromSelection,
    toStation: toSelection,
    setFromStation,
    setToStation,
  } = useStationSelection();
  const fromStation =
    fromSelection && stationIndexMap[fromSelection] != null
      ? fromSelection
      : null;
  const toStation =
    toSelection && stationIndexMap[toSelection] != null ? toSelection : null;

  const {
    lat: userLat,
    lng: userLng,
    speedMps: userSpeedMps,
    heading: userHeading,
  } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
    autoRequestOnWeb: true,
  });
  const { ridingTrainKey } = useUserRiding({
    userLat,
    userLng,
    userSpeedMps,
    userHeading,
    trains,
  });
  // Look up the user's currently-ridden train so child sheets can highlight
  // the matching arrival row by trip number + direction.
  const ridingTrain = useMemo(
    () =>
      ridingTrainKey ? trains.find((t) => t.key === ridingTrainKey) ?? null : null,
    [trains, ridingTrainKey],
  );
  const ridingTripNumber = ridingTrain?.tripNumber ?? null;
  const ridingIsSouthbound =
    ridingTrain?.directionId == null ? null : ridingTrain.directionId === 0;
  const userStation = useMemo<Station | null>(() => {
    // While riding, the my-trip dot rides the train marker — suppress
    // the duplicate station-anchored dot so we don't show two blue dots.
    if (ridingTrainKey || userLat == null || userLng == null) return null;
    return getClosestStation(userLat, userLng);
  }, [userLat, userLng, ridingTrainKey]);

  // Stable Date that only advances on minute boundaries, so child sheets'
  // memos (arrivals/ETA) don't invalidate on every parent render.
  const nowSeconds = useNow(15_000);
  const nowMinute = Math.floor(nowSeconds / 60);
  const currentTime = useMemo(() => new Date(nowMinute * 60_000), [nowMinute]);

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
    <div className="relative w-full h-screen overflow-hidden bg-background flex flex-col">
      <header
        className="shrink-0 bg-smart-train-green px-3 pb-2 flex items-center gap-2"
        style={{ paddingTop: "calc(12px + var(--safe-area-top))" }}
      >
        <button
          type="button"
          onClick={backToSchedule}
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 text-white hover:bg-white/25"
          aria-label={t("mapDiagram.closeMap")}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5 text-xs text-white/90 flex-1 min-w-0">
          <Hand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("mapDiagram.tapHint")}</span>
        </div>
        <span className="text-xs font-semibold bg-white/15 text-white rounded-full px-2.5 py-1 whitespace-nowrap">
          {t("mapDiagram.trainsCount", { count: trains.length })}
        </span>
      </header>

      {/* Background tap clears the train selection; inner station/train
          clicks stopPropagation so they don't also clear it. */}
      <div
        className="flex-1 min-h-0 overflow-auto"
        onClick={() => setSelectedTrainKey(null)}
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
          userRidingTrainKey={ridingTrainKey}
          userLat={userLat}
          userLng={userLng}
          className="min-h-full"
        />
      </div>

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
          ridingTripNumber={ridingTripNumber}
          ridingIsSouthbound={ridingIsSouthbound}
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
          userFromStation={fromStation}
          userToStation={toStation}
        />
      )}
    </div>
  );
}
