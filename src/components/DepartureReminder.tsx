import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, BellRing, X } from "lucide-react";
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

  /** Need at least 2 minutes so the slider has a non-degenerate range. */
  const tooLateToSchedule = minutesUntilDeparture < 2;

  const [sliderValue, setSliderValue] = useState(() =>
    Math.min(DEFAULT_LEAD_MINUTES, Math.max(1, maxLeadMinutes))
  );

  /** Clamp at render time so a long-open picker can't submit a value that
   *  drifted past the shrinking max as currentTime ticked forward. */
  const clampedSliderValue = Math.min(sliderValue, maxLeadMinutes);

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

  const openPicker = useCallback(() => {
    setSliderValue(Math.min(DEFAULT_LEAD_MINUTES, maxLeadMinutes));
    setPickerError(null);
    setPickerOpen(true);
  }, [maxLeadMinutes]);

  const handleSet = useCallback(async () => {
    const result = await setReminderForLead(
      clampedSliderValue,
      buildText(clampedSliderValue),
    );
    if (result.ok === false) {
      setPickerError(result.reason);
      return;
    }
    closePicker();
  }, [buildText, clampedSliderValue, closePicker, setReminderForLead]);

  // Wait for the picker to finish its exit animation before swapping in the
  // active pill — otherwise the picker would pop out and the pill pop in
  // simultaneously, defeating the smooth transition.
  if (reminder && !pickerMounted) {
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
            <button
              type="button"
              onClick={() => void cancel()}
              aria-label={t("departureReminder.cancel")}
              className="h-8 w-8 -mr-1 flex items-center justify-center rounded-md hover:bg-accent active:bg-accent"
            >
              <X
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </GutterRow>
    );
  }

  if (departureAt <= Date.now() || tooLateToSchedule) return null;

  if (!pickerMounted) {
    return (
      <GutterRow>
        <Button
          variant="outline"
          size="sm"
          onClick={openPicker}
          aria-label={t("departureReminder.setReminder")}
          className="h-9 gap-1.5"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("departureReminder.setReminder")}</span>
        </Button>
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

        <div className="px-1 space-y-1.5">
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
