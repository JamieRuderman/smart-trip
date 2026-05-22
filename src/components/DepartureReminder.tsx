import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * Build an epoch timestamp for a train's HH:MM departure, anchored to the
 * nearest *future* occurrence. If the train's HH:MM is earlier in the day
 * than `currentTime`, treat it as tomorrow's departure (e.g. a 00:15 train
 * viewed at 23:55). Without this, late-night/early-morning trips would
 * compute to a 24-hour-old timestamp and the reminder UI would disappear.
 */
function buildDepartureTimestamp(currentTime: Date, hhmm: string): number {
  const minutes = parseTimeToMinutes(hhmm);
  const d = new Date(currentTime);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d.getTime() < currentTime.getTime()) {
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

type MenuError = null | "permission" | "schedule-failed" | "custom-invalid";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [menuError, setMenuError] = useState<MenuError>(null);

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

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setShowCustom(false);
    setCustomInput("");
    setMenuError(null);
  }, []);

  const handlePick = useCallback(
    async (leadMinutes: number) => {
      if (!Number.isFinite(leadMinutes) || leadMinutes <= 0) return;
      const result = await setReminderForLead(leadMinutes, buildText(leadMinutes));
      if (result.ok === false) {
        setMenuError(result.reason);
        return;
      }
      closeMenu();
    },
    [buildText, closeMenu, setReminderForLead]
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
      setMenuError("custom-invalid");
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
            className="h-7 px-2 text-xs gap-1"
          >
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            {t("departureReminder.cancel")}
          </Button>
        </div>
      </GutterRow>
    );
  }

  if (departureInPast) return null;

  return (
    <GutterRow>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) {
            setShowCustom(false);
            setCustomInput("");
            setMenuError(null);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            aria-label={t("departureReminder.setReminder")}
          >
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("departureReminder.setReminder")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>{t("departureReminder.label")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {QUICK_LEAD_MINUTES.map((minutes) => (
            <DropdownMenuItem
              key={minutes}
              onSelect={(event) => {
                event.preventDefault();
                void handlePick(minutes);
              }}
            >
              {t("departureReminder.minutesBefore", { count: minutes })}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {!showCustom ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setShowCustom(true);
              }}
            >
              {t("departureReminder.custom")}
            </DropdownMenuItem>
          ) : (
            <div className="px-2 py-1.5 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={MAX_CUSTOM_MINUTES}
                step={1}
                inputMode="numeric"
                value={customInput}
                onChange={(event) => {
                  setCustomInput(event.target.value);
                  setMenuError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCustomSubmit();
                  }
                }}
                placeholder={t("departureReminder.customPlaceholder")}
                className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                aria-label={t("departureReminder.customPlaceholder")}
                autoFocus
              />
              <Button
                size="sm"
                className="h-7 px-2"
                onClick={handleCustomSubmit}
                disabled={customMinutes == null}
              >
                {t("departureReminder.set")}
              </Button>
            </div>
          )}
          {menuError && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs text-destructive">
                {menuError === "permission"
                  ? t("departureReminder.permissionDenied")
                  : menuError === "schedule-failed"
                    ? t("departureReminder.scheduleFailed")
                    : t("departureReminder.customInvalid", {
                        max: MAX_CUSTOM_MINUTES,
                      })}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </GutterRow>
  );
}
