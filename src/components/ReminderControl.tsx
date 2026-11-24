import { useCallback, useMemo, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { focusedBoardingInstant, type FocusedTrip } from "@/lib/focusedTrip";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { MIN_LEAD_MINUTES, reminderLeadRange } from "@/lib/reminderLead";
import { buildReminderText } from "@/lib/reminderText";
import { formatClockTime } from "@/lib/timeUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { WheelPicker } from "./ui/wheel-picker";
import { WalkIcon } from "./icons/WalkIcon";

const DEFAULT_LEAD_MINUTES = 15;
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
 * blue/gold): a minute wheel with "Set", then the armed alarm with × to remove
 * it. Renders nothing when no reminder applies.
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
    [focusedTrip, live?.liveDepartureTime]
  );
  const byFerry = trip.inboundFerry != null;
  const { maxLeadMinutes, tooLate } = reminderLeadRange(
    departureAt ?? 0,
    currentTime.getTime()
  );

  const reminder = focusedTrip.reminder;
  const reminderFired = reminder?.firedAt != null;
  const storedLead = reminder && !reminderFired ? reminder.leadMinutes : null;

  const [draftLead, setDraftLead] = useState(DEFAULT_LEAD_MINUTES);
  const [error, setError] = useState<ReminderError>(null);

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
      if (result.ok === false && result.reason !== "no-focus") {
        setError(
          result.reason === "permission" ? "permission" : "schedule-failed"
        );
      } else {
        setError(null);
      }
    },
    [
      byFerry,
      departureAt,
      focusedTrip,
      i18n.language,
      setReminder,
      t,
      timeFormat,
    ]
  );

  const canSetReminder =
    departureAt != null &&
    !isCanceledOrSkipped &&
    isReminderSupported() &&
    !tooLate &&
    (isFutureService || minutesUntil >= 2);

  // The alarm went off and the train hasn't left yet.
  const timeToGo = reminderFired &&
    !isCanceledOrSkipped &&
    !isFutureService &&
    minutesUntil >= 0 && (
      <div className="flex h-10 items-center gap-2 rounded-lg bg-white/25 px-3 text-sm font-semibold text-white">
        <WalkIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("departureReminder.timeToLeave")}</span>
      </div>
    );

  if (departureAt == null || (storedLead == null && !canSetReminder)) {
    return timeToGo || null;
  }

  const isSet = storedLead != null;
  const lead = Math.min(isSet ? storedLead : draftLead, maxLeadMinutes);
  const alarmAt = departureAt - lead * 60_000;
  const minutes = (count: number) =>
    t("departureReminder.minutesValue", { count });

  const errorMessage =
    error === "permission"
      ? t("departureReminder.permissionDenied")
      : error === "schedule-failed"
      ? t("departureReminder.scheduleFailed")
      : null;

  return (
    <div className="space-y-2">
      {timeToGo}
      <div className="flex h-[52px] items-center gap-3 overflow-hidden rounded-lg bg-white/15 pl-3 pr-1.5 text-white">
        <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">
            {t(
              isSet
                ? "departureReminder.reminderOn"
                : "departureReminder.remindMe"
            )}
          </p>
          <p className="truncate text-xs text-white/80 tabular-nums">
            {t("departureReminder.atTime", {
              time: formatClockTime(alarmAt, timeFormat, i18n.language),
            })}
          </p>
        </div>
        {!isSet ? (
          <WheelPicker
            min={MIN_LEAD_MINUTES}
            max={maxLeadMinutes}
            value={lead}
            onChange={setDraftLead}
            format={minutes}
            ariaLabel={t("departureReminder.minutesBeforeDeparture")}
            className="w-[7rem]"
            rowHeight={26}
            height={52}
            neighborOffset={3}
            stepLabels={{
              previous: t("departureReminder.lessLead"),
              next: t("departureReminder.moreLead"),
            }}
          />
        ) : (
          <span className="rounded-md bg-white/20 px-3 py-1 text-base font-semibold tabular-nums">
            {minutes(lead)}
          </span>
        )}
        {isSet ? (
          <button
            type="button"
            className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
            onClick={() => void commit(null)}
            aria-label={t("departureReminder.cancel")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="h-9 shrink-0 rounded-md bg-white px-3 text-sm font-semibold text-my-trip-background transition-colors hover:bg-white/90"
            onClick={() => void commit(lead)}
          >
            {t("departureReminder.set")}
          </button>
        )}
      </div>
      {lead <= CLOSE_TO_DEPARTURE_MINUTES && (
        <p className="text-xs text-white/90">
          {t(
            byFerry
              ? "departureReminder.ferryWarningBody"
              : "departureReminder.warningBody",
            {
              count: lead,
            }
          )}
        </p>
      )}
      {errorMessage && (
        <p className="text-xs text-white/90" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
