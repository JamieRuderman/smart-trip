import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing } from "lucide-react";
import { TripIcon } from "./icons/TripIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  isIOSWebBrowser,
  isReminderSupported,
} from "@/lib/notificationScheduler";
import { getTodayScheduleType, nextServiceDate, tripServesLeg } from "@/lib/scheduleUtils";
import { isSouthbound } from "@/lib/stationUtils";
import {
  focusedDepartureInstant,
  focusedTripMatchesSchedule,
} from "@/lib/focusedTrip";
import { reminderLeadRange } from "@/lib/reminderLead";
import {
  formatClockTime,
  parseTimeToMinutes,
  toLocalDateKey,
} from "@/lib/timeUtils";
import { APP_STORE_URL } from "@/seo/constants";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { GutterRow } from "./GutterRow";

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
  /** The schedule (weekday/weekend) the displayed trip belongs to — passed in
   *  from whatever surface rendered it (home list = the user's selected type,
   *  pinned card = the focused trip's type, line map = today). NEVER inferred
   *  from "today" here: train numbers repeat across weekday/weekend, so an
   *  inferred type would focus/recognize the wrong run. */
  scheduleType: "weekday" | "weekend";
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
  scheduleType,
}: DepartureReminderProps) {
  const { t, i18n } = useTranslation();

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
    rescheduleReminder,
    setSelectedTrip,
    openReminderDialog,
  } = useStationSelection();

  // The same train can be viewed under different legs — its full corridor on
  // the line map (origin→terminus) and the user's selected leg on the home
  // schedule. Recognize "this is the focused train" by trip number + direction
  // + schedule type (NOT exact leg) so the control behaves identically wherever
  // it's opened. Shared predicate keeps this in lockstep with the schedule-row
  // and station-arrival highlights.
  const isThisTripFocused =
    focusedTripMatchesSchedule(
      focusedTrip,
      isSouthbound(fromStation, toStation),
      scheduleType,
    ) && focusedTrip.tripNumber === tripNumber;

  // Whether the displayed leg IS the focused leg. When true, this view's
  // (live) departureAt is the user's actual boarding departure; when false
  // (e.g. the line-map corridor view), it isn't, so reminder math falls back
  // to the focused leg's scheduled departure.
  const focusedExactLeg =
    isThisTripFocused &&
    focusedTrip != null &&
    focusedTrip.fromStation === fromStation &&
    focusedTrip.toStation === toStation;

  const isOtherTripFocused = focusedTrip != null && !isThisTripFocused;

  const serviceDate = useMemo(() => {
    // When the displayed schedule is today's service, anchor to the
    // (rollover-aware) displayed departure date. When it's a different service
    // (e.g. a weekend train chosen on a weekday), anchor to the next date that
    // actually runs that service so the trip is correctly "this coming weekend".
    if (scheduleType === getTodayScheduleType(currentTime)) {
      return toLocalDateKey(new Date(departureAt));
    }
    return nextServiceDate(currentTime, scheduleType);
  }, [departureAt, scheduleType, currentTime]);

  // Arrival instant for THIS displayed leg — used only to stop offering "Go"
  // once the trip has actually finished (focusing is otherwise allowed right
  // up to/through departure, unlike setting a reminder which needs lead time).
  const effectiveArrival = realtimeArrivalTime ?? arrivalTime;
  const arrivalAt = useMemo(() => {
    const a = buildDepartureTimestamp(currentTime, effectiveArrival);
    return a < departureAt ? a + 24 * 60 * 60 * 1000 : a;
  }, [currentTime, effectiveArrival, departureAt]);

  // Departure used for ALL reminder math (lead range, fire time, drift). Use
  // this view's live departureAt ONLY for the focused leg on today's service —
  // there the displayed HH:MM is correctly anchored to today and reflects
  // realtime drift. In every other focused case the displayed departureAt is
  // mis-anchored, so resolve the focused leg's serviceDate-anchored departure:
  //   • a different leg (e.g. the line-map corridor view) → target the user's
  //     boarding station, not the corridor origin; and
  //   • a non-today service (e.g. a weekend train picked on a weekday) →
  //     buildDepartureTimestamp would anchor to today/tomorrow and arm the
  //     reminder on the wrong day, so use the stored serviceDate instead.
  const reminderDepartureAt = useMemo(() => {
    if (isThisTripFocused && focusedTrip) {
      const focusedServiceIsToday =
        focusedTrip.scheduleType === getTodayScheduleType(currentTime);
      if (!focusedExactLeg || !focusedServiceIsToday) {
        return focusedDepartureInstant(focusedTrip) ?? departureAt;
      }
    }
    return departureAt;
  }, [isThisTripFocused, focusedExactLeg, focusedTrip, departureAt, currentTime]);

  /** Too little lead left to schedule a useful reminder. Gates the modal pop on
   *  "Take this train" and the "Add reminder" affordance. Focusing ("Go")
   *  itself is still allowed right up to arrival. */
  const { tooLate: tooLateToScheduleReminder } = reminderLeadRange(
    reminderDepartureAt,
    currentTime.getTime(),
  );

  const [confirmSwitch, setConfirmSwitch] = useState(false);

  const doFocus = useCallback(() => {
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
    // Close the detail sheet we're inside so the user lands back on the home
    // screen with the pinned trip card — no manual sheet-dismiss afterward.
    setSelectedTrip(null);
    // Then pop the reminder modal (rendered by the home card, so it survives
    // this sheet unmounting). Skip where notifications aren't supported, or
    // when there's too little lead left to schedule a useful reminder — there's
    // nothing worth configuring in either case, and the user just lands home.
    if (isReminderSupported() && !tooLateToScheduleReminder) {
      openReminderDialog();
    }
  }, [
    focusTrip,
    fromStation,
    toStation,
    tripNumber,
    serviceDate,
    scheduleType,
    homeFromStation,
    homeToStation,
    tooLateToScheduleReminder,
    setSelectedTrip,
    openReminderDialog,
  ]);

  const handleGoClick = useCallback(() => {
    if (isOtherTripFocused) setConfirmSwitch(true);
    else doFocus();
  }, [doFocus, isOtherTripFocused]);

  /** This trip's armed reminder, if any. Sourced from the focused-trip
   *  context rather than the old per-trip hook. */
  const reminder = isThisTripFocused ? focusedTrip?.reminder ?? null : null;

  // Boarding station for the reminder text: the focused leg's origin when this
  // trip is focused (so the line-map corridor view still names the user's
  // station), otherwise this displayed leg's origin.
  const reminderFromStation =
    isThisTripFocused && focusedTrip ? focusedTrip.fromStation : fromStation;

  const buildText = useCallback(
    (leadMinutes: number) => ({
      title: t("departureReminder.notificationTitle", { station: reminderFromStation }),
      body: t("departureReminder.notificationBody", {
        leadMinutes,
        station: reminderFromStation,
        time: formatClockTime(reminderDepartureAt, timeFormat, i18n.language),
        trip: tripNumber,
      }),
    }),
    [reminderDepartureAt, reminderFromStation, i18n.language, t, timeFormat, tripNumber]
  );

  // Live drift: when this focused trip has a reminder and the live departure
  // implies a different fire time than what's stored, reschedule it. Only runs
  // from the focused leg's own view, where reminderDepartureAt is the live
  // boarding departure — the line-map corridor view's static time must not
  // clobber a live-adjusted reminder.
  const focusedReminderAt = isThisTripFocused
    ? focusedTrip?.reminder?.reminderAt ?? null
    : null;
  const focusedReminderLead = isThisTripFocused
    ? focusedTrip?.reminder?.leadMinutes ?? null
    : null;
  useEffect(() => {
    if (!focusedExactLeg) return;
    if (focusedReminderAt == null || focusedReminderLead == null) return;
    const expected = reminderDepartureAt - focusedReminderLead * 60_000;
    if (expected === focusedReminderAt) return;
    void rescheduleReminder(reminderDepartureAt, buildText(focusedReminderLead));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderDepartureAt, focusedExactLeg, focusedReminderAt, focusedReminderLead]);

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
            className="bg-my-trip-background text-white hover:bg-my-trip-background/90"
          >
            {t("focusedTrip.switchConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  // Order matters here:
  //   1. Reminder status — this trip is focused with an armed reminder. Shown
  //      read-only; editing/cancelling it and cancelling the trip both live on
  //      the home "My Trip" card now, not in this sheet.
  //   2. Going (no reminder) — this trip is focused but no reminder armed;
  //      offer to open the reminder modal.
  //   3. Go button — the default not-focused state. Respects the
  //      departure-already-passed gate. Unlike the reminder, focusing works
  //      without notification support, so Go shows regardless of
  //      isReminderSupported().

  if (isThisTripFocused && reminder) {
    // Read-only reminder status. Tap the pill on the home "My Trip" card to
    // edit or cancel it — the sheet no longer carries its own cancel control.
    return (
      <GutterRow>
        <div className="flex-1 min-w-0 rounded-lg bg-muted/40 p-3 animate-in slide-in-from-top-4 duration-200">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing
              className="h-4 w-4 text-my-trip shrink-0"
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
                {reminder.alarmId
                  ? t("departureReminder.leaveAlarmActive", {
                      count: reminder.leadMinutes,
                    })
                  : t("departureReminder.minutesBefore", {
                      count: reminder.leadMinutes,
                    })}
              </div>
            </div>
          </div>
        </div>
      </GutterRow>
    );
  }

  if (isThisTripFocused && !reminder) {
    // The reminder sub-control needs notification support. When unsupported,
    // offer the native-app CTA on iOS web (where the Notification API is
    // absent) and otherwise just drop the reminder affordance — focusing the
    // trip itself still works without notifications.
    const reminderSupported = isReminderSupported();
    const showAppCta = !reminderSupported && isIOSWebBrowser();
    // Once there's too little lead left, drop the "Add reminder" affordance —
    // the modal would only offer a degenerate, fire-immediately range. The
    // trip stays focused; the user just can't add a reminder this close in.
    const showAddReminder = reminderSupported && !tooLateToScheduleReminder;
    return (
      <GutterRow>
        <div className="flex-1 min-w-0 rounded-lg bg-muted/40 p-3 animate-in slide-in-from-top-4 duration-200">
          <span className="flex items-center gap-2 min-w-0 text-sm font-medium text-foreground">
            <TripIcon
              className="h-4 w-4 text-my-trip shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">{t("focusedTrip.going")}</span>
          </span>
          {/* "Add reminder" and the iOS-web app CTA each get their own
              full-width row below the "Going" label. */}
          {showAddReminder && (
            <Button
              variant="outline"
              size="sm"
              onClick={openReminderDialog}
              aria-label={t("departureReminder.setReminder")}
              className="mt-2 h-9 w-full gap-1.5"
            >
              <BellRing className="h-3.5 w-3.5 text-my-trip" aria-hidden="true" />
              <span>{t("departureReminder.setReminder")}</span>
            </Button>
          )}
          {showAppCta && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-2 h-9 w-full gap-1.5"
            >
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("departureReminder.appCta")}
              >
                <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t("departureReminder.appCta")}</span>
              </a>
            </Button>
          )}
        </div>
      </GutterRow>
    );
  }

  // "Going" means going somewhere — require a selected journey (origin +
  // destination). Without one (e.g. tapping a train on the line map before
  // planning a trip) there's no real destination to focus, so hide Go.
  if (!homeFromStation || !homeToStation) return null;
  // Offer "Go" right up until the trip actually finishes. Focusing ("I'm
  // taking this train") doesn't need lead time — unlike the reminder modal —
  // so it must NOT be gated on tooLateToSchedule, or the user couldn't
  // re-focus a train shortly before departure (e.g. after tapping Stop).
  if (arrivalAt <= Date.now()) return null;
  return (
    <GutterRow>
      <Button
        onClick={handleGoClick}
        aria-label={t("focusedTrip.go")}
        className="flex-1 h-12 gap-2 rounded-xl text-base font-semibold bg-[hsl(220_13%_18%)] text-white shadow-sm hover:bg-[hsl(220_13%_18%)]/90 active:bg-[hsl(220_13%_18%)]/90"
      >
        <TripIcon className="h-5 w-5" aria-hidden="true" />
        <span>{t("focusedTrip.go")}</span>
      </Button>
      {switchDialog}
    </GutterRow>
  );
}
