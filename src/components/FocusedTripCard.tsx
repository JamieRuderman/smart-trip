import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Navigation, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { reconstructFocusedTrip, type FocusedTrip } from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { useTripStatus } from "@/hooks/useTripStatus";
import { useCountdown } from "@/hooks/useCountdown";
import { isSouthbound } from "@/lib/stationUtils";
import {
  SHEET_ENTER_DELAY_MS,
  SHEET_TRANSITION_MS,
} from "@/lib/animationConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { SectionCard } from "@/components/ui/section-card";
import { CardContent } from "@/components/ui/card";
import { TimePair } from "./TimePair";
import { CountdownLabel } from "./CountdownLabel";
import { DepartureReminder } from "./DepartureReminder";
import { TripDetailSheet } from "./TripDetailSheet";

interface FocusedTripCardProps {
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

/**
 * Pinned representation of the user's focused trip ("Go"), shown above the
 * schedule. Always rendered the same way regardless of the home screen's
 * current from/to — reconstructed from static schedule, with live realtime
 * status overlaid. Returns null when nothing is focused or the trip can no
 * longer be found in the schedule.
 *
 * The card leads with a solid-blue header band (matching the trip-detail
 * sheet header) carrying the train identity and live times, then surfaces the
 * departure countdown and the reminder-management controls inline — so "My
 * Trip" answers "how long until I need to leave?" without opening the sheet.
 *
 * When the focus is cleared (Stop) while this card's detail sheet is open, the
 * card stays mounted for one transition so the sheet animates closed instead
 * of vanishing instantly.
 */
export function FocusedTripCard({ currentTime, timeFormat }: FocusedTripCardProps) {
  const { focusedTrip } = useStationSelection();

  const [detailOpen, setDetailOpenState] = useState(false);
  const detailOpenRef = useRef(false);
  const setDetailOpen = useCallback((open: boolean) => {
    detailOpenRef.current = open;
    setDetailOpenState(open);
  }, []);

  const [closing, setClosing] = useState(false);
  const lastFocusedRef = useRef<FocusedTrip | null>(focusedTrip);

  useEffect(() => {
    if (focusedTrip) {
      lastFocusedRef.current = focusedTrip;
      setClosing(false);
      return;
    }
    // Focus just cleared. If a detail sheet is open, keep the card mounted and
    // animate the sheet closed before dropping; otherwise unmount immediately.
    if (!detailOpenRef.current) return;
    setDetailOpen(false);
    setClosing(true);
    const id = window.setTimeout(() => setClosing(false), SHEET_TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [focusedTrip, setDetailOpen]);

  const effective = focusedTrip ?? (closing ? lastFocusedRef.current : null);
  const trip = useMemo(
    () => (effective ? reconstructFocusedTrip(effective) : null),
    [effective],
  );

  if (!effective || !trip) return null;
  return (
    <FocusedTripCardInner
      focusedTrip={effective}
      trip={trip}
      currentTime={currentTime}
      timeFormat={timeFormat}
      detailOpen={detailOpen}
      setDetailOpen={setDetailOpen}
    />
  );
}

function FocusedTripCardInner({
  focusedTrip,
  trip,
  currentTime,
  timeFormat,
  detailOpen,
  setDetailOpen,
}: {
  focusedTrip: FocusedTrip;
  trip: ProcessedTrip;
  currentTime: Date;
  timeFormat: "12h" | "24h";
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const trips = useMemo(() => [trip], [trip]);
  const { statusMap, canceledByStartTime, lastUpdated } = useTripRealtimeStatusMap(
    focusedTrip.fromStation,
    focusedTrip.toStation,
    trips,
  );

  const realtimeStatus = useMemo(() => {
    const primary = statusMap.get(trip.departureTime);
    if (primary) return primary;
    if (canceledByStartTime.size > 0) {
      for (const time of trip.times) {
        const secondary = canceledByStartTime.get(time);
        if (secondary) return secondary;
      }
    }
    return null;
  }, [statusMap, canceledByStartTime, trip]);

  const { isCanceledOrSkipped, isDelayed, statusLabel } =
    useTripStatus(realtimeStatus);

  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  const directionLabel = isSouthbound(
    focusedTrip.fromStation,
    focusedTrip.toStation,
  )
    ? t("tracker.southbound")
    : t("tracker.northbound");
  const statusText = statusLabel ?? t("tracker.scheduled");

  const minutesUntil = useCountdown(
    trip.departureTime,
    realtimeStatus?.liveDepartureTime ?? undefined,
    currentTime,
  );
  // Once the train has departed the "leave now" countdown is moot — let the
  // reminder/Stop controls and the full sheet carry the en-route story.
  const showCountdown = !isCanceledOrSkipped && minutesUntil >= 0;

  // ── Detail-sheet mount + open/close animation (mirrors TripCard) ───────────
  const [sheetMounted, setSheetMounted] = useState(detailOpen);
  const [sheetOpen, setSheetOpen] = useState(detailOpen);
  const isFirstRender = useRef(true);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    if (detailOpen) {
      // Mount closed first, then flip open so the browser paints the initial
      // state and the slide-up transition plays.
      setSheetOpen(false);
      setSheetMounted(true);
      openTimerRef.current = window.setTimeout(() => {
        setSheetOpen(true);
        openTimerRef.current = null;
      }, SHEET_ENTER_DELAY_MS);
    } else {
      setSheetOpen(false);
      closeTimerRef.current = window.setTimeout(() => {
        setSheetMounted(false);
        closeTimerRef.current = null;
      }, SHEET_TRANSITION_MS);
    }
  }, [detailOpen]);

  useEffect(
    () => () => {
      if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  return (
    <SectionCard
      aria-label={t("focusedTrip.pinnedLabel")}
      className="overflow-hidden border-my-trip/40 p-0"
    >
      {/* Solid-blue header band — tap to open the full trip-detail sheet. */}
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        aria-label={t("focusedTrip.viewDetails")}
        className="w-full text-left bg-my-trip text-white transition-colors hover:bg-my-trip/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset"
      >
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          {/* Train number — w-[5rem] gutter matches the body rows below. */}
          <div className="flex flex-col items-end shrink-0 w-[5rem] pr-3">
            <span className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-white/80 mb-0.5">
              <Navigation className="h-3 w-3" aria-hidden="true" />
              {t("focusedTrip.myTrip")}
            </span>
            <span className="text-4xl font-semibold leading-none">
              {trip.trip}
            </span>
          </div>

          {/* Status + direction + times */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white/80 mb-0.5 truncate">
              {statusText}
              <span className="text-white/60"> · </span>
              {directionLabel}
            </p>
            <TimePair
              departure={departureTime}
              arrival={arrivalTime}
              format={timeFormat}
              strikethrough={isCanceledOrSkipped}
              className="text-2xl font-semibold"
            />
            {isDelayed && (
              <TimePair
                departure={trip.departureTime}
                arrival={trip.arrivalTime}
                format={timeFormat}
                className="text-xs mt-0.5 text-white/50"
                strikethrough
              />
            )}
          </div>

          <ChevronRight
            className="h-5 w-5 text-white/70 shrink-0"
            aria-hidden="true"
          />
        </div>
      </button>

      <CardContent className="p-4 space-y-3">
        {/* Departure countdown — "how long until I need to leave?" */}
        {showCountdown && (
          <div className="flex items-center gap-3">
            <div className="w-[5rem] shrink-0 flex justify-end pr-3">
              <Timer
                className="h-6 w-6 text-my-trip"
                aria-hidden="true"
              />
            </div>
            <span
              className={cn(
                "text-[1.7rem] leading-tight font-semibold tracking-[-0.02em]",
                isDelayed ? "text-smart-gold" : "text-foreground",
              )}
            >
              <CountdownLabel minutesUntil={minutesUntil} />
            </span>
          </div>
        )}

        {/* Reminder management + Stop — same controls as the trip sheet. */}
        {!isCanceledOrSkipped && (
          <DepartureReminder
            tripNumber={trip.trip}
            fromStation={focusedTrip.fromStation}
            toStation={focusedTrip.toStation}
            departureTime={trip.departureTime}
            liveDepartureTime={realtimeStatus?.liveDepartureTime ?? null}
            arrivalTime={trip.arrivalTime}
            realtimeArrivalTime={realtimeStatus?.liveArrivalTime ?? null}
            currentTime={currentTime}
            timeFormat={timeFormat}
          />
        )}
      </CardContent>

      {sheetMounted && (
        <TripDetailSheet
          isOpen={sheetOpen}
          onClose={() => setDetailOpen(false)}
          trip={trip}
          fromStation={focusedTrip.fromStation}
          toStation={focusedTrip.toStation}
          currentTime={currentTime}
          lastUpdated={lastUpdated}
          realtimeStatus={realtimeStatus}
          timeFormat={timeFormat}
          isNextTrip={false}
          showFerry={false}
          isFocused
        />
      )}
    </SectionCard>
  );
}
