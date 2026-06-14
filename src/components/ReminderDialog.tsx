import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useStationSelection } from "@/contexts/stationSelection";
import { DEFAULT_LEAD_MINUTES, reminderLeadRange } from "@/lib/reminderLead";
import { cn } from "@/lib/utils";
import type { Station } from "@/types/smartSchedule";

/** Show the "close to departure" warning when the reminder fires within this
 *  many minutes of the train's actual departure. */
const CLOSE_TO_DEPARTURE_THRESHOLD = 3;

interface ReminderDialogProps {
  open: boolean;
  onClose: () => void;
  /** Live-anchored departure instant of the focused trip's boarding station. */
  departureAt: number;
  /** Boarding station, named in the notification copy. */
  fromStation: Station;
  tripNumber: number;
  currentTime: Date;
  timeFormat: "12h" | "24h";
  /** Lead of an already-armed reminder when editing: the slider opens at this
   *  value (clamped) and the footer offers "Cancel reminder". Null when arming
   *  a new one (opens at the default suggestion). */
  currentLeadMinutes?: number | null;
}

function formatClockTime(
  epoch: number,
  timeFormat: "12h" | "24h",
  locale: string,
): string {
  return new Date(epoch).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
}

type ReminderError = null | "permission" | "schedule-failed";

/**
 * Centered modal for choosing a departure-reminder lead time. Popped after the
 * user taps "Take this train" (and the detail sheet closes) or from the home
 * card's "Add reminder" — so it always lands the user back on the home screen
 * with the pinned trip card, rather than leaving a sheet open behind it.
 *
 * Operates purely on the already-focused trip: the caller passes the live
 * boarding `departureAt`, and arming/clearing flows through the shared
 * focused-trip reminder API.
 */
export function ReminderDialog({
  open,
  onClose,
  departureAt,
  fromStation,
  tripNumber,
  currentTime,
  timeFormat,
  currentLeadMinutes = null,
}: ReminderDialogProps) {
  const { t, i18n } = useTranslation();
  const { setReminder } = useStationSelection();
  const isEditing = currentLeadMinutes != null;

  const { maxLeadMinutes, tooLate } = reminderLeadRange(
    departureAt,
    currentTime.getTime(),
  );

  const [leadMinutes, setLeadMinutes] = useState(DEFAULT_LEAD_MINUTES);
  const [error, setError] = useState<ReminderError>(null);

  // Seed the slider each time the modal opens, clamped to what's available:
  // when editing, open at the existing reminder's lead; otherwise at the default
  // suggestion (15 min, or the max if less remains). Intentionally keyed only on
  // `open` — maxLeadMinutes ticks down with currentTime and must not stomp the
  // user's drag mid-session.
  useEffect(() => {
    if (!open) return;
    setLeadMinutes(
      Math.min(currentLeadMinutes ?? DEFAULT_LEAD_MINUTES, maxLeadMinutes),
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clamp at render time so a long-open modal can't submit a value that drifted
  // past the shrinking max as currentTime ticked forward.
  const clamped = Math.min(leadMinutes, maxLeadMinutes);
  const isCloseToDeparture = clamped <= CLOSE_TO_DEPARTURE_THRESHOLD;
  const alarmAt = departureAt - clamped * 60_000;
  const alarmAtLabel = formatClockTime(alarmAt, timeFormat, i18n.language);

  const buildText = useCallback(
    (lead: number) => ({
      title: t("departureReminder.notificationTitle", { station: fromStation }),
      body: t("departureReminder.notificationBody", {
        leadMinutes: lead,
        station: fromStation,
        time: formatClockTime(departureAt, timeFormat, i18n.language),
        trip: tripNumber,
      }),
    }),
    [departureAt, fromStation, i18n.language, t, timeFormat, tripNumber],
  );

  const handleSet = useCallback(async () => {
    const result = await setReminder(clamped, departureAt, buildText(clamped));
    if (result.ok === false) {
      // "no-focus" means the focus was cleared out from under the modal (e.g.
      // the trip auto-cleared on arrival) — nothing to configure, so just close
      // rather than show a misleading error.
      if (result.reason === "no-focus") {
        onClose();
        return;
      }
      setError(result.reason === "permission" ? "permission" : "schedule-failed");
      return;
    }
    onClose();
  }, [buildText, clamped, departureAt, onClose, setReminder]);

  // Edit mode only: drop the armed reminder entirely.
  const handleRemove = useCallback(async () => {
    await setReminder(null, departureAt, buildText(0));
    onClose();
  }, [buildText, departureAt, onClose, setReminder]);

  const errorMessage =
    error === "permission"
      ? t("departureReminder.permissionDenied")
      : error === "schedule-failed"
        ? t("departureReminder.scheduleFailed")
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-left">
            <BellRing className="h-5 w-5 shrink-0 text-my-trip" aria-hidden="true" />
            {t("departureReminder.label")}
          </DialogTitle>
        </DialogHeader>

        {tooLate ? (
          // Train's too close: the lead range has collapsed to a single point,
          // so there's no meaningful reminder to offer. Explain why and let the
          // disabled "Set reminder" below carry the unavailable state.
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
                {t("departureReminder.tooLateTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("departureReminder.tooLateBody")}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center py-1">
              <div
                className={cn(
                  "text-4xl font-semibold tabular-nums leading-none",
                  isCloseToDeparture ? "text-smart-gold" : "text-foreground",
                )}
              >
                {t("departureReminder.minutesValue", { count: clamped })}
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
                value={[clamped]}
                min={1}
                max={maxLeadMinutes}
                step={1}
                onValueChange={(values) => {
                  const next = values[0];
                  if (typeof next === "number") setLeadMinutes(next);
                }}
                aria-label={t("departureReminder.label")}
                aria-valuetext={t("departureReminder.minutesValue", {
                  count: clamped,
                })}
                thumbLabel={t("departureReminder.label")}
                rangeClassName="bg-my-trip"
                thumbClassName="border-my-trip"
              />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{t("departureReminder.minutesValue", { count: 1 })}</span>
                <span>
                  {t("departureReminder.minutesValue", {
                    count: maxLeadMinutes,
                  })}
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
                    {t("departureReminder.warningBody", { count: clamped })}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {errorMessage && (
          <p className="text-xs text-destructive" role="alert" aria-live="polite">
            {errorMessage}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {isEditing ? (
            <Button variant="outline" onClick={() => void handleRemove()}>
              {t("departureReminder.cancel")}
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose}>
              {t("departureReminder.skip")}
            </Button>
          )}
          <Button
            onClick={() => void handleSet()}
            disabled={tooLate}
            className="bg-my-trip-background text-white hover:bg-my-trip-background/90"
          >
            {t("departureReminder.setReminderConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
