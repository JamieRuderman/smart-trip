import type { TFunction } from "i18next";
import type { Station } from "@/types/smartSchedule";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import stations from "@/data/stations";
import { cancelAlertChannels, scheduleAlertChannel } from "@/lib/alertChannel";
import {
  anchorLiveTime,
  focusedArrivalInstant,
  loadFocusedTrip,
  reconstructFocusedTrip,
  REMINDER_FIRE_BUFFER_MS,
  sameFocusIdentity,
  saveFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { notifyChange } from "@/lib/liveActivityController";
import { cancelLeaveAlarm } from "@/lib/native/leaveAlarm";
import { cancelNotification } from "@/lib/notificationScheduler";
import { getOffAlarmIdFor } from "@/lib/notificationId";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { stationIndexMap } from "@/lib/stationUtils";
import { formatClockTime, parseTimeToMinutes } from "@/lib/timeUtils";

/** A long run between stops would wake the rider far too early, so the alarm
 *  rings at most this long before arrival. */
export const GET_OFF_MAX_LEAD_MINUTES = 5;

function servedMinutes(time: string | undefined): number | null {
  if (!time || time.includes("~~")) return null;
  const minutes = parseTimeToMinutes(time);
  return Number.isFinite(minutes) ? minutes : null;
}

/** The stop this run calls at just before `to`, passing over stations it
 *  doesn't serve or that the live feed says it skips. May be `from` itself. */
export function stopBefore(
  trip: ProcessedTrip,
  from: Station,
  to: Station,
  skipped: readonly string[] = [],
): { station: Station; minutes: number } | null {
  const fromIndex = stationIndexMap[from];
  const toIndex = stationIndexMap[to];
  if (fromIndex == null || toIndex == null || fromIndex === toIndex) return null;
  const step = fromIndex < toIndex ? 1 : -1;
  for (let i = toIndex - step; i !== fromIndex - step; i -= step) {
    const station = stations[i];
    const minutes = servedMinutes(trip.times[i]);
    if (minutes != null && !skipped.includes(station)) return { station, minutes };
  }
  return null;
}

/** When the get-off alarm rings: as the train leaves the stop before the
 *  rider's (capped at {@link GET_OFF_MAX_LEAD_MINUTES}), measured back from the
 *  live arrival when the feed has one. Null when the trip can't be rebuilt. */
export function getOffAlarmTiming(
  focused: FocusedTrip,
  live: TripRealtimeStatus | null,
): { fireAt: number; arrivalAt: number } | null {
  const trip = reconstructFocusedTrip(focused);
  const scheduledArrival = focusedArrivalInstant(focused);
  if (!trip || scheduledArrival == null) return null;
  const arrivalMinutes = servedMinutes(trip.arrivalTime);
  const before = stopBefore(
    trip,
    focused.fromStation,
    focused.toStation,
    live?.skippedStations,
  );
  if (arrivalMinutes == null || !before) return null;
  const gap = (arrivalMinutes - before.minutes + 1440) % 1440;
  const leadMinutes = Math.max(1, Math.min(gap, GET_OFF_MAX_LEAD_MINUTES));
  const arrivalAt = live?.liveArrivalTime
    ? anchorLiveTime(scheduledArrival, live.liveArrivalTime)
    : scheduledArrival;
  return { fireAt: arrivalAt - leadMinutes * 60_000, arrivalAt };
}

/** Whether an alarm at `fireAt` can still be scheduled — AlarmKit rejects a
 *  fire time at or just past now. */
export function canScheduleGetOffAlarm(fireAt: number, now: number): boolean {
  return fireAt - now > REMINDER_FIRE_BUFFER_MS;
}

/** Every path that arms or re-arms the alarm builds its text here, because the
 *  drift re-arm compares text to stay idempotent. */
export function buildGetOffAlarmText(
  t: TFunction,
  language: string,
  {
    toStation,
    tripNumber,
    arrivalAt,
    timeFormat,
  }: {
    toStation: Station;
    tripNumber: number;
    arrivalAt: number;
    timeFormat: "12h" | "24h";
  },
): { title: string; body: string } {
  return {
    title: t("getOffAlarm.notificationTitle", { station: toStation }),
    body: t("getOffAlarm.notificationBody", {
      station: toStation,
      trip: tripNumber,
      time: formatClockTime(arrivalAt, timeFormat, language),
    }),
  };
}

export type GetOffAlarmResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "schedule-failed" | "no-focus" };

async function armGetOffAlarm(
  current: FocusedTrip,
  fireAt: number,
  text: { title: string; body: string },
): Promise<GetOffAlarmResult> {
  const prev = current.getOffAlarm;
  const notificationId = getOffAlarmIdFor(current.tripNumber, current.serviceDate);
  const scheduled = await scheduleAlertChannel(
    { notificationId, title: text.title, body: text.body, at: fireAt },
    notifyChange,
    "Failed to schedule get-off alarm",
  );
  if (!scheduled.ok) return scheduled;
  const { alarmId } = scheduled;

  // A permission prompt can block long enough for the rider to switch trains or
  // turn this alarm off; don't resurrect either.
  const latest = loadFocusedTrip();
  if (
    latest == null ||
    !sameFocusIdentity(latest, current) ||
    (prev != null && latest.getOffAlarm == null)
  ) {
    await cancelAlertChannels({ notificationId, alarmId });
    return { ok: false, reason: "schedule-failed" };
  }

  if (prev?.alarmId && prev.alarmId !== alarmId) await cancelLeaveAlarm(prev.alarmId);
  if (alarmId) await cancelNotification(notificationId);
  saveFocusedTrip({
    ...latest,
    getOffAlarm: { reminderAt: fireAt, notificationId, title: text.title, body: text.body, alarmId },
  });
  notifyChange();
  return { ok: true };
}

/** Arm the focused trip's get-off alarm at `fireAt`. */
export async function setGetOffAlarm(
  fireAt: number,
  text: { title: string; body: string },
): Promise<GetOffAlarmResult> {
  const current = loadFocusedTrip();
  if (!current) return { ok: false, reason: "no-focus" };
  return armGetOffAlarm(current, fireAt, text);
}

/** Turn the focused trip's get-off alarm off. */
export async function clearGetOffAlarm(): Promise<void> {
  const current = loadFocusedTrip();
  if (!current?.getOffAlarm) return;
  await cancelAlertChannels(current.getOffAlarm);
  const latest = loadFocusedTrip();
  if (latest && sameFocusIdentity(latest, current) && latest.getOffAlarm) {
    saveFocusedTrip({ ...latest, getOffAlarm: undefined });
    notifyChange();
  }
}

/** Move an armed, not-yet-fired alarm to a drifted fire time. No-op when the
 *  time and text are unchanged, or the new time is too close to schedule. */
export async function rescheduleGetOffAlarm(
  fireAt: number,
  text: { title: string; body: string },
): Promise<void> {
  const current = loadFocusedTrip();
  const armed = current?.getOffAlarm;
  if (!current || !armed) return;
  const now = Date.now();
  if (armed.reminderAt <= now) return;
  if (armed.reminderAt === fireAt && armed.title === text.title && armed.body === text.body) {
    return;
  }
  if (!canScheduleGetOffAlarm(fireAt, now)) return;
  await armGetOffAlarm(current, fireAt, text);
}
