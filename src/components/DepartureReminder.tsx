import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDepartureReminder } from "@/hooks/useDepartureReminder";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { GutterRow } from "./GutterRow";

const QUICK_LEAD_MINUTES = [5, 10, 15, 20, 25, 30, 45, 60] as const;
const MAX_CUSTOM_MINUTES = 1440;
const INTEGER_MINUTES_RE = /^\d+$/;

interface DepartureReminderProps {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  /** Scheduled departure time as "HH:MM". */
  departureTime: string;
  /** Live override; takes precedence over the scheduled time when set. */
  liveDepartureTime?: string | null;
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

type PickerError = null | "permission" | "schedule-failed" | "custom-invalid";

export function DepartureReminder({
  tripNumber,
  fromStation,
  toStation,
  departureTime,
  liveDepartureTime,
  currentTime,
  timeFormat,
}: DepartureReminderProps) {
  const { t, i18n } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [pickerError, setPickerError] = useState<PickerError>(null);

  const effectiveTime = liveDepartureTime ?? departureTime;
  const departureAt = useMemo(
    () => buildDepartureTimestamp(currentTime, effectiveTime),
    [currentTime, effectiveTime]
  );

  const { reminder, setReminderForLead, reschedule, cancel } =
    useDepartureReminder({
      tripNumber,
      fromStation,
      toStation,
      scheduledDepartureTime: departureTime,
      departureAt,
    });

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

  // Live-departure drift: when a delay (or correction) shifts departureAt
  // and we already have a scheduled reminder, re-arm it under the same id
  // so it fires the right number of minutes before the actual train and
  // displays the updated time in the body.
  useEffect(() => {
    if (!reminder) return;
    if (reminder.departureAt === departureAt) return;
    void reschedule(buildText(reminder.leadMinutes));
  }, [buildText, departureAt, reminder, reschedule]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setShowCustom(false);
    setCustomInput("");
    setPickerError(null);
  }, []);

  const handlePick = useCallback(
    async (leadMinutes: number) => {
      if (!Number.isFinite(leadMinutes) || leadMinutes <= 0) return;
      const result = await setReminderForLead(leadMinutes, buildText(leadMinutes));
      if (result.ok === false) {
        setPickerError(result.reason);
        return;
      }
      closePicker();
    },
    [buildText, closePicker, setReminderForLead]
  );

  const parseCustomMinutes = useCallback((value: string): number | null => {
    const trimmed = value.trim();
    if (!INTEGER_MINUTES_RE.test(trimmed)) return null;
    const minutes = Number(trimmed);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_CUSTOM_MINUTES) {
      return null;
    }
    return minutes;
  }, []);

  const customMinutes = parseCustomMinutes(customInput);

  const handleCustomSubmit = useCallback(() => {
    if (customMinutes == null) {
      setPickerError("custom-invalid");
      return;
    }
    void handlePick(customMinutes);
  }, [customMinutes, handlePick]);

  const departureInPast = departureAt <= Date.now();

  if (reminder) {
    return (
      <GutterRow className="text-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-foreground">
            <BellRing
              className="h-4 w-4 text-primary shrink-0"
              aria-hidden="true"
            />
            <span>
              {t("departureReminder.activeAt", {
                time: formatClockTime(
                  reminder.reminderAt,
                  timeFormat,
                  i18n.language
                ),
                leadMinutes: reminder.leadMinutes,
              })}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void cancel()}
            aria-label={t("departureReminder.cancel")}
            className="h-8 px-2 text-xs gap-1"
          >
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            {t("departureReminder.cancel")}
          </Button>
        </div>
      </GutterRow>
    );
  }

  if (departureInPast) return null;

  if (!pickerOpen) {
    return (
      <GutterRow>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen(true)}
          aria-label={t("departureReminder.setReminder")}
          className="h-9 gap-1.5"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("departureReminder.setReminder")}</span>
        </Button>
      </GutterRow>
    );
  }

  const errorMessage =
    pickerError === "permission"
      ? t("departureReminder.permissionDenied")
      : pickerError === "schedule-failed"
        ? t("departureReminder.scheduleFailed")
        : pickerError === "custom-invalid"
          ? t("departureReminder.customInvalid", { max: MAX_CUSTOM_MINUTES })
          : null;

  return (
    <GutterRow>
      <div className="flex-1 min-w-0 rounded-lg border border-input bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium flex items-center gap-1.5">
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

        <div className="grid grid-cols-4 gap-2">
          {QUICK_LEAD_MINUTES.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant="outline"
              onClick={() => void handlePick(minutes)}
              className="h-11 px-0 text-sm font-medium"
            >
              {t("departureReminder.minutesChip", { count: minutes })}
            </Button>
          ))}
        </div>

        {!showCustom ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowCustom(true)}
            className="w-full h-10 text-sm"
          >
            {t("departureReminder.custom")}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={MAX_CUSTOM_MINUTES}
              step={1}
              inputMode="numeric"
              value={customInput}
              onChange={(event) => {
                setCustomInput(event.target.value);
                setPickerError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCustomSubmit();
                }
              }}
              placeholder={t("departureReminder.customPlaceholder")}
              className="flex-1 h-11 rounded-md border border-input bg-background px-3 text-base"
              aria-label={t("departureReminder.customPlaceholder")}
              autoFocus
            />
            <Button
              type="button"
              onClick={handleCustomSubmit}
              disabled={customMinutes == null}
              className="h-11 px-4"
            >
              {t("departureReminder.set")}
            </Button>
          </div>
        )}

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
