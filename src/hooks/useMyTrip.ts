import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTripProgress, type TripProgressResult } from "@/hooks/useTripProgress";
import {
  useTripDetailModel,
  type TripDetailModel,
} from "@/hooks/useTripDetailModel";
import { isFocusedTripToday, type FocusedTrip } from "@/lib/focusedTrip";
import {
  agencyDateKey,
  parseServiceDate,
  serviceDateWeekdayLabel,
} from "@/lib/timeUtils";
import { stateBg } from "@/lib/tripTheme";
import { TOKEN, TRAIN_COLORS } from "@/components/SmartLineDiagram/tokens";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

type Accent = "past" | "canceled" | "delayed" | "onTrip" | "preview";

/** Each accent as a solid color, for drawing — the train marker takes the line
 *  map's my-trip blue and running-late gold, so the two stay in step. */
const ACCENT_COLOR: Record<Accent, string> = {
  past: "hsl(var(--muted-foreground))",
  canceled: "hsl(var(--destructive))",
  delayed: TRAIN_COLORS.delayed,
  onTrip: TOKEN.myTrip,
  preview: "hsl(var(--smart-train-green))",
};

/** Each accent as a solid background for the white-on-colour chrome. */
const ACCENT_BG: Record<Accent, string> = {
  past: stateBg.past,
  canceled: stateBg.canceled,
  delayed: stateBg.delayed,
  onTrip: "bg-my-trip-background",
  preview: stateBg.ontime,
};

export interface MyTripInput {
  focusedTrip: FocusedTrip;
  /** The focused trip reconstructed from the schedule. */
  trip: ProcessedTrip;
  /** Its realtime status (null for a run on a later day). */
  live: TripRealtimeStatus | null;
  lastUpdated: Date | null;
  currentTime: Date;
  /** A shared trip's real arrival (epoch ms), read against `realtimeClock`:
   *  decides whether it has ended, and how long ago, across days. */
  itineraryArrivalAt?: number;
  /** The actual time, when `currentTime` only carries Pacific clock fields. */
  realtimeClock?: Date;
  /** A train the rider is looking at but hasn't taken: `focusedTrip` is built
   *  from the previewed train and never stored. */
  isPreview?: boolean;
}

export interface MyTripState {
  focusedTrip: FocusedTrip;
  isPreview: boolean;
  trip: ProcessedTrip;
  live: TripRealtimeStatus | null;
  /** The run is on a later calendar day than today (e.g. a weekend train
   *  picked on a weekday) — its live countdowns and position don't apply yet. */
  isFutureService: boolean;
  /** A shared run on an earlier day: no live position applies to it. */
  isPastService: boolean;
  /** Localized weekday of a future-service run ("Saturday"), else null. */
  serviceDayLabel: string | null;
  /** The clock the trip is evaluated against: now, or the start of its service
   *  day for a future-service run. Pass it to anything driven by `progress`. */
  clockTime: Date;
  progress: TripProgressResult;
  model: TripDetailModel;
  /** Solid background for "my trip" chrome: blue, running-late gold,
   *  cancelled red, or neutral once the trip has ended. White text on top. */
  accentBg: string;
  /** The accent as a CSS color for drawing on the card surface (the position
   *  card's train). Same states as `accentBg`, but in the drawing shades: the
   *  line map's lighter my-trip blue, and the theme's muted gray once ended. */
  accentColor: string;
}

/**
 * Everything the My Trip surfaces (the full-page view and the schedule page's
 * in-progress bar) derive from the focused trip, so both always agree. Takes
 * the trip already reconstructed + its live status from
 * {@link useFocusedTripLive} — see {@link MyTripGate}, which does both.
 */
export function useMyTripState({
  focusedTrip,
  trip,
  live,
  lastUpdated,
  currentTime,
  isPreview = false,
  itineraryArrivalAt,
  realtimeClock,
}: MyTripInput): MyTripState {
  const { i18n } = useTranslation();
  const isFutureService = !isFocusedTripToday(focusedTrip, currentTime);
  const isPastService =
    realtimeClock != null && focusedTrip.serviceDate < agencyDateKey(realtimeClock);
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

  const itineraryMinutesUntilArrival =
    itineraryArrivalAt != null && realtimeClock
      ? Math.ceil((itineraryArrivalAt - realtimeClock.getTime()) / 60_000)
      : undefined;

  const progress = useTripProgress({
    trip,
    fromStation: focusedTrip.fromStation,
    toStation: focusedTrip.toStation,
    currentTime: clockTime,
    realtimeStatus: live,
    isNextTrip: false,
    isFocused: !isPreview,
    trackVehicle: !isFutureService && !isPastService,
    minutesAfterArrival:
      itineraryMinutesUntilArrival == null ? undefined : -itineraryMinutesUntilArrival,
  });

  const model = useTripDetailModel({
    trip,
    fromStation: focusedTrip.fromStation,
    toStation: focusedTrip.toStation,
    currentTime: clockTime,
    realtimeClock,
    itineraryMinutesUntilArrival,
    lastUpdated,
    realtimeStatus: live,
    progress,
    isFocused: !isPreview,
  });

  const accent: Accent = progress.isEnded
    ? "past"
    : model.isCanceledOrSkipped
      ? "canceled"
      : model.isDelayed
        ? "delayed"
        : isPreview
          ? "preview"
          : "onTrip";
  const accentBg = ACCENT_BG[accent];

  return {
    focusedTrip,
    isPreview,
    trip,
    live,
    isFutureService,
    isPastService,
    serviceDayLabel,
    clockTime,
    progress,
    model,
    accentBg,
    accentColor: ACCENT_COLOR[accent],
  };
}
