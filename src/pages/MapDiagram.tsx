import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Hand } from "lucide-react";

import stations from "@/data/stations";
import { useMapTrains, type MapTrain } from "@/hooks/useMapTrains";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useUserRiding } from "@/hooks/useUserRiding";
import { findFullCorridorTrip } from "@/lib/scheduleUtils";
import { stationIndexMap, getClosestStation } from "@/lib/stationUtils";
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

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];

/**
 * Pick the timeline's "from" station for a tapped train so only upcoming
 * stops appear (plus one previous stop for the current-station highlight).
 */
function pickDisplayFromStation(
  train: MapTrain,
  isSouthbound: boolean,
): Station {
  const origin = isSouthbound ? WINDSOR : LARKSPUR;
  let anchorStation: Station | null = train.nextStation;
  let treatAsServed = train.currentStatus === "STOPPED_AT";
  if (anchorStation == null) {
    anchorStation = getClosestStation(train.latitude, train.longitude);
    treatAsServed = true;
  }
  const anchorIdx = stationIndexMap[anchorStation];
  if (anchorIdx == null) return origin;

  const upcomingIdx = treatAsServed
    ? isSouthbound
      ? anchorIdx + 1
      : anchorIdx - 1
    : anchorIdx;
  const displayFromIdx = isSouthbound ? upcomingIdx - 1 : upcomingIdx + 1;
  if (displayFromIdx >= 0 && displayFromIdx < stations.length) {
    return stations[displayFromIdx];
  }
  if (upcomingIdx >= 0 && upcomingIdx < stations.length) {
    return stations[upcomingIdx];
  }
  return anchorStation;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const fromParam = searchParams.get("from") as Station | null;
  const toParam = searchParams.get("to") as Station | null;
  const fromStation =
    fromParam && stationIndexMap[fromParam] != null ? fromParam : null;
  const toStation =
    toParam && stationIndexMap[toParam] != null ? toParam : null;

  const {
    lat: userLat,
    lng: userLng,
    speedMps: userSpeedMps,
  } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
    autoRequestOnWeb: true,
  });
  const { ridingTrainKey } = useUserRiding({
    userLat,
    userLng,
    userSpeedMps,
    trains,
  });
  const userStation = useMemo<Station | null>(() => {
    // While riding, the user-location dot rides the train marker — suppress
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
    setDetailTrip({ trip: displayTrip, fromStation: displayFrom, toStation: terminus });
  }, []);

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

  // Picking the same station for both endpoints would produce an empty trip;
  // when the new endpoint collides with the other one, drop the other. This
  // makes the "swap origin & destination" gesture a one-tap flow.
  const handleSetFrom = useCallback(
    (s: Station) => {
      const params = new URLSearchParams(searchParams);
      params.set("from", s);
      if (params.get("to") === s) params.delete("to");
      setSearchParams(params, { replace: true });
      closeStationSheet();
    },
    [searchParams, setSearchParams, closeStationSheet],
  );

  const handleSetTo = useCallback(
    (s: Station) => {
      const params = new URLSearchParams(searchParams);
      params.set("to", s);
      if (params.get("from") === s) params.delete("from");
      setSearchParams(params, { replace: true });
      closeStationSheet();
    },
    [searchParams, setSearchParams, closeStationSheet],
  );

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
          lastUpdated={null}
          realtimeStatus={null}
          timeFormat="12h"
          isNextTrip={true}
          showFerry={false}
        />
      )}
    </div>
  );
}
