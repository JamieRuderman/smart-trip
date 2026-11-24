import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Minus, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { focusedBoardingInstant, type FocusedTrip } from "@/lib/focusedTrip";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { MIN_LEAD_MINUTES, reminderLeadRange } from "@/lib/reminderLead";
import { buildReminderText } from "@/lib/reminderText";
import { formatClockTime } from "@/lib/timeUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { WalkIcon } from "./icons/WalkIcon";

const QUICK_LEADS = [5, 10, 15, 30];
/** Stepper taps are batched so a run of taps reschedules the alarm once. */
const COMMIT_DELAY_MS = 700;
const CLOSE_TO_DEPARTURE_MINUTES = 3;

interface ReminderControlProps {
  focusedTrip: FocusedTrip;
  trip: ProcessedTrip;
  live: TripRealtimeStatus | null;
  /** Minutes until the (live-aware) departure; negative once departed. */
  minutesUntil: number;
  isCanceledOrSkipped: boolean;
  /** The run is on a later day — its countdown is day-relative, not live. */
  isFutureService: boolean;
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

type ReminderError = null | "permission" | "schedule-failed";

/**
 * The focused trip's leave reminder, inline on the My Trip band (white on
 * blue/gold): quick lead chips while none is set, then the alarm time with a
 * one-minute stepper. Renders nothing when no reminder applies.
 */
export function ReminderControl({
  focusedTrip,
  trip,
  live,
  minutesUntil,
  isCanceledOrSkipped,
  isFutureService,
  currentTime,
  timeFormat,
}: ReminderControlProps) {
  const { t, i18n } = useTranslation();
  const { setReminder } = useStationSelection();

  const departureAt = useMemo(
    () => focusedBoardingInstant(focusedTrip, live?.liveDepartureTime),
    [focusedTrip, live?.liveDepartureTime],
  );
  const byFerry = trip.inboundFerry != null;
  const { maxLeadMinutes, tooLate } = reminderLeadRange(
    departureAt ?? 0,
    currentTime.getTime(),
  );

  const reminder = focusedTrip.reminder;
  const reminderFired = reminder?.firedAt != null;
  const storedLead = reminder && !reminderFired ? reminder.leadMinutes : null;

  const [pendingLead, setPendingLead] = useState<number | null>(null);
  const [error, setError] = useState<ReminderError>(null);
  const commitTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
  }, []);

  const commit = useCallback(
    async (lead: number | null) => {
      if (departureAt == null) return;
      const text = buildReminderText(t, i18n.language, {
        leadMinutes: lead ?? 0,
        departureAt,
        fromStation: focusedTrip.fromStation,
        tripNumber: focusedTrip.tripNumber,
        byFerry,
        timeFormat,
      });
      const result = await setReminder(lead, departureAt, text);
      setPendingLead(null);
      if (result.ok === false && result.reason !== "no-focus") {
        setError(result.reason === "permission" ? "permission" : "schedule-failed");
      } else {
        setError(null);
      }
    },
    [byFerry, departureAt, focusedTrip, i18n.language, setReminder, t, timeFormat],
  );

  const scheduleCommit = (lead: number) => {
    setPendingLead(lead);
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      void commit(lead);
    }, COMMIT_DELAY_MS);
  };

  const canSetReminder =
    departureAt != null &&
    !isCanceledOrSkipped &&
    isReminderSupported() &&
    !tooLate &&
    (isFutureService || minutesUntil >= 2);

  const errorMessage =
    error === "permission"
      ? t("departureReminder.permissionDenied")
      : error === "schedule-failed"
        ? t("departureReminder.scheduleFailed")
        : null;
  const errorLine = errorMessage && (
    <p className="mt-1.5 text-xs text-white/90" role="alert">
      {errorMessage}
    </p>
  );

  // The alarm went off and the train hasn't left yet.
  if (reminderFired && !isCanceledOrSkipped && !isFutureService && minutesUntil >= 0) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg bg-white/25 px-3 text-sm font-semibold text-white">
        <WalkIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("departureReminder.timeToLeave")}</span>
      </div>
    );
  }

  const lead = pendingLead ?? storedLead;
  if (lead != null && departureAt != null) {
    const shownLead = Math.min(lead, maxLeadMinutes);
    const alarmAt = departureAt - shownLead * 60_000;
    const stepperButton =
      "flex size-8 shrink-0 items-center justify-center rounded-md bg-white/15 text-white transition-colors hover:bg-white/25 disabled:opacity-40";
    return (
      <div>
        <div className="flex h-10 items-center gap-2 rounded-lg bg-white/15 pl-3 pr-1 text-sm text-white">
          <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium tabular-nums">
            {t("departureReminder.remindAt", {
              time: formatClockTime(alarmAt, timeFormat, i18n.language),
            })}
          </span>
          {canSetReminder && (
            <>
              <button
                type="button"
                className={stepperButton}
                onClick={() => scheduleCommit(shownLead - 1)}
                disabled={shownLead <= MIN_LEAD_MINUTES}
                aria-label={t("departureReminder.lessLead")}
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span
                className="w-14 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {t("departureReminder.minutesValue", { count: shownLead })}
              </span>
              <button
                type="button"
                className={stepperButton}
                onClick={() => scheduleCommit(shownLead + 1)}
                disabled={shownLead >= maxLeadMinutes}
                aria-label={t("departureReminder.moreLead")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15"
            onClick={() => {
              if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
              commitTimer.current = null;
              void commit(null);
            }}
            aria-label={t("departureReminder.cancel")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {shownLead <= CLOSE_TO_DEPARTURE_MINUTES && (
          <p className="mt-1.5 text-xs text-white/90">
            {t(byFerry ? "departureReminder.ferryWarningBody" : "departureReminder.warningBody", {
              count: shownLead,
            })}
          </p>
        )}
        {errorLine}
      </div>
    );
  }

  if (!canSetReminder) return null;

  const choices = QUICK_LEADS.filter((m) => m <= maxLeadMinutes);
  if (choices.length === 0) choices.push(maxLeadMinutes);

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-white">
        <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">{t("departureReminder.remindMe")}</span>
      </div>
      <div className="mt-2 flex gap-2">
        {choices.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setPendingLead(m);
              void commit(m);
            }}
            className="h-9 flex-1 rounded-lg bg-white/15 text-sm font-semibold text-white tabular-nums transition-colors hover:bg-white/25"
          >
            {t("departureReminder.minutesValue", { count: m })}
          </button>
        ))}
      </div>
      {errorLine}
    </div>
  );
}
