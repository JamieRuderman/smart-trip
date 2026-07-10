import type { Station } from "@/types/smartSchedule";
import { Capacitor } from "@capacitor/core";
import { getFilteredTrips, type ProcessedTrip } from "@/lib/scheduleUtils";
import { armWebTimer } from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";
import { isSouthbound } from "@/lib/stationUtils";
import { parseTimeToMinutes, toLocalDateKey } from "@/lib/timeUtils";
import { FOCUS_ARRIVAL_EVICT_GRACE_MIN } from "@/lib/tripConstants";

export interface FocusedTripReminder {
  leadMinutes: number;
  /** Epoch ms the notification fires (snapshot; rescheduled on observed drift). */
  reminderAt: number;
  /** Stable id used to schedule + cancel the notification. */
  notificationId: number;
  title: string;
  body: string;
  /** Out-of-process alarm id when this reminder was scheduled as a true "Leave
   *  Alarm" (iOS AlarmKit, or Android AlarmManager.setAlarmClock) rather than a
   *  local notification. Absent on the notification path (web, alarm
   *  unavailable/denied, or scheduling failure). */
  alarmId?: string;
  /** Epoch ms the reminder actually fired. Set once `reminderAt` passes — the
   *  OS delivered the alert (native) or the web timer ran — instead of dropping
   *  the reminder sub-object, so the card can show a "time to go" indicator
   *  through the fire → departure window. Absent while the reminder is still
   *  armed and ahead of us; the trip record is cleared wholesale after arrival. */
  firedAt?: number;
}

export interface FocusedTrip {
  source: "user";
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** "YYYY-MM-DD" — the run's service day. The only stored temporal anchor;
   *  departure/arrival are derived from static schedule + this date. */
  serviceDate: string;
  reminder: FocusedTripReminder | null;
  /** Caller-chosen id of the running iOS Live Activity (lock screen + Dynamic
   *  Island countdown) for this trip, when one was started. iOS 16.2+ only;
   *  absent on Android, web, older iOS, or when Live Activities are disabled.
   *  Persisted so we can update/end the right activity across JS reloads — the
   *  OS keeps the activity alive independently of the webview. Mirrors how
   *  `reminder.alarmId` tracks an out-of-process alert. */
  liveActivityId?: string;
}

export const FOCUSED_TRIP_STORAGE_KEY = "smart-train-focused-trip";
export const FOCUSED_TRIP_CHANGED_EVENT = "smart-train-focused-trip-changed";

/** Hold the soonest reminder this far in the future so the alarm schedules
 *  successfully. AlarmKit rejects a fire time that's at/just-past "now", which
 *  silently downgrades the reminder to a weaker local notification. Constrains
 *  the picker slider and clamps the computed fire time on both arm paths. */
export const REMINDER_FIRE_BUFFER_MS = 60_000;

/**
 * Whether `focused` belongs to the same schedule as a displayed leg/arrival —
 * matched by direction + weekday/weekend schedule type, NOT exact leg. The same
 * physical train is shown under different legs (home schedule, line-map
 * corridor, station arrivals); this is the single source of truth for "is this
 * the focused train" so every surface (schedule row, station sheet, detail
 * sheet) highlights it identically. Callers that highlight a specific row still
 * AND this with their own trip-number equality. Direction guards against a trip
 * number being reused on the opposite-direction schedule.
 */
export function focusedTripMatchesSchedule(
  focused: FocusedTrip | null,
  isSouthboundLeg: boolean,
  scheduleType: "weekday" | "weekend",
): focused is FocusedTrip {
  return (
    focused != null &&
    focused.scheduleType === scheduleType &&
    isSouthbound(focused.fromStation, focused.toStation) === isSouthboundLeg
  );
}

const SERVICE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isFocusedTrip(value: unknown): value is FocusedTrip {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const reminderOk =
    r.reminder === null ||
    (typeof r.reminder === "object" &&
      r.reminder !== null &&
      typeof (r.reminder as Record<string, unknown>).leadMinutes === "number" &&
      typeof (r.reminder as Record<string, unknown>).reminderAt === "number" &&
      typeof (r.reminder as Record<string, unknown>).notificationId === "number" &&
      typeof (r.reminder as Record<string, unknown>).title === "string" &&
      typeof (r.reminder as Record<string, unknown>).body === "string" &&
      ((r.reminder as Record<string, unknown>).alarmId === undefined ||
        typeof (r.reminder as Record<string, unknown>).alarmId === "string") &&
      ((r.reminder as Record<string, unknown>).firedAt === undefined ||
        typeof (r.reminder as Record<string, unknown>).firedAt === "number"));
  const liveActivityIdOk =
    r.liveActivityId === undefined || typeof r.liveActivityId === "string";
  return (
    r.source === "user" &&
    typeof r.tripNumber === "number" &&
    typeof r.fromStation === "string" &&
    typeof r.toStation === "string" &&
    (r.scheduleType === "weekday" || r.scheduleType === "weekend") &&
    typeof r.serviceDate === "string" &&
    SERVICE_DATE_RE.test(r.serviceDate as string) &&
    reminderOk &&
    liveActivityIdOk
  );
}

function hhmmToMinutes(hhmm: string): number {
  // Tolerate a malformed HH:MM (→ 0) the way the old inline parse did.
  const minutes = parseTimeToMinutes(hhmm);
  return Number.isFinite(minutes) ? minutes : 0;
}

/**
 * Absolute (local) instant of `minutesOfDay` on a "YYYY-MM-DD" service date,
 * with an optional whole-day offset for overnight rollovers. Single source of
 * truth for turning a stored serviceDate + a schedule clock-time into an epoch.
 */
function serviceDateInstant(
  serviceDate: string,
  minutesOfDay: number,
  dayOffset = 0,
): number {
  const [y, mo, d] = serviceDate.split("-").map(Number);
  return new Date(
    y,
    mo - 1,
    d + dayOffset,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
    0,
    0,
  ).getTime();
}

/**
 * Resolve a focused trip's static arrival to an absolute instant on its
 * service date. Overnight trips (arrival clock-time before departure) roll to
 * the next calendar day.
 */
function arrivalInstant(focused: FocusedTrip, trip: ProcessedTrip): number {
  const depMin = hhmmToMinutes(trip.departureTime);
  const arrMin = hhmmToMinutes(trip.arrivalTime);
  const dayOffset = arrMin < depMin ? 1 : 0;
  return serviceDateInstant(focused.serviceDate, arrMin, dayOffset);
}

/**
 * Rebuild the full ProcessedTrip for a focused trip from static schedule data,
 * so the pinned card can render regardless of the home screen's current
 * from/to. Null if the trip no longer exists in that schedule.
 */
export function reconstructFocusedTrip(focused: FocusedTrip): ProcessedTrip | null {
  const trips = getFilteredTrips(
    focused.fromStation,
    focused.toStation,
    focused.scheduleType,
  );
  return trips.find((t) => t.trip === focused.tripNumber) ?? null;
}

/**
 * Resolve the focused trip's departure (at its fromStation) to an absolute
 * instant on its service date. Lets the reminder control compute a fire time
 * for the user's actual boarding station regardless of which leg/view the
 * control is rendered in (e.g. the line map's full-corridor view). Null if the
 * trip can't be reconstructed.
 */
export function focusedDepartureInstant(focused: FocusedTrip): number | null {
  const trip = reconstructFocusedTrip(focused);
  if (!trip) return null;
  return serviceDateInstant(focused.serviceDate, hhmmToMinutes(trip.departureTime));
}

/**
 * Resolve the focused trip's arrival (at its toStation) to an absolute instant
 * on its service date, rolling overnight trips to the next day. The single
 * source for the Live Activity countdown's arrival target. Sibling of
 * `focusedDepartureInstant`; null if the trip can't be reconstructed.
 */
export function focusedArrivalInstant(focused: FocusedTrip): number | null {
  const trip = reconstructFocusedTrip(focused);
  if (!trip) return null;
  return arrivalInstant(focused, trip);
}

/**
 * Re-anchor a live "HH:MM" clock time onto the calendar day of a static
 * schedule instant, picking the day offset that lands closest to it
 * (overnight-safe within ±12h). Lets the Live Activity sync turn the feed's
 * clock times into absolute instants on the focused trip's own service date,
 * instead of anchoring to "today" the way the schedule views do.
 */
export function anchorLiveTime(staticInstant: number, liveHHMM: string): number {
  const minutes = hhmmToMinutes(liveHHMM);
  const d = new Date(staticInstant);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  let t = d.getTime();
  const HALF_DAY_MS = 12 * 60 * 60 * 1000;
  const FULL_DAY_MS = 24 * 60 * 60 * 1000;
  if (t < staticInstant - HALF_DAY_MS) t += FULL_DAY_MS;
  else if (t > staticInstant + HALF_DAY_MS) t -= FULL_DAY_MS;
  return t;
}

/**
 * The instant at/after which a focused trip should auto-clear: its live-aware
 * arrival plus `graceMs`. Delay-aware so a late train isn't dropped early:
 *   • live arrival known → max(scheduled, live) + grace (never before scheduled,
 *     so an early train still lingers the grace window);
 *   • feed loaded but no live arrival (train passed the stop / on time, the feed
 *     dropped the prediction) → scheduled + grace;
 *   • feed not loaded yet (cold boot) → null: we can't tell a delayed run apart
 *     from an arrived one, so defer to loadFocusedTrip's storage backstop rather
 *     than risk clearing early.
 */
export function focusedTripClearInstant({
  scheduledArrivalAt,
  liveArrivalAt,
  feedLoaded,
  graceMs,
}: {
  scheduledArrivalAt: number | null;
  liveArrivalAt: number | null;
  feedLoaded: boolean;
  graceMs: number;
}): number | null {
  if (scheduledArrivalAt == null) return null;
  if (liveArrivalAt != null) {
    return Math.max(scheduledArrivalAt, liveArrivalAt) + graceMs;
  }
  if (feedLoaded) return scheduledArrivalAt + graceMs;
  return null;
}

/**
 * Read the focused trip, clearing it once its scheduled arrival has passed by
 * more than the storage backstop (the prompt, delay-aware clear is done live by
 * FocusedTripAutoClear), or when the trip can no longer be found in the schedule
 * (timetable changed under a stale focus).
 */
export function loadFocusedTrip(): FocusedTrip | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(FOCUSED_TRIP_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isFocusedTrip(parsed)) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
    }
    const trip = reconstructFocusedTrip(parsed);
    if (!trip) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
    }
    if (
      arrivalInstant(parsed, trip) +
        FOCUS_ARRIVAL_EVICT_GRACE_MIN * 60_000 <=
      Date.now()
    ) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
    }
    // The reminder has already fired — stamp `firedAt` (once) so the card can
    // swap the "edit reminder" pill for a "time to go" indicator, rather than
    // dropping the sub-object and reverting to a bare "Add reminder" that hides
    // that the alarm went off. On native the OS delivered the alert at fire time
    // but there's no JS callback (bootFocusedTrip skips the timer re-arm on
    // native); on web a closed-tab miss has no way to deliver late anyway.
    // Either way, "reminderAt is in the past" means it fired.
    if (
      parsed.reminder &&
      parsed.reminder.firedAt == null &&
      parsed.reminder.reminderAt <= Date.now()
    ) {
      const fired: FocusedTrip = {
        ...parsed,
        reminder: { ...parsed.reminder, firedAt: Date.now() },
      };
      saveFocusedTrip(fired);
      return fired;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveFocusedTrip(trip: FocusedTrip | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (trip === null) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return;
    }
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, JSON.stringify(trip));
  } catch {
    // localStorage unavailable — no-op
  }
}

function toServiceDate(epochMs: number): string {
  return toLocalDateKey(new Date(epochMs));
}

const LEGACY_REMINDER_KEY = "smart-train-departure-reminders";

/**
 * One-time migration from the old per-trip reminder array to the single
 * focused trip. Promotes the still-future reminder with the latest departure,
 * deriving serviceDate from its departure epoch; deletes the legacy key.
 */
export function migrateLegacyReminders(): FocusedTrip | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_REMINDER_KEY);
  if (!raw) return null;
  localStorage.removeItem(LEGACY_REMINDER_KEY);
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;

  const now = Date.now();
  const future = list.filter(
    (r): r is Record<string, unknown> =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as Record<string, unknown>).departureAt === "number" &&
      ((r as Record<string, unknown>).departureAt as number) > now,
  );
  if (future.length === 0) return null;

  future.sort((a, b) => (b.departureAt as number) - (a.departureAt as number));
  const r = future[0];
  const departureAt = r.departureAt as number;
  const day = new Date(departureAt).getDay();
  const scheduleType: "weekday" | "weekend" =
    day === 0 || day === 6 ? "weekend" : "weekday";
  const tripNumber = r.tripNumber as number;
  const serviceDate = toServiceDate(departureAt);

  // Reuse the legacy reminder's own id as the notification id. The old system
  // scheduled the native notification under `r.id`, so that — not a freshly
  // derived id — is what the OS actually has queued. Keying the migrated record
  // on it keeps cancel/reschedule/Stop able to reach (and suppress) the
  // pre-upgrade notification; deriving a new id would orphan it. Fall back to a
  // derived id only if the legacy record somehow lacks a usable one.
  const legacyId = r.id;
  const notificationId =
    typeof legacyId === "number" && Number.isFinite(legacyId)
      ? legacyId
      : reminderIdFor(tripNumber, serviceDate);

  const focused: FocusedTrip = {
    source: "user",
    tripNumber,
    fromStation: r.fromStation as Station,
    toStation: r.toStation as Station,
    scheduleType,
    serviceDate,
    reminder: {
      leadMinutes: r.leadMinutes as number,
      reminderAt: r.reminderAt as number,
      notificationId,
      title: r.title as string,
      body: r.body as string,
    },
  };
  saveFocusedTrip(focused);
  return focused;
}

let booted = false;

/**
 * One-time boot: migrate legacy reminders, then re-arm the web timer for a
 * surviving reminder (no-op on native — the OS owns scheduled notifications).
 */
export function bootFocusedTrip(): void {
  if (booted) return;
  booted = true;
  const migrated = migrateLegacyReminders();
  // The context's focusedTrip state initializes during render — before this
  // boot effect runs — so a record written by migration here isn't visible (no
  // pinned card, no Stop/cancel control) until something nudges consumers to
  // re-read. Dispatch the change event so the migrated trip surfaces on first
  // load instead of waiting for a reload. Runs on native too (the card still
  // needs to appear, even though the OS owns the notification).
  if (migrated && typeof window !== "undefined") {
    window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
  }
  if (Capacitor.isNativePlatform()) return;
  const focused = loadFocusedTrip();
  if (!focused?.reminder) return;
  armWebTimer(
    {
      id: focused.reminder.notificationId,
      title: focused.reminder.title,
      body: focused.reminder.body,
      at: focused.reminder.reminderAt,
    },
    () => {
      const after = loadFocusedTrip();
      if (after?.reminder) {
        saveFocusedTrip({
          ...after,
          reminder: { ...after.reminder, firedAt: Date.now() },
        });
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
      }
    },
  );
}
