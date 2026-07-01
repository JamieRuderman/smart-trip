import { useEffect, useMemo, useRef } from "react";
import {
  selectAlarmStatus,
  type AlarmStatusSelection,
} from "@/lib/alarmStatus";

const REALTIME_FRESH_MS = 120 * 1000;

interface UseAlarmStatusParams {
  tripId: number;
  minutesUntilDeparture: number;
  minutesUntilArrival: number;
  minutesAfterArrival: number;
  /** Minutes until the armed leave reminder fires, or null when none is armed. */
  minutesUntilLeave?: number | null;
  hasStarted: boolean;
  isCanceled: boolean;
  isCanceledOrSkipped: boolean;
  isEnded: boolean;
  hasRealtimeStopData: boolean;
  hasLiveDepartureTime: boolean;
  /** A fresh live train position is available (GTFS-RT vehicle feed). */
  hasLivePosition?: boolean;
  /** The live vehicle shows the train hasn't reached the destination yet —
   *  vetoes "At destination" when only the schedule clock says otherwise. */
  stillApproachingDestination?: boolean;
  lastUpdated: Date | null;
  currentTime: Date;
}

export function useAlarmStatus(
  params: UseAlarmStatusParams,
): AlarmStatusSelection {
  const stickyPostDepartureRef = useRef(false);

  const {
    tripId,
    minutesUntilDeparture,
    minutesUntilArrival,
    minutesAfterArrival,
    minutesUntilLeave = null,
    hasStarted,
    isCanceled,
    isCanceledOrSkipped,
    isEnded,
    hasRealtimeStopData,
    hasLiveDepartureTime,
    hasLivePosition = false,
    stillApproachingDestination = false,
    lastUpdated,
    currentTime,
  } = params;

  useEffect(() => {
    stickyPostDepartureRef.current = false;
  }, [tripId]);

  const hasFreshRealtime =
    hasRealtimeStopData &&
    lastUpdated != null &&
    currentTime.getTime() - lastUpdated.getTime() <= REALTIME_FRESH_MS;

  const shouldReleaseStickyPostDeparture =
    stickyPostDepartureRef.current &&
    hasFreshRealtime &&
    hasLiveDepartureTime &&
    minutesUntilDeparture > 3;

  const shouldForcePostDeparture =
    stickyPostDepartureRef.current && !shouldReleaseStickyPostDeparture;

  const selection = useMemo(
    () =>
      selectAlarmStatus({
        minutesUntilDeparture,
        minutesUntilArrival,
        minutesAfterArrival,
        minutesUntilLeave,
        hasStarted,
        isCanceled,
        isCanceledOrSkipped,
        isEnded,
        hasFreshRealtime,
        hasLivePosition,
        stillApproachingDestination,
        forcePostDeparture: shouldForcePostDeparture,
      }),
    [
      minutesUntilDeparture,
      minutesUntilArrival,
      minutesAfterArrival,
      minutesUntilLeave,
      hasStarted,
      isCanceled,
      isCanceledOrSkipped,
      isEnded,
      hasFreshRealtime,
      shouldForcePostDeparture,
      hasLivePosition,
      stillApproachingDestination,
    ],
  );

  useEffect(() => {
    if (shouldReleaseStickyPostDeparture) {
      stickyPostDepartureRef.current = false;
      return;
    }

    if (
      minutesUntilDeparture <= -2 &&
      selection.phase !== "CANCELED_OR_SKIPPED" &&
      selection.phase !== "ENDED"
    ) {
      stickyPostDepartureRef.current = true;
    }
  }, [minutesUntilDeparture, selection.phase, shouldReleaseStickyPostDeparture]);

  return selection;
}
