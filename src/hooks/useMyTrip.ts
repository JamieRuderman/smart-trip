import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTripProgress, type TripProgressResult } from "@/hooks/useTripProgress";
import {
  useTripDetailModel,
  type TripDetailModel,
} from "@/hooks/useTripDetailModel";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import {
  parseServiceDate,
  serviceDateWeekdayLabel,
  toLocalDateKey,
} from "@/lib/timeUtils";
import type { FocusedTrip } from "@/lib/focusedTrip";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

export interface MyTripState {
  /** The run is on a later calendar day than today (e.g. a weekend train
   *  picked on a weekday) — its live countdowns and position don't apply yet. */
  isFutureService: boolean;
  /** Localized weekday of a future-service run ("Saturday"), else null. */
  serviceDayLabel: string | null;
  /** The clock the trip is evaluated against: now, or the start of its service
   *  day for a future-service run. Pass it to anything driven by `progress`. */
  clockTime: Date;
  showFerry: boolean;
  progress: TripProgressResult;
  model: TripDetailModel;
  /** Solid background for "my trip" chrome: blue, running-late gold,
   *  cancelled red, or neutral once the trip has ended. White text on top. */
  accentBg: string;
}

/**
 * Everything the My Trip surfaces (the full-page view and the schedule page's
 * in-progress bar) derive from the focused trip, so both always agree. Takes
 * the trip already reconstructed + its live status from
 * {@link useFocusedTripLive}.
 */
export function useMyTripState({
  focusedTrip,
  trip,
  live,
  lastUpdated,
  currentTime,
}: {
  focusedTrip: FocusedTrip;
  trip: ProcessedTrip;
  live: TripRealtimeStatus | null;
  lastUpdated: Date | null;
  currentTime: Date;
}): MyTripState {
  const { i18n } = useTranslation();
  const isFutureService =
    focusedTrip.serviceDate !== toLocalDateKey(currentTime);
  const serviceDayLabel = isFutureService
    ? serviceDateWeekdayLabel(focusedTrip.serviceDate, i18n.language)
    : null;

  // A run on a later day hasn't started moving: evaluate it as of the start of
  // its service day, so every stop reads upcoming (rather than "past" by
  // today's clock) and the status never claims it already arrived.
  const clockTime = useMemo(
    () =>
      isFutureService ? parseServiceDate(focusedTrip.serviceDate) : currentTime,
    [isFutureService, focusedTrip.serviceDate, currentTime],
  );

  const showFerry =
    !!trip.outboundFerry &&
    focusedTrip.toStation === FERRY_CONSTANTS.FERRY_STATION;

  const progress = useTripProgress({
    trip,
    fromStation: focusedTrip.fromStation,
    toStation: focusedTrip.toStation,
    currentTime: clockTime,
    realtimeStatus: live,
    isNextTrip: false,
    isFocused: true,
    // The vehicle feed only carries today's runs — never pin a future-service
    // trip to today's same-numbered train.
    vehiclePositionOverride: isFutureService ? null : undefined,
  });

  const model = useTripDetailModel({
    trip,
    fromStation: focusedTrip.fromStation,
    toStation: focusedTrip.toStation,
    currentTime: clockTime,
    lastUpdated,
    realtimeStatus: live,
    showFerry,
    progress,
    isFocused: true,
  });

  const accentBg = progress.isEnded
    ? "bg-smart-neutral"
    : model.isCanceledOrSkipped
      ? "bg-destructive"
      : model.isDelayed
        ? "bg-smart-gold"
        : "bg-my-trip-background";

  return {
    isFutureService,
    serviceDayLabel,
    clockTime,
    showFerry,
    progress,
    model,
    accentBg,
  };
}
