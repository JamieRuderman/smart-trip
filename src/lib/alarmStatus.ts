export type AlarmPhase =
  | "CANCELED_OR_SKIPPED"
  | "ENDED"
  | "LEAVE"
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
  /** Minutes until the armed leave reminder fires (departure − lead), or null
   *  when no reminder is armed. While ≥ 0 the status leads with a "leave in"
   *  countdown — the first of the three stages (leave → departs → arrives). */
  minutesUntilLeave?: number | null;
  hasStarted: boolean;
  isCanceled: boolean;
  isCanceledOrSkipped: boolean;
  isEnded: boolean;
  hasFreshRealtime: boolean;
  /** A fresh live train position (GTFS-RT vehicle feed) is available. Like
   *  fresh realtime, it lets the en-route status show a live arrival countdown
   *  instead of the generic "On the way". */
  hasLivePosition?: boolean;
  forcePostDeparture?: boolean;
}

export interface AlarmStatusSelection {
  phase: AlarmPhase;
  kind: "message" | "leave-countdown" | "departure-countdown" | "arrival-countdown";
  translationKey?: string;
  translationValues?: Record<string, number | string>;
  tone?: "default" | "muted";
  minutesUntilLeave?: number;
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
  hasLivePosition: boolean,
): AlarmStatusSelection {
  if (minutesUntilArrival <= 0) {
    return {
      phase: "AT_DESTINATION",
      kind: "message",
      translationKey: "tracker.atDestination",
      tone: "muted",
    };
  }

  if (!hasFreshRealtime && !hasLivePosition) {
    return {
      phase: "EN_ROUTE_STALE",
      kind: "message",
      translationKey: "tracker.onTheWay",
      tone: "muted",
    };
  }

  if (minutesUntilArrival <= 1) {
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
    minutesUntilLeave = null,
    hasStarted,
    isCanceled,
    isCanceledOrSkipped,
    isEnded,
    hasFreshRealtime,
    hasLivePosition = false,
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
    return buildEnRouteSelection(minutesUntilArrival, hasFreshRealtime, hasLivePosition);
  }

  // Lead with the "leave in" countdown while the armed reminder is still ahead,
  // before the departure countdown — matching the home card + Live Activity.
  if (minutesUntilLeave != null && minutesUntilLeave >= 0) {
    return {
      phase: "LEAVE",
      kind: "leave-countdown",
      minutesUntilLeave,
    };
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
