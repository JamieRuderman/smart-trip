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
  hasStarted: boolean;
  isCanceled: boolean;
  isCanceledOrSkipped: boolean;
  isEnded: boolean;
  hasRealtimeStopData: boolean;
  hasLiveDepartureTime: boolean;
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
    hasStarted,
    isCanceled,
    isCanceledOrSkipped,
    isEnded,
    hasRealtimeStopData,
    hasLiveDepartureTime,
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
        hasStarted,
        isCanceled,
        isCanceledOrSkipped,
        isEnded,
        hasFreshRealtime,
        forcePostDeparture: shouldForcePostDeparture,
      }),
    [
      minutesUntilDeparture,
      minutesUntilArrival,
      minutesAfterArrival,
      hasStarted,
      isCanceled,
      isCanceledOrSkipped,
      isEnded,
      hasFreshRealtime,
      shouldForcePostDeparture,
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
