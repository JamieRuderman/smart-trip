import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BellRing, Calendar, ChevronRight, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { reconstructFocusedTrip, type FocusedTrip } from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { useTripStatus } from "@/hooks/useTripStatus";
import { useCountdown } from "@/hooks/useCountdown";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { isSouthbound } from "@/lib/stationUtils";
import {
  SHEET_ENTER_DELAY_MS,
  SHEET_TRANSITION_MS,
} from "@/lib/animationConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import {
  formatClockTime,
  serviceDateWeekdayLabel,
  toLocalDateKey,
} from "@/lib/timeUtils";
import { SectionCard } from "@/components/ui/section-card";
import { TripIcon } from "./icons/TripIcon";
import { WalkIcon } from "./icons/WalkIcon";
import { TimePair } from "./TimePair";
import { CountdownLabel } from "./CountdownLabel";
import { LeaveLabel } from "./LeaveLabel";
import { ArrivalLabel } from "./ArrivalLabel";
import { TripDetailSheet } from "./TripDetailSheet";

interface FocusedTripCardProps {
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

/**
 * A scroll-collapsible section of the pinned trip card. Its height is driven by
 * a `--trip-col-<order>` CSS var that {@link TripModeHeader} sets on its
 * container as the schedule scrolls (1px per scrolled px, sequential by
 * `order`). Defaults to natural height when the var is unset (not pinned).
 */
function Collapsible({
  order,
  className,
  children,
}: {
  order: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-collapse
      data-order={order}
      className={cn("overflow-hidden", className)}
      style={{ height: `var(--trip-col-${order}, auto)` }}
    >
      {children}
    </div>
  );
}

/**
 * Pinned representation of the user's focused trip ("Go"), shown above the
 * schedule. Always rendered the same way regardless of the home screen's
 * current from/to — reconstructed from static schedule, with live realtime
 * status overlaid. Returns null when nothing is focused or the trip can no
 * longer be found in the schedule.
 *
 * Rendered as one solid "My Trip" card — blue == the train you're taking, or the
 * "running late" gold when delayed (mirrors the lock-screen Live Activity):
 * train identity + live times + departure countdown up top, a frosted actions
 * row (reminder status / add-reminder + Stop) below. Tapping the summary opens
 * the full trip-detail sheet, where the lead-time picker and timeline live.
 *
 * When the focus is cleared (Stop) while the detail sheet is open, the card
 * stays mounted for one transition so the sheet animates closed instead of
 * vanishing instantly.
 */
export function FocusedTripCard({
  currentTime,
  timeFormat,
}: FocusedTripCardProps) {
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
  const { t, i18n } = useTranslation();
  const trips = useMemo(() => [trip], [trip]);
  const { statusMap, canceledByStartTime, lastUpdated } =
    useTripRealtimeStatusMap(
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
  const { clearFocusedTrip, openReminderDialog } = useStationSelection();

  const hasLiveDepartureTime = realtimeStatus?.liveDepartureTime != null;
  const hasLiveArrivalTime = realtimeStatus?.liveArrivalTime != null;
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
  const minutesUntilArrival = useCountdown(
    trip.arrivalTime,
    realtimeStatus?.liveArrivalTime ?? undefined,
    currentTime,
  );

  // Whether the focused run is on a later calendar day than today (e.g. a
  // weekend train chosen on a weekday). The "leave in X" countdown only makes
  // sense for today's run; for a future day we show its weekday instead so the
  // bare clock times aren't read as "today".
  const isFutureService =
    focusedTrip.serviceDate !== toLocalDateKey(currentTime);
  const serviceDayLabel = isFutureService
    ? serviceDateWeekdayLabel(focusedTrip.serviceDate, i18n.language)
    : null;
  const reminder = focusedTrip.reminder;
  const reminderTimeLabel = reminder
    ? formatClockTime(reminder.reminderAt, timeFormat, i18n.language)
    : null;

  // Minutes until the user should head out — the armed reminder fires
  // `leadMinutes` before departure, so it tracks the same clock as the
  // departure countdown (and goes negative once that lead has passed).
  const minutesUntilLeave =
    reminder != null ? minutesUntil - reminder.leadMinutes : null;

  // The single countdown chip walks the same three stages as the Live Activity
  // so every surface tells one story: head out (while a leave reminder is still
  // ahead) → departs (until the train leaves) → arrives (en route, until the
  // destination). Only for today's, non-cancelled runs; a future-service focus
  // shows its weekday instead (below) since these live countdowns are
  // today-relative.
  const countdownStage: "leave" | "departs" | "arrives" | null =
    isCanceledOrSkipped || isFutureService
      ? null
      : minutesUntilLeave != null && minutesUntilLeave >= 0
      ? "leave"
      : minutesUntil >= 0
      ? "departs"
      : minutesUntilArrival >= 0
      ? "arrives"
      : null;

  // Tapping the card opens the full trip-detail sheet; "Add reminder" pops the
  // lead-time modal directly (no sheet) via context, landing the user right
  // back on this card once they set it or dismiss.
  const openDetails = useCallback(() => {
    setDetailOpen(true);
  }, [setDetailOpen]);
  const closeDetails = useCallback(() => {
    setDetailOpen(false);
  }, [setDetailOpen]);

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
    if (closeTimerRef.current != null)
      window.clearTimeout(closeTimerRef.current);
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
      if (openTimerRef.current != null)
        window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current != null)
        window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // Match reminderLeadRange's tooLate gate: hide "Add reminder" once departure
  // is under ~2 min away (or the train has departed — minutesUntil goes
  // negative), past which even a 1-min lead reminder would fire inside the
  // near-now buffer. Future-service trips keep the affordance (their countdown
  // is day-relative, not a live lead).
  const showAddReminder =
    !isCanceledOrSkipped &&
    !reminder &&
    isReminderSupported() &&
    (isFutureService || minutesUntil >= 2);

  return (
    <SectionCard
      aria-label={t("focusedTrip.pinnedLabel")}
      className={cn(
        "overflow-hidden border-0 md:border-0 text-white shadow-[0_0_10px_rgba(0,0,0,0.35)] transition-colors",
        isDelayed ? "bg-smart-gold" : "bg-my-trip-background",
      )}
    >
      {/* Tappable summary → opens the full trip-detail sheet. */}
      <button
        type="button"
        onClick={openDetails}
        aria-label={t("focusedTrip.viewDetails")}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset"
      >
        <div className="px-4 md:px-6 pt-4 md:pt-6">
          {/* Eyebrow + "details" affordance — collapses on scroll. */}
          <Collapsible order={2}>
            <div className="flex items-center justify-between pb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/85">
                {t("focusedTrip.myTrip")}
              </span>
              <span className="flex items-center gap-0.5 text-xs font-medium text-white/70">
                {t("focusedTrip.details")}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
          </Collapsible>

          {/* Route — collapses on scroll. Each station name is an unbreakable
              unit so a long name wraps as a whole rather than mid-name. */}
          <Collapsible order={3}>
            <p className="flex flex-wrap items-center gap-x-1.5 text-base font-semibold leading-snug text-white pb-4">
              <span className="whitespace-nowrap">
                {focusedTrip.fromStation}
              </span>
              <span className="font-normal text-white/60">→</span>
              <span className="whitespace-nowrap">{focusedTrip.toStation}</span>
            </p>
          </Collapsible>

          {/* Train number + times — both kept visible: the times sit beside the
              number, so collapsing them saves no height, and they're useful. */}
          <div className="flex items-end gap-4">
            <div className="flex flex-col leading-none shrink-0">
              <span className="text-[0.65rem] font-medium uppercase tracking-wide text-white/70 mb-1">
                {t("tracker.tripLabel")}
              </span>
              <span className="text-5xl font-bold leading-none tabular-nums">
                {trip.trip}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <TimePair
                departure={departureTime}
                arrival={arrivalTime}
                format={timeFormat}
                strikethrough={isCanceledOrSkipped}
                className="text-2xl font-semibold text-white"
              />
              {/* Struck-through scheduled comparison — only the column(s)
                  that actually have a live value (see TripDetailContent). */}
              {(hasLiveDepartureTime || hasLiveArrivalTime) && (
                <TimePair
                  departure={trip.departureTime}
                  arrival={trip.arrivalTime}
                  format={timeFormat}
                  className="text-xs mt-0.5 text-white/50"
                  strikethrough
                  showDeparture={hasLiveDepartureTime}
                  showArrival={hasLiveArrivalTime}
                />
              )}
              <p className="text-xs font-medium text-white/80 mt-1 truncate">
                {statusText}
                <span className="text-white/50"> · </span>
                {directionLabel}
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* Countdown/message + Cancel — always visible (not collapsible) so you
          can always see when to leave and stop the trip. Cancel is a sibling of
          the summary button (no nested interactives). */}
      <div className="flex items-center gap-2 px-4 md:px-6 pt-4 pb-4">
        {countdownStage ? (
          <div className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl bg-white/15 px-3.5 h-12">
            {countdownStage === "leave" ? (
              <WalkIcon
                className="h-5 w-5 shrink-0 text-white/90"
                aria-hidden="true"
              />
            ) : countdownStage === "departs" ? (
              <TripIcon
                className="h-5 w-5 shrink-0 text-white/90"
                aria-hidden="true"
              />
            ) : (
              <MapPin
                className="h-5 w-5 shrink-0 text-white/90"
                aria-hidden="true"
              />
            )}
            <span className="text-lg font-semibold tracking-tight">
              {countdownStage === "leave" ? (
                <LeaveLabel minutesUntilLeave={minutesUntilLeave!} />
              ) : countdownStage === "departs" ? (
                <CountdownLabel minutesUntil={minutesUntil} />
              ) : (
                <ArrivalLabel minutesUntilArrival={minutesUntilArrival} />
              )}
            </span>
          </div>
        ) : isFutureService && serviceDayLabel ? (
          <div className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl bg-white/15 px-3.5 h-12">
            <Calendar
              className="h-5 w-5 shrink-0 text-white/90"
              aria-hidden="true"
            />
            <span className="text-lg font-semibold tracking-tight capitalize">
              {t("focusedTrip.departsOn", { day: serviceDayLabel })}
            </span>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          onClick={() => void clearFocusedTrip()}
          aria-label={t("focusedTrip.stop")}
          className="shrink-0 inline-flex items-center justify-center rounded-xl bg-white/10 px-4 h-12 text-sm font-semibold text-white/90 transition-colors hover:bg-white/20"
        >
          {t("focusedTrip.stop")}
        </button>
      </div>

      {/* Reminder pill / full-width "Add reminder" — collapses on scroll. */}
      {(reminder || showAddReminder) && (
        <Collapsible order={4}>
          <div className="px-4 md:px-6 pb-4">
            {reminder ? (
              <button
                type="button"
                onClick={openReminderDialog}
                aria-label={t("departureReminder.editReminder")}
                className="w-full min-w-0 inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
              >
                <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {reminderTimeLabel}
                  <span className="text-white/70">
                    {" · "}
                    {t("departureReminder.minutesBefore", {
                      count: reminder.leadMinutes,
                    })}
                  </span>
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={openReminderDialog}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/15 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
              >
                <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("departureReminder.setReminder")}
              </button>
            )}
          </div>
        </Collapsible>
      )}

      {sheetMounted && (
        <TripDetailSheet
          isOpen={sheetOpen}
          onClose={closeDetails}
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
          scheduleType={focusedTrip.scheduleType}
        />
      )}
    </SectionCard>
  );
}
