export type AlarmPhase =
  | "CANCELED_OR_SKIPPED"
  | "ENDED"
  | "PRE_DEPARTURE"
  | "BOARDING_WINDOW"
  | "EN_ROUTE_FRESH"
  | "EN_ROUTE_STALE"
  | "APPROACHING_DESTINATION"
  | "AT_DESTINATION";

export interface AlarmStatusInput {
  minutesUntilDeparture: number;
  minutesUntilArrival: number;
  minutesAfterArrival: number;
  hasStarted: boolean;
  isCanceled: boolean;
  isCanceledOrSkipped: boolean;
  isEnded: boolean;
  hasFreshRealtime: boolean;
  forcePostDeparture?: boolean;
}

export interface AlarmStatusSelection {
  phase: AlarmPhase;
  kind: "message" | "departure-countdown" | "arrival-countdown";
  translationKey?: string;
  translationValues?: Record<string, number | string>;
  tone?: "default" | "muted";
  minutesUntilDeparture?: number;
  minutesUntilArrival?: number;
}

function buildEndedLabel(minutesAfterArrival: number): AlarmStatusSelection {
  if (minutesAfterArrival >= 60) {
    return {
      phase: "ENDED",
      kind: "message",
      translationKey: "tracker.endedHoursMinutesAgo",
      translationValues: {
        hours: Math.floor(minutesAfterArrival / 60),
        minutes: minutesAfterArrival % 60,
      },
      tone: "muted",
    };
  }

  return {
    phase: "ENDED",
    kind: "message",
    translationKey: "tracker.endedMinutesAgo",
    translationValues: { minutes: minutesAfterArrival },
    tone: "muted",
  };
}

function buildEnRouteSelection(
  minutesUntilArrival: number,
  hasFreshRealtime: boolean,
): AlarmStatusSelection {
  if (minutesUntilArrival <= 0) {
    return {
      phase: "AT_DESTINATION",
      kind: "message",
      translationKey: "tracker.atDestination",
      tone: "muted",
    };
  }

  if (!hasFreshRealtime) {
    return {
      phase: "EN_ROUTE_STALE",
      kind: "message",
      translationKey: "tracker.onTheWay",
      tone: "muted",
    };
  }

  if (minutesUntilArrival <= 3) {
    return {
      phase: "APPROACHING_DESTINATION",
      kind: "message",
      translationKey: "tracker.arrivingSoon",
    };
  }

  return {
    phase: "EN_ROUTE_FRESH",
    kind: "arrival-countdown",
    minutesUntilArrival,
  };
}

export function selectAlarmStatus(
  input: AlarmStatusInput,
): AlarmStatusSelection {
  const {
    minutesUntilDeparture,
    minutesUntilArrival,
    minutesAfterArrival,
    hasStarted,
    isCanceled,
    isCanceledOrSkipped,
    isEnded,
    hasFreshRealtime,
    forcePostDeparture = false,
  } = input;

  if (isCanceledOrSkipped) {
    return {
      phase: "CANCELED_OR_SKIPPED",
      kind: "message",
      translationKey: isCanceled ? "tracker.tripCanceled" : "tripCard.stopSkipped",
      tone: "muted",
    };
  }

  if (isEnded) {
    return buildEndedLabel(minutesAfterArrival);
  }

  if (minutesUntilArrival <= 0) {
    return {
      phase: "AT_DESTINATION",
      kind: "message",
      translationKey: "tracker.atDestination",
      tone: "muted",
    };
  }

  const isPostDeparture =
    forcePostDeparture || hasStarted || minutesUntilDeparture < -2;

  if (isPostDeparture) {
    return buildEnRouteSelection(minutesUntilArrival, hasFreshRealtime);
  }

  if (minutesUntilDeparture <= 2) {
    return {
      phase: "BOARDING_WINDOW",
      kind: "message",
      translationKey: "tracker.leavingSoon",
    };
  }

  return {
    phase: "PRE_DEPARTURE",
    kind: "departure-countdown",
    minutesUntilDeparture,
  };
}
