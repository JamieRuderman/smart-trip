import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, BellRing, Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  isIOSWebBrowser,
  isReminderSupported,
} from "@/lib/notificationScheduler";
import { getTodayScheduleType, tripServesLeg } from "@/lib/scheduleUtils";
import { isSouthbound } from "@/lib/stationUtils";
import { APP_STORE_URL } from "@/seo/constants";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { cn } from "@/lib/utils";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { GutterRow } from "./GutterRow";

/** Default suggested lead time when opening the picker. Capped to the
 *  available window so we never preselect an impossible value. */
const DEFAULT_LEAD_MINUTES = 15;
const MAX_LEAD_MINUTES = 1440;
/** Show the "close to departure" warning when the reminder fires within
 *  this many minutes of the train's actual departure. */
const CLOSE_TO_DEPARTURE_THRESHOLD = 3;
/** How long the open/close animation runs, in ms. Matches the
 *  duration-200 utility used in the className. */
const PICKER_ANIMATION_MS = 200;

interface DepartureReminderProps {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  /** Scheduled departure time as "HH:MM". */
  departureTime: string;
  /** Live override; takes precedence over the scheduled time when set. */
  liveDepartureTime?: string | null;
  /** Scheduled arrival time at toStation as "HH:MM". */
  arrivalTime: string;
  /** Live arrival override; takes precedence when set. */
  realtimeArrivalTime?: string | null;
  currentTime: Date;
  /** "12h" — controls the time format shown in the active reminder pill. */
  timeFormat: "12h" | "24h";
}

/** Hours of past-ness before we assume a HH:MM refers to tomorrow's run. */
const NEXT_DAY_ROLLOVER_HOURS = 4;

/**
 * Build an epoch timestamp for a train's HH:MM departure. If the HH:MM lies
 * many hours in the past, assume it refers to the next day's run (e.g. a
 * 00:15 train viewed at 23:55). Within a few hours of now, treat it as
 * today so a just-departed train is correctly flagged as in the past rather
 * than silently treated as tomorrow's same trip.
 */
function buildDepartureTimestamp(currentTime: Date, hhmm: string): number {
  const minutes = parseTimeToMinutes(hhmm);
  const d = new Date(currentTime);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  const rolloverCutoff =
    currentTime.getTime() - NEXT_DAY_ROLLOVER_HOURS * 60 * 60 * 1000;
  if (d.getTime() < rolloverCutoff) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function formatClockTime(
  epoch: number,
  timeFormat: "12h" | "24h",
  locale: string
): string {
  return new Date(epoch).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
}

type PickerError = null | "permission" | "schedule-failed";

export function DepartureReminder({
  tripNumber,
  fromStation,
  toStation,
  departureTime,
  liveDepartureTime,
  arrivalTime,
  realtimeArrivalTime,
  currentTime,
  timeFormat,
}: DepartureReminderProps) {
  const { t, i18n } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keep the picker mounted briefly after pickerOpen flips to false so the
  // exit animation can play before the element is removed from the DOM.
  const [pickerMounted, setPickerMounted] = useState(false);
  const [pickerError, setPickerError] = useState<PickerError>(null);

  useEffect(() => {
    if (pickerOpen) {
      setPickerMounted(true);
      return;
    }
    if (!pickerMounted) return;
    const timer = window.setTimeout(
      () => setPickerMounted(false),
      PICKER_ANIMATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pickerOpen, pickerMounted]);

  const effectiveTime = liveDepartureTime ?? departureTime;
  const departureAt = useMemo(
    () => buildDepartureTimestamp(currentTime, effectiveTime),
    [currentTime, effectiveTime]
  );

  const {
    fromStation: homeFromStation,
    toStation: homeToStation,
    focusedTrip,
    focusTrip,
    setReminder,
    rescheduleReminder,
    clearFocusedTrip,
  } = useStationSelection();

  const isThisTripFocused =
    focusedTrip != null &&
    focusedTrip.tripNumber === tripNumber &&
    focusedTrip.fromStation === fromStation &&
    focusedTrip.toStation === toStation;

  // The same train can be viewed under two different legs — its full corridor
  // on the line map (origin→terminus) and the user's selected leg on the home
  // schedule. Treat "same train number + same direction" as the same focused
  // train so re-tapping Go on the line map doesn't prompt to "switch" to
  // itself. Direction guards against the trip number being reused on the
  // opposite-direction schedule.
  const isSameTrainOtherLeg =
    focusedTrip != null &&
    !isThisTripFocused &&
    focusedTrip.tripNumber === tripNumber &&
    focusedTrip.scheduleType === getTodayScheduleType() &&
    isSouthbound(focusedTrip.fromStation, focusedTrip.toStation) ===
      isSouthbound(fromStation, toStation);

  const isOtherTripFocused =
    focusedTrip != null && !isThisTripFocused && !isSameTrainOtherLeg;

  const serviceDate = useMemo(() => {
    const d = new Date(departureAt);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }, [departureAt]);

  // Arrival instant for THIS displayed leg — used only to stop offering "Go"
  // once the trip has actually finished (focusing is otherwise allowed right
  // up to/through departure, unlike setting a reminder which needs lead time).
  const effectiveArrival = realtimeArrivalTime ?? arrivalTime;
  const arrivalAt = useMemo(() => {
    const a = buildDepartureTimestamp(currentTime, effectiveArrival);
    return a < departureAt ? a + 24 * 60 * 60 * 1000 : a;
  }, [currentTime, effectiveArrival, departureAt]);

  const [confirmSwitch, setConfirmSwitch] = useState(false);

  const doFocus = useCallback(() => {
    const scheduleType = getTodayScheduleType();
    // The Go control can be opened from the line map, where the displayed trip
    // runs origin→terminus. When the user has a home-screen leg selected and
    // this train actually serves it, focus THAT leg so the pinned card shows
    // the user's destination (and dedupes against the schedule row) rather
    // than the full corridor.
    let legFrom: Station = fromStation;
    let legTo: Station = toStation;
    if (
      homeFromStation &&
      homeToStation &&
      (homeFromStation !== fromStation || homeToStation !== toStation) &&
      tripServesLeg(tripNumber, homeFromStation, homeToStation, scheduleType)
    ) {
      legFrom = homeFromStation;
      legTo = homeToStation;
    }
    void focusTrip({
      tripNumber,
      fromStation: legFrom,
      toStation: legTo,
      scheduleType,
      serviceDate,
    });
  }, [
    focusTrip,
    fromStation,
    toStation,
    tripNumber,
    serviceDate,
    homeFromStation,
    homeToStation,
  ]);

  const handleGoClick = useCallback(() => {
    if (isOtherTripFocused) setConfirmSwitch(true);
    else doFocus();
  }, [doFocus, isOtherTripFocused]);

  /** This trip's armed reminder, if any. Sourced from the focused-trip
   *  context rather than the old per-trip hook. */
  const reminder = isThisTripFocused ? focusedTrip?.reminder ?? null : null;

  /**
   * Whole minutes until departure, computed as the diff between epoch-minute
   * numbers so it matches the "Arrives in X min" countdown elsewhere in the
   * sheet (which uses getMinutes() and ignores sub-minute remainders).
   */
  const minutesUntilDeparture =
    Math.floor(departureAt / 60_000) -
    Math.floor(currentTime.getTime() / 60_000);

  /** Maximum lead time we'll allow. Picking the max fires the alarm
   *  immediately — fine as a "leave now" nudge since the user chose it. */
  const maxLeadMinutes = Math.max(
    1,
    Math.min(MAX_LEAD_MINUTES, minutesUntilDeparture)
  );

  const [sliderValue, setSliderValue] = useState(() =>
    Math.min(DEFAULT_LEAD_MINUTES, Math.max(1, maxLeadMinutes))
  );

  /** Clamp at render time so a long-open picker can't submit a value that
   *  drifted past the shrinking max as currentTime ticked forward. */
  const clampedSliderValue = Math.min(sliderValue, maxLeadMinutes);

  const buildText = useCallback(
    (leadMinutes: number) => ({
      title: t("departureReminder.notificationTitle", { station: fromStation }),
      body: t("departureReminder.notificationBody", {
        leadMinutes,
        station: fromStation,
        time: formatClockTime(departureAt, timeFormat, i18n.language),
        trip: tripNumber,
      }),
    }),
    [departureAt, fromStation, i18n.language, t, timeFormat, tripNumber]
  );

  // Live drift: when this focused trip has a reminder and the live departure
  // implies a different fire time than what's stored, reschedule it.
  const focusedReminderAt = isThisTripFocused
    ? focusedTrip?.reminder?.reminderAt ?? null
    : null;
  const focusedReminderLead = isThisTripFocused
    ? focusedTrip?.reminder?.leadMinutes ?? null
    : null;
  useEffect(() => {
    if (focusedReminderAt == null || focusedReminderLead == null) return;
    const expected = departureAt - focusedReminderLead * 60_000;
    if (expected === focusedReminderAt) return;
    void rescheduleReminder(departureAt, buildText(focusedReminderLead));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departureAt, focusedReminderAt, focusedReminderLead]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerError(null);
  }, []);

  const openPicker = useCallback(() => {
    setSliderValue(Math.min(DEFAULT_LEAD_MINUTES, maxLeadMinutes));
    setPickerError(null);
    setPickerOpen(true);
  }, [maxLeadMinutes]);

  const handleSet = useCallback(async () => {
    const result = await setReminder(
      clampedSliderValue,
      departureAt,
      buildText(clampedSliderValue),
    );
    if (result.ok === false) {
      setPickerError(
        result.reason === "permission" ? "permission" : "schedule-failed",
      );
      return;
    }
    closePicker();
  }, [buildText, clampedSliderValue, closePicker, departureAt, setReminder]);

  // The "switch trains?" confirm dialog. Portals out of the gutter row, so it
  // can be rendered alongside whatever branch is active (only the Go branch
  // ever sets confirmSwitch, but rendering it unconditionally keeps it mounted
  // across the brief states the user can't trigger it from).
  const switchDialog = confirmSwitch ? (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setConfirmSwitch(false);
      }}
    >
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{t("focusedTrip.switchTitle")}</DialogTitle>
          <DialogDescription>
            {t("focusedTrip.switchBody", {
              current: focusedTrip?.tripNumber,
              next: tripNumber,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setConfirmSwitch(false)}>
            {t("focusedTrip.switchCancel")}
          </Button>
          <Button
            onClick={() => {
              setConfirmSwitch(false);
              doFocus();
            }}
          >
            {t("focusedTrip.switchConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  /** A small "Stop" button that un-focuses this trip entirely. */
  const stopButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void clearFocusedTrip()}
      aria-label={t("focusedTrip.stop")}
      className="h-8 shrink-0"
    >
      {t("focusedTrip.stop")}
    </Button>
  );

  // Order matters here:
  //   1. Going + reminder pill — this trip is focused and has an armed
  //      reminder. The X disarms the reminder (keeps focus); Stop un-focuses.
  //      Highest priority once the picker is fully unmounted, regardless of
  //      tooLateToSchedule, so a just-set reminder for an imminent train
  //      still surfaces.
  //   2. Going (no reminder) — this trip is focused but no reminder armed;
  //      offer to open the reminder picker plus a Stop action.
  //   3. Picker — if it's mounted (either open or mid-exit-animation),
  //      keep it on screen. Don't yank it out from under the user even if
  //      the window closes mid-interaction.
  //   4. Go button — the default not-focused state. Respects
  //      tooLateToSchedule and the departure-already-passed gate. Unlike the
  //      reminder, focusing works without notification support, so Go shows
  //      regardless of isReminderSupported().

  if (isThisTripFocused && reminder && !pickerMounted) {
    return (
      <GutterRow>
        <div className="flex-1 min-w-0 rounded-lg bg-muted/40 p-3 animate-in slide-in-from-top-4 duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BellRing
                className="h-4 w-4 text-primary shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground tabular-nums">
                  {t("departureReminder.remindAt", {
                    time: formatClockTime(
                      reminder.reminderAt,
                      timeFormat,
                      i18n.language,
                    ),
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("departureReminder.minutesBefore", {
                    count: reminder.leadMinutes,
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => void setReminder(null, departureAt, buildText(0))}
                aria-label={t("departureReminder.cancel")}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent active:bg-accent"
              >
                <X
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
              {stopButton}
            </div>
          </div>
        </div>
      </GutterRow>
    );
  }

  if (isThisTripFocused && !reminder && !pickerMounted) {
    // The reminder sub-control needs notification support. When unsupported,
    // offer the native-app CTA on iOS web (where the Notification API is
    // absent) and otherwise just drop the reminder affordance — focusing the
    // trip itself still works without notifications.
    const reminderSupported = isReminderSupported();
    const showAppCta = !reminderSupported && isIOSWebBrowser();
    const reminderAffordance = reminderSupported ? (
      <Button
        variant="outline"
        size="sm"
        onClick={openPicker}
        aria-label={t("departureReminder.setReminder")}
        className="h-8 gap-1.5"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t("departureReminder.setReminder")}</span>
      </Button>
    ) : showAppCta ? (
      <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("departureReminder.appCta")}
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("departureReminder.appCta")}</span>
        </a>
      </Button>
    ) : null;
    return (
      <GutterRow>
        <div className="flex-1 min-w-0 rounded-lg bg-muted/40 p-3 animate-in slide-in-from-top-4 duration-200">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0 text-sm font-medium text-foreground">
              <Navigation
                className="h-4 w-4 text-primary shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{t("focusedTrip.going")}</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {reminderAffordance}
              {stopButton}
            </div>
          </div>
        </div>
      </GutterRow>
    );
  }

  // This is the focused train, but viewed under a different leg than the one
  // it's focused on (e.g. the line map shows its full corridor while it's
  // focused on the user's home leg). Show a "Going" status + Stop. We do NOT
  // offer the reminder picker here because this view's departure time is for a
  // different leg; reminder editing lives on the matching-leg detail (the home
  // pinned card / schedule row). Stop is leg-independent, so it's safe here.
  if (isSameTrainOtherLeg && !pickerMounted) {
    return (
      <GutterRow>
        <div className="flex-1 min-w-0 rounded-lg bg-muted/40 p-3 animate-in slide-in-from-top-4 duration-200">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0 text-sm font-medium text-foreground">
              <Navigation
                className="h-4 w-4 text-primary shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{t("focusedTrip.going")}</span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {focusedTrip?.reminder && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("departureReminder.remindAt", {
                    time: formatClockTime(
                      focusedTrip.reminder.reminderAt,
                      timeFormat,
                      i18n.language,
                    ),
                  })}
                </span>
              )}
              {stopButton}
            </div>
          </div>
        </div>
      </GutterRow>
    );
  }

  if (!pickerMounted) {
    // Offer "Go" right up until the trip actually finishes. Focusing ("I'm
    // taking this train") doesn't need lead time — unlike the reminder picker —
    // so it must NOT be gated on tooLateToSchedule, or the user couldn't
    // re-focus a train shortly before departure (e.g. after tapping Stop).
    if (arrivalAt <= Date.now()) return null;
    return (
      <GutterRow>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGoClick}
          aria-label={t("focusedTrip.go")}
          className="h-9 gap-1.5"
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("focusedTrip.go")}</span>
        </Button>
        {switchDialog}
      </GutterRow>
    );
  }

  // The lead is small → alarm fires close to the train, leaving little time
  // to actually leave. That's the warning case (analogous to the ferry
  // quick-transfer warning).
  const isCloseToDeparture =
    clampedSliderValue <= CLOSE_TO_DEPARTURE_THRESHOLD;
  const alarmAt = departureAt - clampedSliderValue * 60_000;
  const alarmAtLabel = formatClockTime(alarmAt, timeFormat, i18n.language);

  const errorMessage =
    pickerError === "permission"
      ? t("departureReminder.permissionDenied")
      : pickerError === "schedule-failed"
        ? t("departureReminder.scheduleFailed")
        : null;

  return (
    <GutterRow>
      <div
        className={cn(
          "flex-1 min-w-0 rounded-lg bg-muted/40 p-3 space-y-3 duration-200",
          pickerOpen
            ? "animate-in slide-in-from-top-4"
            : "animate-out slide-out-to-top-4",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium flex items-center gap-1.5 text-foreground">
            <Bell
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            {t("departureReminder.label")}
          </span>
          <button
            type="button"
            onClick={closePicker}
            aria-label={t("departureReminder.closePicker")}
            className="h-8 w-8 -mr-1 flex items-center justify-center rounded-md hover:bg-accent active:bg-accent"
          >
            <X
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="text-center py-1">
          <div
            className={cn(
              "text-3xl font-semibold tabular-nums leading-none",
              isCloseToDeparture ? "text-smart-gold" : "text-foreground",
            )}
          >
            {t("departureReminder.minutesValue", { count: clampedSliderValue })}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t("departureReminder.beforeDeparture")}
          </div>
          <div className="text-sm text-foreground/70 mt-1.5 tabular-nums">
            {t("departureReminder.alarmAt", { time: alarmAtLabel })}
          </div>
        </div>

        {/* Stop touch events from bubbling to the parent AppSheet, which has
            a swipe-to-dismiss handler that calls preventDefault on every
            touchmove. The Radix Slider emits many touchmove events per drag,
            each one spamming a "Unable to preventDefault inside passive
            event listener" warning AND making the sheet treat the slider
            drag as a swipe-to-dismiss gesture. */}
        <div
          className="px-1 space-y-1.5"
          onTouchStart={(event) => event.stopPropagation()}
        >
          <Slider
            value={[clampedSliderValue]}
            min={1}
            max={maxLeadMinutes}
            step={1}
            onValueChange={(values) => {
              const next = values[0];
              if (typeof next === "number") setSliderValue(next);
            }}
            aria-label={t("departureReminder.label")}
            aria-valuetext={t("departureReminder.minutesValue", {
              count: clampedSliderValue,
            })}
            thumbLabel={t("departureReminder.label")}
          />
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              {t("departureReminder.minutesValue", { count: 1 })}
            </span>
            <span>
              {t("departureReminder.minutesValue", { count: maxLeadMinutes })}
            </span>
          </div>
        </div>

        {isCloseToDeparture && (
          <div
            className="p-3 rounded-lg bg-smart-gold/10 border border-smart-gold/40 flex items-start gap-2"
            role="status"
          >
            <AlertTriangle
              className="h-4 w-4 text-smart-gold mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-smart-gold">
                {t("departureReminder.warningTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("departureReminder.warningBody", {
                  count: clampedSliderValue,
                })}
              </p>
            </div>
          </div>
        )}

        <Button
          type="button"
          onClick={() => void handleSet()}
          className="w-full h-11"
        >
          {t("departureReminder.setReminderConfirm")}
        </Button>

        {errorMessage && (
          <p
            className="text-xs text-destructive"
            role="alert"
            aria-live="polite"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </GutterRow>
  );
}
