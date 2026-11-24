import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStationSelection } from "@/contexts/stationSelection";
import { isFocusedTrainToday } from "@/lib/focusedTrip";
import {
  findFullCorridorTrip,
  getTodayScheduleType,
  tripServesLeg,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import { isSouthbound, stationIndexMap } from "@/lib/stationUtils";
import { pickDisplayFromStation } from "@/lib/pickDisplayFromStation";
import { SAN_FRANCISCO } from "@/lib/places";
import stations from "@/data/stations";
import type { MapTrain } from "@/hooks/useMapTrains";
import { hasInAppHistory, TRIP_VIEW_PATH } from "@/lib/tripView";

/** Open the full-page My Trip view, keeping the current query params (the
 *  selected leg) like the other in-app links. */
export function useOpenTripView(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    navigate({ pathname: TRIP_VIEW_PATH, search: location.search });
  }, [navigate, location.search]);
}

/**
 * Go back to wherever the user came from, or — when this page was the first
 * one loaded, so there's no in-app history to pop — replace it with
 * `fallbackPath` so the back stack doesn't hold a dead page.
 */
export function useGoBack(fallbackPath: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (hasInAppHistory()) {
      navigate(-1);
    } else {
      navigate({ pathname: fallbackPath, search: location.search }, { replace: true });
    }
  }, [navigate, location.search, fallbackPath]);
}

/** Leave the My Trip view, back to the schedule when there's nowhere to pop. */
export function useLeaveTripView(): () => void {
  return useGoBack("/");
}

/** Open the trip page for a train tapped on a map: My Trip when it's the
 *  rider's focused train, else a preview on their selected leg when the train
 *  serves it and hasn't reached its start yet, else on the run the map shows
 *  (from where the train is now). */
export function useOpenTrainPage(): (trip: ProcessedTrip) => void {
  const {
    fromPlace,
    toPlace,
    fromStation,
    toStation,
    viaFerry,
    focusedTrip,
    setPreviewTrip,
  } = useStationSelection();
  const openTripView = useOpenTripView();
  return useCallback(
    (trip: ProcessedTrip) => {
      const now = new Date();
      const scheduleType = getTodayScheduleType(now);
      const southbound = isSouthbound(trip.fromStation, trip.toStation);
      if (isFocusedTrainToday(focusedTrip, trip.trip, southbound, now)) {
        setPreviewTrip(null);
      } else if (
        fromPlace &&
        toPlace &&
        fromStation &&
        toStation &&
        tripServesLeg(trip.trip, fromStation, toStation, scheduleType, viaFerry) &&
        (southbound
          ? stationIndexMap[trip.fromStation] <= stationIndexMap[fromStation]
          : stationIndexMap[trip.fromStation] >= stationIndexMap[fromStation])
      ) {
        setPreviewTrip({ tripNumber: trip.trip, from: fromPlace, to: toPlace, scheduleType });
      } else {
        setPreviewTrip({
          tripNumber: trip.trip,
          from: trip.inboundFerry ? SAN_FRANCISCO : trip.fromStation,
          to: trip.outboundFerry ? SAN_FRANCISCO : trip.toStation,
          scheduleType,
        });
      }
      openTripView();
    },
    [focusedTrip, fromPlace, toPlace, fromStation, toStation, viaFerry, setPreviewTrip, openTripView],
  );
}

/** Open the trip page for a live train marker: its run from the station it
 *  last served to the end of the line. Does nothing for a marker that can't be
 *  matched to the timetable. */
export function useOpenMapTrain(): (train: MapTrain) => void {
  const openTrainPage = useOpenTrainPage();
  return useCallback(
    (train: MapTrain) => {
      if (train.tripNumber == null || train.directionId == null || train.startTime == null) {
        return;
      }
      const southbound = train.directionId === 0;
      const match = findFullCorridorTrip(train.directionId, train.startTime, train.tripNumber);
      if (!match) return;
      openTrainPage({
        ...match,
        fromStation: pickDisplayFromStation(train, southbound),
        toStation: southbound ? stations[stations.length - 1] : stations[0],
      });
    },
    [openTrainPage],
  );
}
