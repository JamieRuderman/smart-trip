import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MapDiagramFrame } from "@/components/MapDiagramFrame";

import { useMapTrains, type MapTrain } from "@/hooks/useMapTrains";
import { useGeolocation } from "@/hooks/useGeolocation";
import { getClosestStation } from "@/lib/stationUtils";
import { placePath, validPlace, type Place } from "@/lib/places";
import { useStationSelection } from "@/contexts/stationSelection";
import { isFocusedTrainToday } from "@/lib/focusedTrip";
import { useOpenMapTrain } from "@/hooks/useTripViewNavigation";
import { ZoneKey } from "@/components/SmartLineDiagram/ZoneKey";
import { useNow } from "@/hooks/useNow";
import { SmartLineDiagram } from "@/components/SmartLineDiagram";
import type { Station } from "@/types/smartSchedule";


export default function MapDiagram() {
  const { trains } = useMapTrains();

  const {
    fromPlace: fromSelection,
    toPlace: toSelection,
    focusedTrip,
  } = useStationSelection();
  const navigate = useNavigate();
  const location = useLocation();
  const fromStation = validPlace(fromSelection);
  const toStation = validPlace(toSelection);

  const { lat: userLat, lng: userLng } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
    autoRequestOnWeb: true,
  });
  const userStation = useMemo<Station | null>(() => {
    if (userLat == null || userLng == null) return null;
    return getClosestStation(userLat, userLng);
  }, [userLat, userLng]);

  // Stable Date that only advances on minute boundaries, so child sheets'
  // memos (arrivals/ETA) don't invalidate on every parent render.
  const nowSeconds = useNow(15_000);
  const nowMinute = Math.floor(nowSeconds / 60);
  const currentTime = useMemo(() => new Date(nowMinute * 60_000), [nowMinute]);

  // The user's focused ("Go") trip reads as "my train" on the map — the same
  // blue treatment a focused trip gets in every card. Match the focused run to
  // its live marker by trip number + direction on today's service.
  const myTrainKey = useMemo<string | null>(() => {
    if (!focusedTrip) return null;
    const match = trains.find(
      (tr) =>
        tr.tripNumber != null &&
        tr.directionId != null &&
        isFocusedTrainToday(
          focusedTrip,
          tr.tripNumber,
          tr.directionId === 0,
          currentTime,
        ),
    );
    return match?.key ?? null;
  }, [focusedTrip, trains, currentTime]);

  // Fade the diagram into the (already-visible) frame on mount, so the page
  // reads as a deliberate load — green header + blank container first, then the
  // diagram eases in — rather than the whole thing popping in at once.
  const [diagramShown, setDiagramShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDiagramShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const [selectedTrainKey, setSelectedTrainKey] = useState<string | null>(null);
  const openMapTrain = useOpenMapTrain();

  const handleTrainClick = useCallback(
    (train: MapTrain) => {
      setSelectedTrainKey(train.key);
      openMapTrain(train);
    },
    [openMapTrain],
  );
  const handleStationClick = useCallback(
    (place: Place) => navigate({ pathname: placePath(place), search: location.search }),
    [navigate, location.search],
  );

  return (
    <MapDiagramFrame
        trainsCount={trains.length}
        onBackground={() => setSelectedTrainKey(null)}
        overlay={<ZoneKey />}
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
  );
}
