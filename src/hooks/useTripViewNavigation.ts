import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStationSelection } from "@/contexts/stationSelection";
import { isFocusedTrainToday } from "@/lib/focusedTrip";
import {
  getTodayScheduleType,
  tripServesLeg,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import { isSouthbound } from "@/lib/stationUtils";
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
 * Leave the My Trip view: back to wherever the user came from (the schedule,
 * or the line map they tapped "Take this train" on), or — when the view was
 * the first page loaded, so there's no in-app history to pop — replace it with
 * the schedule so the back stack doesn't hold a dead trip page.
 */
export function useLeaveTripView(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (hasInAppHistory()) {
      navigate(-1);
    } else {
      navigate({ pathname: "/", search: location.search }, { replace: true });
    }
  }, [navigate, location.search]);
}

/** Open the trip page for a train tapped on a map: My Trip when it's the
 *  rider's focused train, else a preview on their selected leg when the train
 *  serves it, else on the run the map shows. */
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
        tripServesLeg(trip.trip, fromStation, toStation, scheduleType, viaFerry)
      ) {
        setPreviewTrip({ tripNumber: trip.trip, from: fromPlace, to: toPlace, scheduleType });
      } else {
        setPreviewTrip({
          tripNumber: trip.trip,
          from: trip.fromStation,
          to: trip.toStation,
          scheduleType,
        });
      }
      openTripView();
    },
    [focusedTrip, fromPlace, toPlace, fromStation, toStation, viaFerry, setPreviewTrip, openTripView],
  );
}
