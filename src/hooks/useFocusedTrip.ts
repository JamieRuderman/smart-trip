import { useCallback, useEffect, useState } from "react";
import type { Station } from "@/types/smartSchedule";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  loadFocusedTrip,
  saveFocusedTrip,
  type FocusedTrip,
  type FocusedTripReminder,
} from "@/lib/focusedTrip";
import {
  cancelNotification,
  ensureNotificationPermission,
  scheduleNotification,
} from "@/lib/notificationScheduler";
import { cancelLeaveAlarm, scheduleLeaveAlarm } from "@/lib/native/leaveAlarm";
import { reminderIdFor } from "@/lib/notificationId";
import { logger } from "@/lib/logger";

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
}

/** Cancel both channels a reminder might own — the local notification and, if
 *  it was scheduled as a true Leave Alarm, the AlarmKit alarm. Cancelling the
 *  channel that wasn't used is a harmless no-op. */
async function cancelReminderChannels(
  reminder: FocusedTripReminder | null,
): Promise<void> {
  if (!reminder) return;
  await cancelNotification(reminder.notificationId);
  if (reminder.alarmId) await cancelLeaveAlarm(reminder.alarmId);
}

/** Web-fire cleanup: drop only the reminder sub-object, keep the focus. */
function onReminderFired(): void {
  const after = loadFocusedTrip();
  if (after) saveFocusedTrip({ ...after, reminder: null });
  notifyChange();
}

/**
 * Schedule `reminder` on the best available channel and, on success, persist it
 * onto `current` and notify consumers. Shared by the arm + drift-reschedule
 * paths. Returns whether the schedule was accepted.
 *
 * Prefers a true AlarmKit "Leave Alarm" on iOS (it breaks through Silent
 * Mode/Focus), falling back to a local notification everywhere else (Android,
 * web, AlarmKit unavailable/denied, or a create failure). The alarm REPLACES
 * the notification — never both, so the user gets a single alert.
 *
 * The new channel is always scheduled BEFORE the previous one is retired, so a
 * failed (re)schedule degrades to "fires on the old channel/time" rather than
 * silently vanishing — preserving the drift-reschedule safety guarantee.
 */
async function armAndPersistReminder(
  current: FocusedTrip,
  reminder: FocusedTripReminder,
  failureMessage: string,
): Promise<boolean> {
  const prev = current.reminder;

  const alarm = await scheduleLeaveAlarm({
    label: reminder.title,
    fireAt: reminder.reminderAt,
  });
  if (alarm.scheduled && alarm.alarmId) {
    if (prev?.alarmId && prev.alarmId !== alarm.alarmId) {
      await cancelLeaveAlarm(prev.alarmId);
    }
    // Drop any stale notification under this id so we don't double-alert.
    await cancelNotification(reminder.notificationId);
    saveFocusedTrip({ ...current, reminder: { ...reminder, alarmId: alarm.alarmId } });
    notifyChange();
    return true;
  }

  // Notification fallback. Scheduling under the same id atomically replaces any
  // existing notification; only retire a prior alarm once this has succeeded.
  try {
    await scheduleNotification(
      {
        id: reminder.notificationId,
        title: reminder.title,
        body: reminder.body,
        at: reminder.reminderAt,
      },
      onReminderFired,
    );
  } catch (error) {
    logger.warn(failureMessage, error);
    return false;
  }
  if (prev?.alarmId) await cancelLeaveAlarm(prev.alarmId);
  saveFocusedTrip({ ...current, reminder: { ...reminder, alarmId: undefined } });
  notifyChange();
  return true;
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
    if (prev?.reminder) await cancelReminderChannels(prev.reminder);
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
        if (current.reminder) await cancelReminderChannels(current.reminder);
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
      const ok = await armAndPersistReminder(
        current,
        { leadMinutes, reminderAt, notificationId, title: text.title, body: text.body },
        "Failed to schedule focused-trip reminder",
      );
      return ok ? { ok: true } : { ok: false, reason: "schedule-failed" };
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
      // prior timer first). Crucially armAndPersistReminder does NOT cancel
      // first: if scheduling throws (permission revoked, exact-alarm denied),
      // the original reminder is still armed, so a failed drift-reschedule
      // degrades to "fires at the old time" rather than silently vanishing.
      await armAndPersistReminder(
        current,
        { leadMinutes, reminderAt, notificationId, title: text.title, body: text.body },
        "Failed to reschedule focused-trip reminder on drift",
      );
    },
    [],
  );

  const clearFocusedTrip = useCallback(async () => {
    const current = loadFocusedTrip();
    if (current?.reminder) await cancelReminderChannels(current.reminder);
    saveFocusedTrip(null);
    notifyChange();
  }, []);

  return { focusedTrip, focusTrip, setReminder, rescheduleReminder, clearFocusedTrip };
}
