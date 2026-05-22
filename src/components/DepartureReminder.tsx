import { useCallback, useMemo, useState } from "react";
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
import { logger } from "@/lib/logger";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { GutterRow } from "./GutterRow";

const QUICK_LEAD_MINUTES = [5, 10, 15, 20, 25, 30, 45, 60] as const;
const MAX_CUSTOM_MINUTES = 1440;

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

function buildDepartureTimestamp(currentTime: Date, hhmm: string): number {
  const minutes = parseTimeToMinutes(hhmm);
  const d = new Date(currentTime);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

function formatClockTime(epoch: number, timeFormat: "12h" | "24h"): string {
  return new Date(epoch).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
}

export function DepartureReminder({
  tripNumber,
  fromStation,
  toStation,
  departureTime,
  liveDepartureTime,
  currentTime,
  timeFormat,
}: DepartureReminderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);

  const effectiveTime = liveDepartureTime ?? departureTime;
  const departureAt = useMemo(
    () => buildDepartureTimestamp(currentTime, effectiveTime),
    [currentTime, effectiveTime]
  );

  const { reminder, setReminderForLead, cancel } = useDepartureReminder({
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
        time: formatClockTime(departureAt, timeFormat),
        trip: tripNumber,
      }),
    }),
    [departureAt, fromStation, t, timeFormat, tripNumber]
  );

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setShowCustom(false);
    setCustomInput("");
    setPermissionDenied(false);
  }, []);

  const handlePick = useCallback(
    async (leadMinutes: number) => {
      if (!Number.isFinite(leadMinutes) || leadMinutes <= 0) return;
      const result = await setReminderForLead(leadMinutes, buildText(leadMinutes));
      if (!result.granted) {
        setPermissionDenied(true);
        logger.warn("Notification permission not granted");
        return;
      }
      closeMenu();
    },
    [buildText, closeMenu, setReminderForLead]
  );

  const handleCustomSubmit = useCallback(() => {
    const minutes = parseInt(customInput, 10);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_CUSTOM_MINUTES) {
      return;
    }
    void handlePick(minutes);
  }, [customInput, handlePick]);

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
                time: formatClockTime(reminder.reminderAt, timeFormat),
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
            setPermissionDenied(false);
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
                inputMode="numeric"
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
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
                disabled={!customInput}
              >
                {t("departureReminder.set")}
              </Button>
            </div>
          )}
          {permissionDenied && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs text-destructive">
                {t("departureReminder.permissionDenied")}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </GutterRow>
  );
}
