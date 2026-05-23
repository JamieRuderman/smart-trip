import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, BellOff, BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useDepartureReminder } from "@/hooks/useDepartureReminder";
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

type PickerError = null | "permission" | "schedule-failed";

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
  const [pickerError, setPickerError] = useState<PickerError>(null);

  const effectiveTime = liveDepartureTime ?? departureTime;
  const departureAt = useMemo(
    () => buildDepartureTimestamp(currentTime, effectiveTime),
    [currentTime, effectiveTime]
  );

  const minutesUntilDeparture = useMemo(
    () => Math.floor((departureAt - currentTime.getTime()) / 60_000),
    [currentTime, departureAt]
  );

  /** Maximum lead time we'll allow: leave at least 1 minute between the
   *  reminder firing and the train's departure. */
  const maxLeadMinutes = Math.max(
    1,
    Math.min(MAX_LEAD_MINUTES, minutesUntilDeparture - 1)
  );

  /** Less than 2 minutes left: even a 1-minute reminder rounds to "now". */
  const tooLateToSchedule = minutesUntilDeparture < 2;

  const [sliderValue, setSliderValue] = useState(() =>
    Math.min(DEFAULT_LEAD_MINUTES, Math.max(1, maxLeadMinutes))
  );

  // As time ticks, the window shrinks. Clamp the slider down so it never
  // exceeds the current max — otherwise a long-open picker could submit a
  // value that's now in the past.
  useEffect(() => {
    if (sliderValue > maxLeadMinutes) {
      setSliderValue(maxLeadMinutes);
    }
  }, [maxLeadMinutes, sliderValue]);

  // Reset slider to a sensible default each time the picker re-opens.
  useEffect(() => {
    if (pickerOpen) {
      setSliderValue(Math.min(DEFAULT_LEAD_MINUTES, maxLeadMinutes));
      setPickerError(null);
    }
  }, [maxLeadMinutes, pickerOpen]);

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
  // so it fires the right number of minutes before the actual train.
  useEffect(() => {
    if (!reminder) return;
    if (reminder.departureAt === departureAt) return;
    void reschedule(buildText(reminder.leadMinutes));
  }, [buildText, departureAt, reminder, reschedule]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerError(null);
  }, []);

  const handleSet = useCallback(async () => {
    const result = await setReminderForLead(sliderValue, buildText(sliderValue));
    if (result.ok === false) {
      setPickerError(result.reason);
      return;
    }
    closePicker();
  }, [buildText, closePicker, setReminderForLead, sliderValue]);

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

  if (departureAt <= Date.now() || tooLateToSchedule) return null;

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

  // sliderValue is the lead time — how many minutes before the train the
  // reminder fires. A small lead means the alarm fires close to the train's
  // departure, leaving little time to actually leave; that's the warning
  // case (analogous to the ferry quick-transfer warning).
  const isCloseToDeparture = sliderValue <= CLOSE_TO_DEPARTURE_THRESHOLD;
  const alarmAt = departureAt - sliderValue * 60_000;
  const alarmAtLabel = formatClockTime(alarmAt, timeFormat, i18n.language);

  const errorMessage =
    pickerError === "permission"
      ? t("departureReminder.permissionDenied")
      : pickerError === "schedule-failed"
        ? t("departureReminder.scheduleFailed")
        : null;

  return (
    <GutterRow>
      <div className="flex-1 min-w-0 rounded-lg bg-muted/40 p-3 space-y-3">
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
            {t("departureReminder.minutesValue", { count: sliderValue })}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t("departureReminder.beforeDeparture")}
          </div>
          <div className="text-sm text-foreground/70 mt-1.5 tabular-nums">
            {t("departureReminder.alarmAt", { time: alarmAtLabel })}
          </div>
        </div>

        <div className="px-1 space-y-1.5">
          <Slider
            value={[sliderValue]}
            min={1}
            max={maxLeadMinutes}
            step={1}
            onValueChange={(values) => {
              const next = values[0];
              if (typeof next === "number") setSliderValue(next);
            }}
            aria-label={t("departureReminder.label")}
            aria-valuetext={t("departureReminder.minutesValue", {
              count: sliderValue,
            })}
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
                {t("departureReminder.warningBody", { count: sliderValue })}
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
