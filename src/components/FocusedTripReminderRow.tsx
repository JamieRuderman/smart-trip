import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { formatClockTime } from "@/lib/timeUtils";
import type { FocusedTrip } from "@/lib/focusedTrip";
import { WalkIcon } from "./icons/WalkIcon";

interface FocusedTripReminderRowProps {
  focusedTrip: FocusedTrip;
  /** Minutes until the (live-aware) departure; negative once departed. */
  minutesUntil: number;
  isCanceledOrSkipped: boolean;
  /** The run is on a later day — its countdown is day-relative, not live. */
  isFutureService: boolean;
  timeFormat: "12h" | "24h";
}

/**
 * The focused trip's leave-reminder control, styled for a coloured "my trip"
 * band (white on blue/gold): the armed reminder (tap to edit), "Add reminder",
 * or — once the alarm has gone off and the train hasn't left — a "time to go"
 * indicator. Renders nothing when none applies (e.g. a spent reminder after
 * departure, or no notification support). The lead-time picker itself is the
 * app-level {@link ReminderDialogHost}, opened via context.
 */
export function FocusedTripReminderRow({
  focusedTrip,
  minutesUntil,
  isCanceledOrSkipped,
  isFutureService,
  timeFormat,
}: FocusedTripReminderRowProps) {
  const { t, i18n } = useTranslation();
  const { openReminderDialog } = useStationSelection();

  const reminder = focusedTrip.reminder;
  // The reminder has gone off (its lead has elapsed) but the train hasn't left
  // yet — the "you should be heading out" window.
  const reminderFired = reminder?.firedAt != null;

  // Match reminderLeadRange's tooLate gate: hide "Add reminder" once departure
  // is under ~2 min away (or the train has departed), past which even a 1-min
  // lead reminder would fire inside the near-now buffer. Future-service trips
  // keep the affordance (their countdown is day-relative, not a live lead).
  const showAddReminder =
    !isCanceledOrSkipped &&
    !reminder &&
    isReminderSupported() &&
    (isFutureService || minutesUntil >= 2);

  // "Time to go": the alarm fired and the train still hasn't left. Bounded to
  // the fire → departure window — once the train departs the status headline
  // takes over, and the spent reminder lingers in storage only until arrival
  // auto-clears the trip.
  const showTimeToGo =
    reminderFired && !isCanceledOrSkipped && !isFutureService && minutesUntil >= 0;

  // Alongside "time to go", keep offering "Add reminder" (same near-departure
  // gate) so the user can still re-arm one before the train actually leaves.
  const canReAddReminder =
    showTimeToGo && isReminderSupported() && minutesUntil >= 2;

  if (showTimeToGo) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-1 min-w-0 items-center gap-2 rounded-lg bg-white/25 px-3 h-9 text-sm font-semibold text-white">
          <WalkIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("departureReminder.timeToLeave")}</span>
        </div>
        {canReAddReminder && (
          <button
            type="button"
            onClick={openReminderDialog}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/15 px-3 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
          >
            <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("departureReminder.setReminder")}
          </button>
        )}
      </div>
    );
  }

  if (reminder && !reminderFired) {
    return (
      <button
        type="button"
        onClick={openReminderDialog}
        aria-label={t("departureReminder.editReminder")}
        className="w-full min-w-0 inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
      >
        <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {formatClockTime(reminder.reminderAt, timeFormat, i18n.language)}
          <span className="text-white/70">
            {" · "}
            {t("departureReminder.minutesBefore", {
              count: reminder.leadMinutes,
            })}
          </span>
        </span>
      </button>
    );
  }

  if (showAddReminder) {
    return (
      <button
        type="button"
        onClick={openReminderDialog}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/15 h-9 text-sm font-medium text-white transition-colors hover:bg-white/25"
      >
        <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("departureReminder.setReminder")}
      </button>
    );
  }

  return null;
}
