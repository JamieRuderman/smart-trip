import type { TFunction } from "i18next";
import type { Station } from "@/types/smartSchedule";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import stations from "@/data/stations";
import { armReplacingAlert, cancelAlertChannels } from "@/lib/alertChannel";
import {
  anchorLiveTime,
  focusedArrivalInstant,
  loadFocusedTrip,
  reconstructFocusedTrip,
  REMINDER_FIRE_BUFFER_MS,
  sameFocusIdentity,
  saveFocusedTrip,
  type FocusedRun,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { notifyChange } from "@/lib/liveActivityController";
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

/** Every path that arms or re-arms the alarm builds its text here, in one time
 *  format, because the drift re-arm compares text to stay idempotent. */
export function buildGetOffAlarmText(
  t: TFunction,
  language: string,
  {
    toStation,
    tripNumber,
    arrivalAt,
  }: {
    toStation: Station;
    tripNumber: number;
    arrivalAt: number;
  },
): { title: string; body: string } {
  return {
    title: t("getOffAlarm.notificationTitle", { station: toStation }),
    body: t("getOffAlarm.notificationBody", {
      station: toStation,
      trip: tripNumber,
      time: formatClockTime(arrivalAt, "12h", language),
    }),
  };
}

export type GetOffAlarmResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "schedule-failed" | "no-focus" };

// Set, clear and the drift re-arm each read the stored alarm and retire it; run
// overlapping, two re-arms both retire the same old id and orphan one new alarm.
let queue: Promise<unknown> = Promise.resolve();
function serialized<R>(task: () => Promise<R>): Promise<R> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function armGetOffAlarm(
  current: FocusedTrip,
  fireAt: number,
  text: { title: string; body: string },
): Promise<GetOffAlarmResult> {
  const prev = current.getOffAlarm;
  const notificationId = getOffAlarmIdFor(current.tripNumber, current.serviceDate);
  const armed = await armReplacingAlert(
    { notificationId, title: text.title, body: text.body, at: fireAt },
    prev?.alarmId,
    notifyChange,
    "Failed to schedule get-off alarm",
    (alarmId) => {
      const latest = loadFocusedTrip();
      if (latest == null || !sameFocusIdentity(latest, current)) return null;
      if (prev != null && latest.getOffAlarm == null) return null;
      const saved: FocusedTrip = {
        ...latest,
        getOffAlarm: { reminderAt: fireAt, notificationId, title: text.title, body: text.body, alarmId },
      };
      saveFocusedTrip(saved);
      return saved;
    },
  );
  if (!armed.ok) return armed;
  notifyChange();
  return { ok: true };
}

/** The stored trip, if it's still `target` once the queue reaches the request —
 *  so a train switch in between can't inherit it. */
function stillTargeted(target: FocusedRun): FocusedTrip | null {
  const current = loadFocusedTrip();
  return sameFocusIdentity(current, target) ? current : null;
}

/** Arm `target`'s get-off alarm at `fireAt`. */
export function setGetOffAlarm(
  target: FocusedRun,
  fireAt: number,
  text: { title: string; body: string },
): Promise<GetOffAlarmResult> {
  return serialized(async () => {
    const current = stillTargeted(target);
    if (!current) return { ok: false, reason: "no-focus" };
    return armGetOffAlarm(current, fireAt, text);
  });
}

/** Turn `target`'s get-off alarm off. */
export function clearGetOffAlarm(target: FocusedRun): Promise<void> {
  return serialized(async () => {
    const current = stillTargeted(target);
    if (!current?.getOffAlarm) return;
    await cancelAlertChannels(current.getOffAlarm);
    const latest = loadFocusedTrip();
    if (latest && sameFocusIdentity(latest, current) && latest.getOffAlarm) {
      saveFocusedTrip({ ...latest, getOffAlarm: undefined });
      notifyChange();
    }
  });
}

/** Move an armed, not-yet-fired alarm to a drifted fire time. No-op when the
 *  time and text are unchanged, or the new time is too close to schedule. */
export function rescheduleGetOffAlarm(
  target: FocusedRun,
  fireAt: number,
  text: { title: string; body: string },
): Promise<void> {
  return serialized(async () => {
    const current = stillTargeted(target);
    const armed = current?.getOffAlarm;
    if (!current || !armed) return;
    const now = Date.now();
    if (armed.reminderAt <= now) return;
    if (armed.reminderAt === fireAt && armed.title === text.title && armed.body === text.body) {
      return;
    }
    if (!canScheduleGetOffAlarm(fireAt, now)) return;
    await armGetOffAlarm(current, fireAt, text);
  });
}
