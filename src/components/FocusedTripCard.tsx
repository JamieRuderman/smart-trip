import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellRing, Calendar, ChevronRight, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { SectionCard } from "@/components/ui/section-card";
import { TripIcon } from "./icons/TripIcon";
import { TimePair } from "./TimePair";
import { CountdownLabel } from "./CountdownLabel";
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
 * Rendered as one solid-blue "My Trip" card (blue == the train you're taking):
 * train identity + live times + departure countdown up top, a frosted actions
 * row (reminder status / add-reminder + Stop) below. Tapping the summary opens
 * the full trip-detail sheet, where the lead-time picker and timeline live.
 *
 * When the focus is cleared (Stop) while the detail sheet is open, the card
 * stays mounted for one transition so the sheet animates closed instead of
 * vanishing instantly.
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
  const { t, i18n } = useTranslation();
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
  const { clearFocusedTrip } = useStationSelection();

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

  // Whether the focused run is on a later calendar day than today (e.g. a
  // weekend train chosen on a weekday). The "leave in X" countdown only makes
  // sense for today's run; for a future day we show its weekday instead so the
  // bare clock times aren't read as "today".
  const todayKey = `${currentTime.getFullYear()}-${String(
    currentTime.getMonth() + 1,
  ).padStart(2, "0")}-${String(currentTime.getDate()).padStart(2, "0")}`;
  const isFutureService = focusedTrip.serviceDate !== todayKey;
  const serviceDayLabel = isFutureService
    ? (() => {
        const [y, mo, d] = focusedTrip.serviceDate.split("-").map(Number);
        return new Date(y, mo - 1, d).toLocaleDateString(i18n.language, {
          weekday: "long",
        });
      })()
    : null;
  // Once the train has departed the "leave now" countdown is moot — let the
  // reminder/Stop controls and the full sheet carry the en-route story.
  const showCountdown =
    !isCanceledOrSkipped && !isFutureService && minutesUntil >= 0;

  const reminder = focusedTrip.reminder;
  const reminderTimeLabel = reminder
    ? new Date(reminder.reminderAt).toLocaleTimeString(i18n.language, {
        hour: "numeric",
        minute: "2-digit",
        hour12: timeFormat === "12h",
      })
    : null;

  // ── Detail-sheet open: "details" opens it plain; "add reminder" opens it
  //    with the lead-time picker already up. ─────────────────────────────────
  const [openWithPicker, setOpenWithPicker] = useState(false);
  const openDetails = useCallback(() => {
    setOpenWithPicker(false);
    setDetailOpen(true);
  }, [setDetailOpen]);
  const openReminderPicker = useCallback(() => {
    setOpenWithPicker(true);
    setDetailOpen(true);
  }, [setDetailOpen]);
  const closeDetails = useCallback(() => {
    setOpenWithPicker(false);
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

  // Match DepartureReminder's lead requirement: hide "Add reminder" once
  // there's under ~2 min of lead (or the train has departed — minutesUntil
  // goes negative), so the deep-link can't land on a sheet whose picker would
  // only offer a degenerate, fire-immediately range. Future-service trips keep
  // the affordance (their countdown is day-relative, not a live lead).
  const showAddReminder =
    !isCanceledOrSkipped &&
    !reminder &&
    isReminderSupported() &&
    (isFutureService || minutesUntil >= 2);

  return (
    <SectionCard
      aria-label={t("focusedTrip.pinnedLabel")}
      className="overflow-hidden border-0 md:border-0 bg-my-trip-background text-white"
    >
      {/* Tappable summary → opens the full trip-detail sheet. */}
      <button
        type="button"
        onClick={openDetails}
        aria-label={t("focusedTrip.viewDetails")}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset"
      >
        <div className="p-4 md:p-6 space-y-4">
          {/* Eyebrow + "details" affordance */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/85">
              <TripIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {t("focusedTrip.myTrip")}
            </span>
            <span className="flex items-center gap-0.5 text-xs font-medium text-white/70">
              {t("focusedTrip.details")}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>

          {/* Route — origin → destination. Each station name is an
              unbreakable unit so a long name wraps as a whole rather than
              splitting mid-name. */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-base font-semibold leading-snug text-white">
            <span className="whitespace-nowrap">{focusedTrip.fromStation}</span>
            <span className="font-normal text-white/60">→</span>
            <span className="whitespace-nowrap">{focusedTrip.toStation}</span>
          </p>

          {/* Train number + times */}
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
              {isDelayed && (
                <TimePair
                  departure={trip.departureTime}
                  arrival={trip.arrivalTime}
                  format={timeFormat}
                  className="text-xs mt-0.5 text-white/50"
                  strikethrough
                />
              )}
              <p className="text-xs font-medium text-white/80 mt-1 truncate">
                {statusText}
                <span className="text-white/50"> · </span>
                {directionLabel}
              </p>
            </div>
          </div>

          {/* Departure countdown ("how long until I need to leave?") for
              today's run, or the service day for a future run. */}
          {showCountdown ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-white/15 px-3.5 py-2.5">
              <Timer className="h-5 w-5 shrink-0 text-white/90" aria-hidden="true" />
              <span className="text-lg font-semibold tracking-tight">
                <CountdownLabel minutesUntil={minutesUntil} />
              </span>
            </div>
          ) : isFutureService && serviceDayLabel ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-white/15 px-3.5 py-2.5">
              <Calendar className="h-5 w-5 shrink-0 text-white/90" aria-hidden="true" />
              <span className="text-lg font-semibold tracking-tight capitalize">
                {t("focusedTrip.departsOn", { day: serviceDayLabel })}
              </span>
            </div>
          ) : null}
        </div>
      </button>

      {/* Actions — siblings of the summary button (no nested interactives). */}
      <div className="flex items-center gap-2 px-4 md:px-6 pb-4">
        {reminder ? (
          <button
            type="button"
            onClick={openDetails}
            className="flex-1 min-w-0 inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
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
        ) : showAddReminder ? (
          <button
            type="button"
            onClick={openReminderPicker}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/15 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
          >
            <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("departureReminder.setReminder")}
          </button>
        ) : (
          <span className="flex-1" />
        )}

        <button
          type="button"
          onClick={() => void clearFocusedTrip()}
          aria-label={t("focusedTrip.stop")}
          className="shrink-0 rounded-lg bg-white/10 px-3.5 h-9 text-sm font-semibold text-white/90 transition-colors hover:bg-white/20"
        >
          {t("focusedTrip.stop")}
        </button>
      </div>

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
          autoOpenReminderPicker={openWithPicker}
        />
      )}
    </SectionCard>
  );
}
