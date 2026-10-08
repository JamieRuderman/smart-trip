import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { TripIcon } from "./icons/TripIcon";
import { Button } from "@/components/ui/button";
import { useStationSelection } from "@/contexts/stationSelection";
import { useBoardingLocationCheck } from "@/hooks/useBoardingLocationCheck";
import { useOpenTripView } from "@/hooks/useTripViewNavigation";
import {
  findRealtimeStatus,
  useTripRealtimeStatusMap,
} from "@/hooks/useTripUpdates";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { correctedLeg } from "@/lib/boardingLocation";
import {
  futureServiceDate,
  getFilteredTrips,
  getTodayScheduleType,
  tripServesLeg,
} from "@/lib/scheduleUtils";
import { isSouthbound } from "@/lib/stationUtils";
import {
  anchorLiveTime,
  focusedDepartureInstant,
  focusedTripMatchesSchedule,
  replacementRun,
  type FocusedRun,
} from "@/lib/focusedTrip";
import { sameFocusIdentity } from "@/lib/liveActivityController";
import { reminderLeadRange } from "@/lib/reminderLead";
import {
  formatClockTime,
  parseServiceDate,
  parseTimeToMinutes,
  toLocalDateKey,
} from "@/lib/timeUtils";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { GutterRow } from "./GutterRow";
import { BoardingLocationDialog } from "./BoardingLocationDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { StationsUpdatedNotice } from "./StationsUpdatedNotice";

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
  /** This train's live departure ("HH:MM") per station, from the realtime
   *  feed — for its live time at the rider's boarding station when that isn't
   *  this view's fromStation (e.g. the line map's corridor view). */
  liveStopDepartures?: Partial<Record<string, string>>;
  currentTime: Date;
  /** "12h" — controls the time format shown in the active reminder pill. */
  timeFormat: "12h" | "24h";
  /** The schedule (weekday/weekend) the displayed trip belongs to — passed in
   *  from whatever surface rendered it (home list = the user's selected type,
   *  line map = today). NEVER inferred from "today" here: train numbers
   *  repeat across weekday/weekend, so an inferred type would focus/recognize
   *  the wrong run. */
  scheduleType: "weekday" | "weekend";
  /** Whether the detail sheet this control sits in is open — false while it
   *  animates closed. */
  sheetOpen: boolean;
  /** Close the detail sheet this control sits in. The sheet's own close —
   *  the line map's sheets aren't driven by the selected trip. */
  onClose: () => void;
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
  liveStopDepartures,
  currentTime,
  timeFormat,
  scheduleType,
  sheetOpen,
  onClose,
}: DepartureReminderProps) {
  const { t, i18n } = useTranslation();
  const openTripView = useOpenTripView();

  // A schedule other than today's runs on a later day: anchor its clock times
  // to that day, or a train whose time just passed today reads as finished
  // (hiding "Take this train") and too late for a reminder.
  const otherDayServiceDate = futureServiceDate(currentTime, scheduleType);
  const anchorTime = useMemo(
    () =>
      otherDayServiceDate ? parseServiceDate(otherDayServiceDate) : currentTime,
    [otherDayServiceDate, currentTime],
  );

  const effectiveTime = liveDepartureTime ?? departureTime;
  const departureAt = useMemo(
    () => buildDepartureTimestamp(anchorTime, effectiveTime),
    [anchorTime, effectiveTime]
  );

  const {
    fromStation: homeFromStation,
    toStation: homeToStation,
    focusedTrip,
    focusTrip,
    rescheduleReminder,
    setSelectedTrip,
    setFromStation,
    setToStation,
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

  // When the displayed schedule is today's service, anchor to the
  // (rollover-aware) displayed departure date. When it's a different service
  // (e.g. a weekend train chosen on a weekday), anchor to the next date that
  // actually runs that service so the trip is correctly "this coming weekend".
  const serviceDate =
    otherDayServiceDate ?? toLocalDateKey(new Date(departureAt));

  // Arrival instant for THIS displayed leg — used only to stop offering "Go"
  // once the trip has actually finished (focusing is otherwise allowed right
  // up to/through departure, unlike setting a reminder which needs lead time).
  const effectiveArrival = realtimeArrivalTime ?? arrivalTime;
  const arrivalAt = useMemo(() => {
    const a = buildDepartureTimestamp(anchorTime, effectiveArrival);
    return a < departureAt ? a + 24 * 60 * 60 * 1000 : a;
  }, [anchorTime, effectiveArrival, departureAt]);

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

  const [confirmSwitch, setConfirmSwitch] = useState(false);
  // The corrected leg when the location warning's fix found no train to take
  // on it — shown in StationsUpdatedNotice until that closes.
  const [noTrainLeg, setNoTrainLeg] = useState<{ from: Station; to: Station } | null>(null);

  // The run "Take this train" focuses. The Go control can be opened from the
  // line map, where the displayed trip runs origin→terminus. When the user has
  // a home-screen leg selected and this train actually serves it, focus THAT
  // leg so My Trip shows the user's destination (and matches the schedule
  // row) rather than the full corridor.
  const focusRun = useMemo((): FocusedRun => {
    const run = { tripNumber, scheduleType, serviceDate };
    if (
      homeFromStation &&
      homeToStation &&
      (homeFromStation !== fromStation || homeToStation !== toStation) &&
      tripServesLeg(tripNumber, homeFromStation, homeToStation, scheduleType)
    ) {
      return { ...run, fromStation: homeFromStation, toStation: homeToStation };
    }
    return { ...run, fromStation, toStation };
  }, [homeFromStation, homeToStation, fromStation, toStation, tripNumber, scheduleType, serviceDate]);

  // When focusRun leaves its boarding station: this view's live time when it
  // starts there on today's service; else the run's scheduled time on its
  // service date (e.g. the line map's corridor view, whose displayed departure
  // is the terminus's, not the rider's boarding station's), moved to the live
  // time the feed has for that station today.
  const focusRunDepartureAt = useMemo(() => {
    const today = scheduleType === getTodayScheduleType(currentTime);
    if (today && focusRun.fromStation === fromStation) return departureAt;
    const scheduled = focusedDepartureInstant(focusRun);
    const live = today ? liveStopDepartures?.[focusRun.fromStation] : undefined;
    return scheduled != null && live ? anchorLiveTime(scheduled, live) : scheduled;
  }, [focusRun, fromStation, scheduleType, currentTime, departureAt, liveStopDepartures]);

  // Check the rider's location against the boarding station before focusing —
  // only for their own journey (the line map's corridor view starts at a
  // terminus most riders don't board at).
  const isHomeLeg =
    focusRun.fromStation === homeFromStation && focusRun.toStation === homeToStation;
  const boardingCheck = useBoardingLocationCheck({
    from: focusRun.fromStation,
    to: focusRun.toStation,
    departureAt: !isHomeLeg || isThisTripFocused ? null : focusRunDepartureAt,
    now: currentTime.getTime(),
    active: sheetOpen,
  });

  // While the location warning is up: the leg its fix switches to, and that
  // leg's live status, so the fix never takes a train that's canceled or
  // skipping either end of it, and still counts a late one.
  const fixLeg = useMemo(
    () =>
      boardingCheck.warning &&
      correctedLeg(boardingCheck.warning, focusRun.fromStation, focusRun.toStation),
    [boardingCheck.warning, focusRun],
  );
  const fixLegTrips = useMemo(
    () => (fixLeg ? getFilteredTrips(fixLeg.from, fixLeg.to, focusRun.scheduleType) : []),
    [fixLeg, focusRun.scheduleType],
  );
  const fixLegLive = useTripRealtimeStatusMap(
    fixLeg?.from ?? "",
    fixLeg?.to ?? "",
    fixLegTrips,
    focusRun.serviceDate.replace(/-/g, ""),
  );

  // Close the detail sheet we're inside and land on the full-page My Trip
  // view.
  const openMyTrip = () => {
    setSelectedTrip(null);
    openTripView();
  };

  // Focus `run` (leaving at `runDepartureAt`) as the rider's trip.
  const focusAndOpen = (run: FocusedRun, runDepartureAt: number) => {
    // focusTrip commits the new focus synchronously, so My Trip renders the
    // new trip, not the previous one.
    void focusTrip(run);
    openMyTrip();
    // Then pop the reminder modal (hosted at the app root, so it survives this
    // sheet unmounting and the route change). Skip where notifications aren't
    // supported, or when there's too little lead left to schedule a useful
    // reminder — there's nothing worth configuring in either case. Focusing
    // itself is still allowed right up to arrival.
    if (
      isReminderSupported() &&
      !reminderLeadRange(runDepartureAt, currentTime.getTime()).tooLate
    ) {
      openReminderDialog();
    }
  };

  // Gate the reminder modal on the departure of the run being focused (its
  // boarding station), the same instant the modal itself counts down to.
  const doFocus = () =>
    focusAndOpen(focusRun, focusRunDepartureAt ?? reminderDepartureAt);

  const proceedWithGo = () => {
    if (isOtherTripFocused) setConfirmSwitch(true);
    else doFocus();
  };

  // "Swap stations" / "Leave from …" on the location warning: correct the
  // selected stations, then take the matching train on the corrected leg (the
  // same one when it serves it, else the one closest to this train's time —
  // see replacementRun) the way "Take this train" does, minus the "switch
  // trains?" prompt: the rider has just picked a train twice over. No train to
  // take → say the stations changed and to pick a time, and only switch them
  // as that notice closes (switching rebuilds the home schedule, unmounting
  // this sheet and the notice with it).
  const switchStations = (leg: { from: Station; to: Station }) => {
    setFromStation(leg.from);
    setToStation(leg.to);
  };
  const fixAndFocus = (leg: { from: Station; to: Station }) => {
    boardingCheck.dismiss();
    const next = replacementRun(focusRun, leg.from, leg.to, currentTime.getTime(), {
      target: focusRunDepartureAt ?? undefined,
      liveStatus: (trip) => findRealtimeStatus(fixLegLive, trip),
    });
    if (!next) {
      setNoTrainLeg(leg);
      return;
    }
    switchStations(leg);
    // Already the rider's trip: re-focusing it would drop its reminder.
    if (sameFocusIdentity(focusedTrip, next.run)) openMyTrip();
    else focusAndOpen(next.run, next.departureAt);
  };

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
    <ConfirmDialog
      title={t("focusedTrip.switchTitle")}
      description={t("focusedTrip.switchBody", {
        current: focusedTrip?.tripNumber,
        next: tripNumber,
      })}
      secondaryLabel={t("focusedTrip.switchCancel")}
      onSecondary={() => setConfirmSwitch(false)}
      primaryLabel={t("focusedTrip.switchConfirm")}
      onPrimary={() => {
        setConfirmSwitch(false);
        doFocus();
      }}
      onDismiss={() => setConfirmSwitch(false)}
    />
  ) : null;

  // A focused trip's status — the reminder countdown, Add-reminder, and
  // Cancel — all live on the full-page My Trip view, so the sheet just links
  // there. (The live-drift reschedule effect above still runs while the sheet
  // is open.) Not focused → the "Go" button below.
  if (isThisTripFocused) {
    return (
      <GutterRow>
        <Button
          onClick={openMyTrip}
          className="flex-1 h-12 gap-2 rounded-xl text-base font-semibold bg-my-trip-background text-white shadow-sm hover:bg-my-trip-background/90 active:bg-my-trip-background/90"
        >
          <TripIcon className="h-5 w-5" aria-hidden="true" />
          <span className="flex-1 text-left">{t("myTrip.view")}</span>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      </GutterRow>
    );
  }

  // "Going" means going somewhere — require a selected journey (origin +
  // destination). Without one (e.g. tapping a train on the line map before
  // planning a trip) there's no real destination to focus, so hide Go.
  if (!homeFromStation || !homeToStation) return null;
  // Offer "Go" right up until the trip actually finishes. Focusing ("I'm
  // taking this train") doesn't need lead time — unlike the reminder modal
  // (see focusAndOpen) — so it must NOT be gated on that, or the user couldn't
  // re-focus a train shortly before departure (e.g. after tapping Stop).
  if (arrivalAt <= Date.now()) return null;
  return (
    <GutterRow>
      <Button
        onClick={() => void boardingCheck.guard(proceedWithGo)}
        aria-label={t("focusedTrip.go")}
        aria-busy={boardingCheck.checking}
        className="flex-1 h-12 gap-2 rounded-xl text-base font-semibold bg-[hsl(220_13%_18%)] text-white shadow-sm hover:bg-[hsl(220_13%_18%)]/90 active:bg-[hsl(220_13%_18%)]/90"
      >
        {boardingCheck.checking ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <TripIcon className="h-5 w-5" aria-hidden="true" />
        )}
        <span>{t("focusedTrip.go")}</span>
      </Button>
      {switchDialog}
      {boardingCheck.warning && fixLeg && (
        <BoardingLocationDialog
          warning={boardingCheck.warning}
          fromStation={focusRun.fromStation}
          toStation={focusRun.toStation}
          onFix={() => fixAndFocus(fixLeg)}
          onContinue={() => {
            boardingCheck.dismiss();
            proceedWithGo();
          }}
          onCancel={boardingCheck.dismiss}
        />
      )}
      {noTrainLeg && (
        <StationsUpdatedNotice
          fromStation={noTrainLeg.from}
          toStation={noTrainLeg.to}
          onClose={() => {
            setNoTrainLeg(null);
            switchStations(noTrainLeg);
            onClose();
          }}
        />
      )}
    </GutterRow>
  );
}
