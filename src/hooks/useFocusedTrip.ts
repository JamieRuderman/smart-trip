import { useCallback, useEffect, useState } from "react";
import type { Station } from "@/types/smartSchedule";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  loadFocusedTrip,
  saveFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import {
  cancelNotification,
  ensureNotificationPermission,
  scheduleNotification,
} from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";
import { logger } from "@/lib/logger";

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
}

/** Web-fire cleanup: drop only the reminder sub-object, keep the focus. */
function onReminderFired(): void {
  const after = loadFocusedTrip();
  if (after) saveFocusedTrip({ ...after, reminder: null });
  notifyChange();
}

export interface FocusTripInput {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** "YYYY-MM-DD" service day of the run. */
  serviceDate: string;
}

export type SetReminderResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "schedule-failed" | "no-focus" };

export interface ReminderText {
  title: string;
  body: string;
}

export function useFocusedTrip() {
  const [focusedTrip, setFocusedTripState] = useState<FocusedTrip | null>(() =>
    loadFocusedTrip(),
  );

  useEffect(() => {
    const handler = () => setFocusedTripState(loadFocusedTrip());
    window.addEventListener(FOCUSED_TRIP_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FOCUSED_TRIP_CHANGED_EVENT, handler);
  }, []);

  /** Focus a trip (no reminder). Replaces any existing focus and cancels its
   *  reminder. Caller handles any "switch trains?" confirmation. */
  const focusTrip = useCallback(async (input: FocusTripInput) => {
    const prev = loadFocusedTrip();
    if (prev?.reminder) await cancelNotification(prev.reminder.notificationId);
    saveFocusedTrip({
      source: "user",
      tripNumber: input.tripNumber,
      fromStation: input.fromStation,
      toStation: input.toStation,
      scheduleType: input.scheduleType,
      serviceDate: input.serviceDate,
      reminder: null,
    });
    notifyChange();
  }, []);

  /** Arm (number) or disarm (null) the reminder. `departureAt` is the live-
   *  aware departure instant used to compute the fire time. */
  const setReminder = useCallback(
    async (
      leadMinutes: number | null,
      departureAt: number,
      text: ReminderText,
    ): Promise<SetReminderResult> => {
      const current = loadFocusedTrip();
      if (!current) return { ok: false, reason: "no-focus" };

      if (leadMinutes === null) {
        if (current.reminder) await cancelNotification(current.reminder.notificationId);
        saveFocusedTrip({ ...current, reminder: null });
        notifyChange();
        return { ok: true };
      }

      const granted = await ensureNotificationPermission();
      if (!granted) return { ok: false, reason: "permission" };

      const notificationId = reminderIdFor(current.tripNumber, current.serviceDate);
      if (current.reminder && current.reminder.notificationId !== notificationId) {
        await cancelNotification(current.reminder.notificationId);
      }
      const reminderAt = departureAt - leadMinutes * 60_000;
      try {
        await scheduleNotification(
          { id: notificationId, title: text.title, body: text.body, at: reminderAt },
          onReminderFired,
        );
      } catch (error) {
        logger.warn("Failed to schedule focused-trip reminder", error);
        return { ok: false, reason: "schedule-failed" };
      }
      saveFocusedTrip({
        ...current,
        reminder: {
          leadMinutes,
          reminderAt,
          notificationId,
          title: text.title,
          body: text.body,
        },
      });
      notifyChange();
      return { ok: true };
    },
    [],
  );

  /** Reschedule the armed reminder when the live departure drifts. No-op when
   *  there's no reminder or the fire time/text is unchanged. */
  const rescheduleReminder = useCallback(
    async (departureAt: number, text: ReminderText): Promise<void> => {
      const current = loadFocusedTrip();
      if (!current?.reminder) return;
      const reminderAt = departureAt - current.reminder.leadMinutes * 60_000;
      if (
        reminderAt === current.reminder.reminderAt &&
        text.title === current.reminder.title &&
        text.body === current.reminder.body
      ) {
        return;
      }
      const { notificationId, leadMinutes } = current.reminder;
      // Re-arm under the SAME id, which atomically replaces the existing
      // notification (native overwrites same-id; web's armWebTimer clears the
      // prior timer first). Crucially we do NOT cancel first: if scheduling
      // throws (permission revoked, exact-alarm denied), the original reminder
      // is still armed, so a failed drift-reschedule degrades to "fires at the
      // old time" rather than silently losing the reminder entirely.
      try {
        await scheduleNotification(
          { id: notificationId, title: text.title, body: text.body, at: reminderAt },
          onReminderFired,
        );
      } catch (error) {
        logger.warn("Failed to reschedule focused-trip reminder on drift", error);
        return;
      }
      saveFocusedTrip({
        ...current,
        reminder: {
          leadMinutes,
          reminderAt,
          notificationId,
          title: text.title,
          body: text.body,
        },
      });
      notifyChange();
    },
    [],
  );

  const clearFocusedTrip = useCallback(async () => {
    const current = loadFocusedTrip();
    if (current?.reminder) await cancelNotification(current.reminder.notificationId);
    saveFocusedTrip(null);
    notifyChange();
  }, []);

  return { focusedTrip, focusTrip, setReminder, rescheduleReminder, clearFocusedTrip };
}
