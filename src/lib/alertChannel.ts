import i18n from "@/lib/i18n";
import { logger } from "@/lib/logger";
import { cancelLeaveAlarm, scheduleLeaveAlarm } from "@/lib/native/leaveAlarm";
import {
  cancelNotification,
  ensureNotificationPermission,
  scheduleNotification,
} from "@/lib/notificationScheduler";

/** A one-time alert for the focused trip: the leave reminder or the get-off
 *  alarm. */
export interface AlertRequest {
  notificationId: number;
  title: string;
  body: string;
  /** Epoch ms the alert fires. */
  at: number;
}

export type ScheduleAlertResult =
  | { ok: true; alarmId?: string }
  | { ok: false; reason: "permission" | "schedule-failed" };

/**
 * Schedule an alert as a true alarm (iOS AlarmKit / Android) when one is
 * available and authorized, else as a local notification. Notification
 * permission is requested only on that fallback, so an alarm-only user who
 * denied notifications isn't blocked.
 */
async function scheduleAlertChannel(
  alert: AlertRequest,
  onWebFired: () => void,
  failureMessage: string,
): Promise<ScheduleAlertResult> {
  const alarm = await scheduleLeaveAlarm({
    label: alert.title,
    fireAt: alert.at,
    buttons: {
      stop: i18n.t("departureReminder.alarmStop"),
      viewTrip: i18n.t("departureReminder.alarmViewTrip"),
    },
  });
  if (alarm.scheduled && alarm.alarmId) return { ok: true, alarmId: alarm.alarmId };

  const granted = await ensureNotificationPermission();
  if (!granted) return { ok: false, reason: "permission" };
  try {
    await scheduleNotification(
      { id: alert.notificationId, title: alert.title, body: alert.body, at: alert.at },
      onWebFired,
    );
  } catch (error) {
    logger.warn(failureMessage, error);
    return { ok: false, reason: "schedule-failed" };
  }
  return { ok: true };
}

/**
 * Schedule `alert`, then hand the result to `commit`, which re-reads the trip
 * and saves it synchronously, or returns null when it changed meanwhile (a
 * permission prompt can block long enough for the rider to switch trains or
 * turn the alert off) so the new channel is rolled back. The previous alarm is
 * retired only after the save, so no await sits between re-read and write.
 */
export async function armReplacingAlert<T>(
  alert: AlertRequest,
  prevAlarmId: string | undefined,
  onWebFired: () => void,
  failureMessage: string,
  commit: (alarmId: string | undefined) => T | null,
): Promise<{ ok: true; saved: T } | Extract<ScheduleAlertResult, { ok: false }>> {
  const scheduled = await scheduleAlertChannel(alert, onWebFired, failureMessage);
  if (!scheduled.ok) return scheduled;
  const { alarmId } = scheduled;

  const saved = commit(alarmId);
  if (saved == null) {
    if (alarmId) await cancelLeaveAlarm(alarmId);
    else await cancelNotification(alert.notificationId);
    return { ok: false, reason: "schedule-failed" };
  }

  if (prevAlarmId && prevAlarmId !== alarmId) await cancelLeaveAlarm(prevAlarmId);
  if (alarmId) await cancelNotification(alert.notificationId);
  return { ok: true, saved };
}

/** Cancel both channels an alert might own. Both are dispatched before the
 *  first await, so a suspension mid-teardown can't strand the alarm. */
export async function cancelAlertChannels(
  alert: { notificationId: number; alarmId?: string } | null | undefined,
): Promise<void> {
  if (!alert) return;
  await Promise.all([
    cancelNotification(alert.notificationId),
    alert.alarmId ? cancelLeaveAlarm(alert.alarmId) : undefined,
  ]);
}
