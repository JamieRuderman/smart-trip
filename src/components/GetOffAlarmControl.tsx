import { useState } from "react";
import { MapPinCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FocusedTrip } from "@/lib/focusedTrip";
import {
  buildGetOffAlarmText,
  canScheduleGetOffAlarm,
  clearGetOffAlarm,
  getOffAlarmTiming,
  setGetOffAlarm,
} from "@/lib/getOffAlarm";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { formatClockTime } from "@/lib/timeUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

interface GetOffAlarmControlProps {
  focusedTrip: FocusedTrip;
  live: TripRealtimeStatus | null;
  isCanceledOrSkipped: boolean;
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

/** The optional alarm one stop before the rider's, inline on the My Trip band
 *  under the leave reminder. Renders nothing once it has rung or can't be set. */
export function GetOffAlarmControl({
  focusedTrip,
  live,
  isCanceledOrSkipped,
  currentTime,
  timeFormat,
}: GetOffAlarmControlProps) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<null | "permission" | "schedule-failed">(null);
  const [busy, setBusy] = useState(false);

  const timing = getOffAlarmTiming(focusedTrip, live);
  const armed = focusedTrip.getOffAlarm;
  const now = currentTime.getTime();

  const canSet =
    timing != null &&
    !isCanceledOrSkipped &&
    isReminderSupported() &&
    canScheduleGetOffAlarm(timing.fireAt, now);
  if (armed ? armed.reminderAt <= now : !canSet) return null;
  const ringsAt = armed?.reminderAt ?? timing!.fireAt;

  const arm = async () => {
    if (!timing || !canScheduleGetOffAlarm(timing.fireAt, Date.now())) return;
    setBusy(true);
    const result = await setGetOffAlarm(
      focusedTrip,
      timing.fireAt,
      buildGetOffAlarmText(t, i18n.language, {
        toStation: focusedTrip.toStation,
        tripNumber: focusedTrip.tripNumber,
        arrivalAt: timing.arrivalAt,
      }),
    );
    setBusy(false);
    setError(result.ok || result.reason === "no-focus" ? null : result.reason);
  };

  const disarm = async () => {
    setBusy(true);
    await clearGetOffAlarm(focusedTrip);
    setBusy(false);
    setError(null);
  };

  return (
    <div className="space-y-2 [&:not(:first-child)]:mt-2">
      <div className="flex h-[52px] items-center gap-3 overflow-hidden rounded-lg bg-white/15 pl-3 pr-1.5 text-white">
        <MapPinCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">
            {t(armed ? "getOffAlarm.on" : "getOffAlarm.label")}
          </p>
          <p className="truncate text-xs text-white/80 tabular-nums">
            {t("getOffAlarm.ringsAt", {
              time: formatClockTime(ringsAt, timeFormat, i18n.language),
            })}
          </p>
        </div>
        {armed ? (
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
            onClick={() => void disarm()}
            disabled={busy}
            aria-label={t("getOffAlarm.cancel")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="h-9 shrink-0 rounded-md bg-white px-3 text-sm font-semibold text-my-trip-background transition-colors hover:bg-white/90"
            onClick={() => void arm()}
            disabled={busy}
          >
            {t("departureReminder.set")}
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-white/90" role="alert">
          {t(
            error === "permission"
              ? "departureReminder.permissionDenied"
              : "departureReminder.scheduleFailed",
          )}
        </p>
      )}
    </div>
  );
}
