# "Go" — Single Focused Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-trip departure-reminder array with a single user-indicated *focused trip* ("Go"), pinned at the top of the home screen, carrying an optional reminder, auto-clearing on arrival.

**Architecture:** Extract the platform notification mechanics out of `departureReminder.ts` into a storage-free `notificationScheduler.ts`. Add a single-record `focusedTrip.ts` (storage + migration + validation + expiry + trip reconstruction) on top of it. Surface it through the existing `StationSelectionProvider` as a new facet (`focusedTrip`), separate from `selectedTripNumber`. Rework the trip-detail `DepartureReminder` component into a "Go" control, render a pinned `FocusedTripCard` on the home screen, and dedupe its row from the schedule list.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest, Capacitor (`@capacitor/local-notifications`), react-i18next, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-29-go-focused-trip-design.md`

---

## File Structure

**Create:**
- `src/lib/notificationScheduler.ts` — pure platform notification mechanics (native schedule, web timer, permission, capability checks). No domain storage.
- `src/lib/notificationScheduler.test.ts` — unit tests.
- `src/lib/focusedTrip.ts` — `FocusedTrip` type, single-record storage, legacy migration, validation, expiry, reconstruction from static schedule.
- `src/lib/focusedTrip.test.ts` — unit tests.
- `src/hooks/useFocusedTrip.ts` — React binding to the focused-trip store (read + actions), used by the provider.
- `src/components/FocusedTripCard.tsx` — pinned home-screen card wrapping `TripCard`.

**Modify:**
- `src/contexts/stationSelection.ts` — extend `StationSelection` interface with the focused-trip facet.
- `src/contexts/StationSelectionContext.tsx` — wire the facet + the minute-interval expiry.
- `src/components/DepartureReminder.tsx` — rework into the "Go" control + reminder sub-option.
- `src/components/TripDetailContent.tsx` — pass focused-trip context to the Go control.
- `src/components/ScheduleResults.tsx` — dedupe the focused trip's row when on the displayed leg.
- `src/components/TrainScheduleApp.tsx` — render `FocusedTripCard` above the schedule.
- `src/lib/translations/en.json`, `src/lib/translations/es.json` — new keys.
- `src/App.tsx` — swap `rehydrateWebReminders()` for the focused-trip rehydrate.

**Delete (after migration is in place — final task):**
- `src/hooks/useDepartureReminder.ts`
- `src/lib/departureReminder.ts` (its still-needed pieces are moved to `notificationScheduler.ts`)
- `src/lib/departureReminder.test.ts` if present.

---

## Phase A — Extract notification mechanics

### Task A1: Create `notificationScheduler.ts` with capability + permission helpers

**Files:**
- Create: `src/lib/notificationScheduler.ts`
- Create: `src/lib/notificationScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/notificationScheduler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    schedule: vi.fn(),
    cancel: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
  },
}));

import { isReminderSupported, isIOSWebBrowser } from "./notificationScheduler";

describe("isReminderSupported (web)", () => {
  it("is true when the Notification API exists", () => {
    vi.stubGlobal("window", { Notification: function () {} });
    expect(isReminderSupported()).toBe(true);
  });
  it("is false when the Notification API is absent", () => {
    vi.stubGlobal("window", {});
    expect(isReminderSupported()).toBe(false);
  });
});

describe("isIOSWebBrowser", () => {
  it("detects iPhone UA", () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone Safari" });
    expect(isIOSWebBrowser()).toBe(true);
  });
  it("is false for desktop UA", () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh Chrome" });
    expect(isIOSWebBrowser()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notificationScheduler.test.ts`
Expected: FAIL — module `./notificationScheduler` not found.

- [ ] **Step 3: Create the module with the helpers**

Copy these functions verbatim from the current `src/lib/departureReminder.ts` (lines 121–166 and 171–223) into the new file, renaming the scheduling entry points. The full new file content:

```ts
// src/lib/notificationScheduler.ts
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { logger } from "./logger";

/** A single OS/browser notification to fire at an absolute time. */
export interface ScheduledNotification {
  id: number;
  title: string;
  body: string;
  /** Epoch ms when the notification should fire. */
  at: number;
}

/** Whether reminders can fire in the current environment (native always; web
 *  needs the Notification API, absent on iOS Chrome/Firefox and non-PWA Safari). */
export function isReminderSupported(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === "undefined") return false;
  return "Notification" in window;
}

/** iOS web-browser detection — used to decide whether to surface an App Store
 *  CTA when reminders aren't supported. Excludes Capacitor native iOS. */
export function isIOSWebBrowser(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod|iPad/i.test(navigator.userAgent);
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display === "granted") return true;
      const req = await LocalNotifications.requestPermissions();
      return req.display === "granted";
    } catch (error) {
      logger.warn("Failed to check/request native notification permission", error);
      return false;
    }
  }
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch (error) {
    logger.warn("Failed to request web notification permission", error);
    return false;
  }
}

const WEB_NOTIFICATION_ICON = "/apple-touch-icon.png";

/** In-flight web setTimeout handles, keyed by notification id. */
const webTimers = new Map<number, number>();

function fireWebNotification(n: ScheduledNotification): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(n.title, {
      body: n.body,
      tag: `smart-trip-reminder-${n.id}`,
      icon: WEB_NOTIFICATION_ICON,
      badge: WEB_NOTIFICATION_ICON,
    });
  } catch (error) {
    logger.warn("Failed to fire web notification", error);
  }
}

/**
 * Arm a web timer that fires the notification at `n.at`. `onFired` runs after
 * firing so the caller can clean up its own storage. If the time has already
 * passed, fires immediately.
 */
export function armWebTimer(
  n: ScheduledNotification,
  onFired: () => void,
): void {
  const existing = webTimers.get(n.id);
  if (existing != null) window.clearTimeout(existing);
  const run = () => {
    webTimers.delete(n.id);
    fireWebNotification(n);
    onFired();
  };
  const delay = n.at - Date.now();
  if (delay <= 0) {
    run();
    return;
  }
  webTimers.set(n.id, window.setTimeout(run, delay));
}

function clearWebTimer(id: number): void {
  const handle = webTimers.get(id);
  if (handle != null) {
    window.clearTimeout(handle);
    webTimers.delete(id);
  }
}

/**
 * Schedule a notification on the current platform. On web this arms a timer
 * (and `onFired` is invoked after it fires). Throws if the native scheduler
 * refuses (revoked permission, exact-alarm denied) so callers can surface it.
 */
export async function scheduleNotification(
  n: ScheduledNotification,
  onFired: () => void,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.schedule({
      notifications: [
        { id: n.id, title: n.title, body: n.body, schedule: { at: new Date(n.at) } },
      ],
    });
    return;
  }
  armWebTimer(n, onFired);
}

export async function cancelNotification(id: number): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch (error) {
      logger.warn("Failed to cancel native notification", error);
    }
    return;
  }
  clearWebTimer(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notificationScheduler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificationScheduler.ts src/lib/notificationScheduler.test.ts
git commit -m "feat(notify): extract storage-free notification scheduler"
```

---

## Phase B — Focused-trip store

### Task B1: `FocusedTrip` type, storage, and validation

**Files:**
- Create: `src/lib/focusedTrip.ts`
- Create: `src/lib/focusedTrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/focusedTrip.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import {
  loadFocusedTrip,
  saveFocusedTrip,
  FOCUSED_TRIP_STORAGE_KEY,
  type FocusedTrip,
} from "./focusedTrip";

const base: FocusedTrip = {
  source: "user",
  tripNumber: 35,
  fromStation: "San Rafael",
  toStation: "Larkspur",
  scheduleType: "weekday",
  departureAt: Date.now() + 30 * 60_000,
  arrivalAt: Date.now() + 50 * 60_000,
  reminder: null,
};

describe("focusedTrip storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a record", () => {
    saveFocusedTrip(base);
    expect(loadFocusedTrip()).toEqual(base);
  });

  it("returns null when empty", () => {
    expect(loadFocusedTrip()).toBeNull();
  });

  it("drops a record whose arrivalAt has passed", () => {
    saveFocusedTrip({ ...base, arrivalAt: Date.now() - 1000 });
    expect(loadFocusedTrip()).toBeNull();
    expect(localStorage.getItem(FOCUSED_TRIP_STORAGE_KEY)).toBeNull();
  });

  it("rejects malformed JSON", () => {
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, "{not json");
    expect(loadFocusedTrip()).toBeNull();
  });

  it("clears when saving null", () => {
    saveFocusedTrip(base);
    saveFocusedTrip(null);
    expect(loadFocusedTrip()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/focusedTrip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the type + storage**

```ts
// src/lib/focusedTrip.ts
import type { Station } from "@/types/smartSchedule";

export interface FocusedTripReminder {
  leadMinutes: number;
  /** Epoch ms the notification fires. */
  reminderAt: number;
  title: string;
  body: string;
}

export interface FocusedTrip {
  /** How the trip became focused. Only "user" is produced today; "riding" is
   *  reserved for the deferred riding-detector integration. */
  source: "user";
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** Live-aware epoch ms of departure from fromStation. */
  departureAt: number;
  /** Live-aware epoch ms of arrival at toStation — drives auto-clear. */
  arrivalAt: number;
  /** null = focused with no reminder armed. */
  reminder: FocusedTripReminder | null;
}

export const FOCUSED_TRIP_STORAGE_KEY = "smart-train-focused-trip";
export const FOCUSED_TRIP_CHANGED_EVENT = "smart-train-focused-trip-changed";

function isFocusedTrip(value: unknown): value is FocusedTrip {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const reminderOk =
    r.reminder === null ||
    (typeof r.reminder === "object" &&
      r.reminder !== null &&
      typeof (r.reminder as Record<string, unknown>).leadMinutes === "number" &&
      typeof (r.reminder as Record<string, unknown>).reminderAt === "number" &&
      typeof (r.reminder as Record<string, unknown>).title === "string" &&
      typeof (r.reminder as Record<string, unknown>).body === "string");
  return (
    r.source === "user" &&
    typeof r.tripNumber === "number" &&
    typeof r.fromStation === "string" &&
    typeof r.toStation === "string" &&
    (r.scheduleType === "weekday" || r.scheduleType === "weekend") &&
    typeof r.departureAt === "number" &&
    Number.isFinite(r.departureAt) &&
    typeof r.arrivalAt === "number" &&
    Number.isFinite(r.arrivalAt) &&
    reminderOk
  );
}

/** Read the focused trip, dropping (and clearing) it once its arrival passes. */
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
    if (parsed.arrivalAt <= Date.now()) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/focusedTrip.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/focusedTrip.ts src/lib/focusedTrip.test.ts
git commit -m "feat(focus): focused-trip type, storage, and arrival expiry"
```

---

### Task B2: Legacy migration from the old reminder array

**Files:**
- Modify: `src/lib/focusedTrip.ts`
- Modify: `src/lib/focusedTrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/focusedTrip.test.ts
import { migrateLegacyReminders } from "./focusedTrip";

const LEGACY_KEY = "smart-train-departure-reminders";

describe("migrateLegacyReminders", () => {
  beforeEach(() => localStorage.clear());

  it("promotes the most-recent future legacy reminder and deletes the old key", () => {
    const now = Date.now();
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        { id: 1, tripNumber: 11, fromStation: "A", toStation: "B",
          departureAt: now + 10 * 60_000, reminderAt: now + 5 * 60_000,
          leadMinutes: 5, title: "t1", body: "b1" },
        { id: 2, tripNumber: 22, fromStation: "C", toStation: "D",
          departureAt: now + 40 * 60_000, reminderAt: now + 30 * 60_000,
          leadMinutes: 10, title: "t2", body: "b2" },
      ]),
    );
    const migrated = migrateLegacyReminders();
    expect(migrated?.tripNumber).toBe(22); // later departure wins
    expect(migrated?.reminder?.leadMinutes).toBe(10);
    expect(migrated?.arrivalAt).toBe(migrated?.departureAt); // unknown → equals departure
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadFocusedTrip()?.tripNumber).toBe(22);
  });

  it("returns null and deletes the key when all legacy reminders are past", () => {
    const past = Date.now() - 60 * 60_000;
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        { id: 1, tripNumber: 11, fromStation: "A", toStation: "B",
          departureAt: past, reminderAt: past, leadMinutes: 5, title: "t", body: "b" },
      ]),
    );
    expect(migrateLegacyReminders()).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("is a no-op when there is no legacy key", () => {
    expect(migrateLegacyReminders()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/focusedTrip.test.ts -t migrateLegacyReminders`
Expected: FAIL — `migrateLegacyReminders` not exported.

- [ ] **Step 3: Implement migration**

Append to `src/lib/focusedTrip.ts`:

```ts
const LEGACY_REMINDER_KEY = "smart-train-departure-reminders";

/**
 * One-time migration from the old per-trip reminder array to the single
 * focused trip. Promotes the still-future reminder with the latest departure,
 * preserving its reminder; deletes the legacy key unconditionally. We can't
 * recover the original arrival time from a legacy reminder, so arrivalAt is
 * seeded to departureAt — the focus then clears at departure for migrated
 * records, which is acceptable for a one-shot upgrade path. scheduleType is
 * inferred from the departure date's day-of-week.
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

  future.sort(
    (a, b) => (b.departureAt as number) - (a.departureAt as number),
  );
  const r = future[0];
  const departureAt = r.departureAt as number;
  const day = new Date(departureAt).getDay();
  const scheduleType: "weekday" | "weekend" =
    day === 0 || day === 6 ? "weekend" : "weekday";

  const focused: FocusedTrip = {
    source: "user",
    tripNumber: r.tripNumber as number,
    fromStation: r.fromStation as Station,
    toStation: r.toStation as Station,
    scheduleType,
    departureAt,
    arrivalAt: departureAt,
    reminder: {
      leadMinutes: r.leadMinutes as number,
      reminderAt: r.reminderAt as number,
      title: r.title as string,
      body: r.body as string,
    },
  };
  saveFocusedTrip(focused);
  return focused;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/focusedTrip.test.ts`
Expected: PASS (all focusedTrip tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/focusedTrip.ts src/lib/focusedTrip.test.ts
git commit -m "feat(focus): migrate legacy reminder array to single focused trip"
```

---

### Task B3: Trip reconstruction from static schedule

**Files:**
- Modify: `src/lib/focusedTrip.ts`
- Modify: `src/lib/focusedTrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/focusedTrip.test.ts
import { reconstructFocusedTrip } from "./focusedTrip";
import stations from "@/data/stations";

describe("reconstructFocusedTrip", () => {
  it("finds the ProcessedTrip for the focused leg + trip number", () => {
    const from = stations[0];
    const to = stations[stations.length - 1];
    // Use the real static schedule: pick the first weekday southbound trip.
    const { getFilteredTrips } = require("@/lib/scheduleUtils");
    const trips = getFilteredTrips(from, to, "weekday");
    const target = trips[0];
    const focused = {
      source: "user" as const,
      tripNumber: target.trip,
      fromStation: from,
      toStation: to,
      scheduleType: "weekday" as const,
      departureAt: Date.now() + 60_000,
      arrivalAt: Date.now() + 120_000,
      reminder: null,
    };
    expect(reconstructFocusedTrip(focused)?.trip).toBe(target.trip);
  });

  it("returns null when the trip is no longer in the schedule", () => {
    const focused = {
      source: "user" as const,
      tripNumber: 999999,
      fromStation: stations[0],
      toStation: stations[stations.length - 1],
      scheduleType: "weekday" as const,
      departureAt: Date.now(),
      arrivalAt: Date.now(),
      reminder: null,
    };
    expect(reconstructFocusedTrip(focused)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/focusedTrip.test.ts -t reconstructFocusedTrip`
Expected: FAIL — `reconstructFocusedTrip` not exported.

- [ ] **Step 3: Implement reconstruction**

Append to `src/lib/focusedTrip.ts` (add the import at the top of the file):

```ts
import { getFilteredTrips, type ProcessedTrip } from "@/lib/scheduleUtils";
```

```ts
/**
 * Rebuild the full ProcessedTrip for a focused trip from static schedule data,
 * so the pinned card can render even when the home screen's current from/to is
 * a different leg. Returns null if the trip no longer exists in that schedule
 * (e.g. schedule data changed under a stale focus).
 */
export function reconstructFocusedTrip(
  focused: FocusedTrip,
): ProcessedTrip | null {
  const trips = getFilteredTrips(
    focused.fromStation,
    focused.toStation,
    focused.scheduleType,
  );
  return trips.find((t) => t.trip === focused.tripNumber) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/focusedTrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/focusedTrip.ts src/lib/focusedTrip.test.ts
git commit -m "feat(focus): reconstruct ProcessedTrip for the focused leg"
```

---

## Phase C — React binding + provider

### Task C1: `useFocusedTrip` hook

**Files:**
- Create: `src/hooks/useFocusedTrip.ts`

This hook owns the live read of the store + the action implementations (focus, arm/disarm reminder, clear, drift reschedule). It dispatches `FOCUSED_TRIP_CHANGED_EVENT` so all consumers re-read.

- [ ] **Step 1: Implement the hook**

```ts
// src/hooks/useFocusedTrip.ts
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
  type ScheduledNotification,
} from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";
import { logger } from "@/lib/logger";

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
}

export interface FocusTripInput {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** Scheduled HH:MM departure — stable id key across midnight drift. */
  scheduledDepartureTime: string;
  departureAt: number;
  arrivalAt: number;
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
   *  reminder. Caller is responsible for any "switch trains?" confirmation. */
  const focusTrip = useCallback(async (input: FocusTripInput) => {
    const prev = loadFocusedTrip();
    if (prev?.reminder) {
      await cancelNotification(
        reminderIdFor(prev.tripNumber, prev.departureAt),
      );
    }
    const next: FocusedTrip = {
      source: "user",
      tripNumber: input.tripNumber,
      fromStation: input.fromStation,
      toStation: input.toStation,
      scheduleType: input.scheduleType,
      departureAt: input.departureAt,
      arrivalAt: input.arrivalAt,
      reminder: null,
    };
    saveFocusedTrip(next);
    notifyChange();
  }, []);

  /** Arm (number) or disarm (null) the reminder on the current focused trip. */
  const setReminder = useCallback(
    async (
      leadMinutes: number | null,
      text: ReminderText,
    ): Promise<SetReminderResult> => {
      const current = loadFocusedTrip();
      if (!current) return { ok: false, reason: "no-focus" };
      const id = reminderIdFor(current.tripNumber, current.departureAt);

      if (leadMinutes === null) {
        await cancelNotification(id);
        saveFocusedTrip({ ...current, reminder: null });
        notifyChange();
        return { ok: true };
      }

      const granted = await ensureNotificationPermission();
      if (!granted) return { ok: false, reason: "permission" };

      const reminderAt = current.departureAt - leadMinutes * 60_000;
      const notification: ScheduledNotification = {
        id,
        title: text.title,
        body: text.body,
        at: reminderAt,
      };
      try {
        await scheduleNotification(notification, () => {
          // Web fire cleanup: drop the reminder sub-object, keep the focus.
          const after = loadFocusedTrip();
          if (after) saveFocusedTrip({ ...after, reminder: null });
          notifyChange();
        });
      } catch (error) {
        logger.warn("Failed to schedule focused-trip reminder", error);
        return { ok: false, reason: "schedule-failed" };
      }
      saveFocusedTrip({
        ...current,
        reminder: { leadMinutes, reminderAt, title: text.title, body: text.body },
      });
      notifyChange();
      return { ok: true };
    },
    [],
  );

  const clearFocusedTrip = useCallback(async () => {
    const current = loadFocusedTrip();
    if (current?.reminder) {
      await cancelNotification(reminderIdFor(current.tripNumber, current.departureAt));
    }
    saveFocusedTrip(null);
    notifyChange();
  }, []);

  return { focusedTrip, focusTrip, setReminder, clearFocusedTrip };
}
```

- [ ] **Step 2: Extract `reminderIdFor` into `src/lib/notificationId.ts`**

Create `src/lib/notificationId.ts` by moving `reminderIdFor` out of the old `departureReminder.ts` (lines 42–51), but key it on an **epoch ms** departure for stability (the focused trip stores `departureAt`, not the HH:MM string):

```ts
// src/lib/notificationId.ts
/**
 * Stable 32-bit notification id from trip number + minute-of-day of departure.
 * Minute-of-day (not full date) keeps the id stable when a late train's
 * departure drifts across midnight, so drift reschedules reuse the same id.
 */
export function reminderIdFor(tripNumber: number, departureAtMs: number): number {
  const d = new Date(departureAtMs);
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  return minuteOfDay * 100_000 + (tripNumber % 100_000);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors (the hook + id module compile; `notificationScheduler` and `focusedTrip` resolve).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFocusedTrip.ts src/lib/notificationId.ts
git commit -m "feat(focus): useFocusedTrip hook with reminder arm/disarm"
```

---

### Task C2: Expose the facet on `StationSelection` + provider, with arrival expiry

**Files:**
- Modify: `src/contexts/stationSelection.ts`
- Modify: `src/contexts/StationSelectionContext.tsx`

- [ ] **Step 1: Extend the context interface**

In `src/contexts/stationSelection.ts`, add imports + fields:

```ts
import type { FocusedTrip } from "@/lib/focusedTrip";
import type { FocusTripInput, ReminderText, SetReminderResult } from "@/hooks/useFocusedTrip";
```

Add to the `StationSelection` interface (after `setSelectedTrip`):

```ts
  focusedTrip: FocusedTrip | null;
  focusTrip: (input: FocusTripInput) => Promise<void>;
  setReminder: (leadMinutes: number | null, text: ReminderText) => Promise<SetReminderResult>;
  clearFocusedTrip: () => Promise<void>;
```

- [ ] **Step 2: Wire the hook into the provider**

In `src/contexts/StationSelectionContext.tsx`, inside `StationSelectionProvider`, after the existing setters:

```ts
import { useFocusedTrip } from "@/hooks/useFocusedTrip";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  loadFocusedTrip,
  saveFocusedTrip,
} from "@/lib/focusedTrip";
```

```ts
  const { focusedTrip, focusTrip, setReminder, clearFocusedTrip } =
    useFocusedTrip();

  // Clear the focused trip once the train has arrived (live-aware arrivalAt).
  // A 30s tick is frequent enough that the pinned card disappears promptly
  // without burning cycles. loadFocusedTrip() already drops expired records,
  // so this just nudges consumers to re-read.
  useEffect(() => {
    const tick = window.setInterval(() => {
      const current = loadFocusedTrip(); // returns null + clears if arrived
      if (current === null && localStorage.getItem("smart-train-focused-trip") === null) {
        window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
      }
    }, 30_000);
    return () => window.clearInterval(tick);
  }, []);
```

Add the four fields to the `value` `useMemo` object and its dependency array:

```ts
      focusedTrip,
      focusTrip,
      setReminder,
      clearFocusedTrip,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/stationSelection.ts src/contexts/StationSelectionContext.tsx
git commit -m "feat(focus): expose focused-trip facet on station-selection context"
```

---

## Phase D — UI

### Task D1: Rework `DepartureReminder` into the "Go" control

**Files:**
- Modify: `src/components/DepartureReminder.tsx`
- Modify: `src/components/TripDetailContent.tsx`

The component keeps its props but now:
1. Reads `focusedTrip` from context (via `useStationSelection`).
2. `isThisTripFocused = focusedTrip?.tripNumber === tripNumber && focusedTrip.fromStation === fromStation && focusedTrip.toStation === toStation`.
3. Renders **Go** when not focused; on tap, if a *different* trip is focused → show a confirm; else `focusTrip(...)`.
4. When this trip is focused → show "Going" + the existing slider as the reminder sub-control (calls `setReminder(lead, text)` / `setReminder(null, text)` to disarm) + a **Stop** button calling `clearFocusedTrip()`.

- [ ] **Step 1: Add `arrivalAt` computation + context wiring at the top of the component**

Replace the `useDepartureReminder` block (lines 139–146) with context + derived values:

```tsx
import { useStationSelection } from "@/contexts/stationSelection";
```

```tsx
  const { focusedTrip, focusTrip, setReminder, clearFocusedTrip } =
    useStationSelection();

  const isThisTripFocused =
    focusedTrip != null &&
    focusedTrip.tripNumber === tripNumber &&
    focusedTrip.fromStation === fromStation &&
    focusedTrip.toStation === toStation;

  const isOtherTripFocused = focusedTrip != null && !isThisTripFocused;

  // Arrival timestamp at toStation. Reuse the departure builder, then push to
  // the next day if the arrival HH:MM wrapped before departure (overnight).
  const effectiveArrival = realtimeArrivalTime ?? arrivalTime;
  const arrivalAt = useMemo(() => {
    const a = buildDepartureTimestamp(currentTime, effectiveArrival);
    return a < departureAt ? a + 24 * 60 * 60 * 1000 : a;
  }, [currentTime, effectiveArrival, departureAt]);
```

NOTE: `DepartureReminder` must receive `arrivalTime` and `realtimeArrivalTime` props. Add them to `DepartureReminderProps`:

```tsx
  /** Scheduled arrival time at toStation as "HH:MM". */
  arrivalTime: string;
  /** Live arrival override; takes precedence when set. */
  realtimeArrivalTime?: string | null;
```

- [ ] **Step 2: Pass the new props from `TripDetailContent`**

In `src/components/TripDetailContent.tsx` at the `<DepartureReminder>` usage (line 476), add:

```tsx
            arrivalTime={trip.arrivalTime}
            realtimeArrivalTime={realtimeStatus?.liveArrivalTime ?? null}
```

- [ ] **Step 3: Replace the render branches**

Replace the three render branches (active pill / trigger / picker) so that:

- **Not focused, not picker-open:** render a **Go** button:

```tsx
    return (
      <GutterRow>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGoClick}
          aria-label={t("focusedTrip.go")}
          className="h-9 gap-1.5"
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("focusedTrip.go")}</span>
        </Button>
      </GutterRow>
    );
```

(Import `Navigation` from `lucide-react`.)

- **`handleGoClick`:** if `isOtherTripFocused`, open a confirm dialog; else focus directly:

```tsx
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  const doFocus = useCallback(() => {
    void focusTrip({
      tripNumber,
      fromStation,
      toStation,
      scheduleType: scheduleTypeForLeg(fromStation, toStation),
      scheduledDepartureTime: departureTime,
      departureAt,
      arrivalAt,
    });
  }, [arrivalAt, departureAt, departureTime, focusTrip, fromStation, toStation, tripNumber]);

  const handleGoClick = useCallback(() => {
    if (isOtherTripFocused) setConfirmSwitch(true);
    else doFocus();
  }, [doFocus, isOtherTripFocused]);
```

`scheduleTypeForLeg` is `getTodayScheduleType()` from `@/lib/scheduleUtils` — import it and call with no args (the displayed schedule is today's). Replace the body with:

```tsx
import { getTodayScheduleType } from "@/lib/scheduleUtils";
// ...
        scheduleType: getTodayScheduleType(),
```

- **Confirm dialog** — the repo has `src/components/ui/dialog.tsx` (exports `Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription`) but no `alert-dialog`. Build the confirm from `dialog.tsx` + the existing `Button`. Render it near the top of the returned JSX:

```tsx
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
// ...
  {confirmSwitch && (
    <Dialog open onOpenChange={(o) => !o && setConfirmSwitch(false)}>
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{t("focusedTrip.switchTitle")}</DialogTitle>
          <DialogDescription>
            {t("focusedTrip.switchBody", {
              current: focusedTrip?.tripNumber,
              next: tripNumber,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setConfirmSwitch(false)}>
            {t("focusedTrip.switchCancel")}
          </Button>
          <Button onClick={() => { setConfirmSwitch(false); doFocus(); }}>
            {t("focusedTrip.switchConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )}
```

- **This trip focused:** render the "Going" header + Stop, and keep the existing slider/warning/Set block but driven by `setReminder`. The "Set" button calls:

```tsx
  const handleSet = useCallback(async () => {
    const result = await setReminder(clampedSliderValue, buildText(clampedSliderValue));
    if (result.ok === false) { setPickerError(result.reason === "permission" ? "permission" : "schedule-failed"); return; }
    closePicker();
  }, [buildText, clampedSliderValue, closePicker, setReminder]);
```

When this trip is focused AND has a reminder, show the existing "Remind at X" pill but with a **Stop going** action that calls `void clearFocusedTrip()` in place of the old `cancel`. Disarming just the reminder (keeping focus) calls `void setReminder(null, buildText(0))`.

- [ ] **Step 4: Remove drift effect's dependency on the old hook**

Replace the live-drift effect (lines 170–178) to read from `focusedTrip` and call `setReminder` with the same lead when `departureAt` drifts:

```tsx
  const focusedReminderLead = isThisTripFocused ? focusedTrip?.reminder?.leadMinutes ?? null : null;
  const focusedDepartureAt = isThisTripFocused ? focusedTrip?.departureAt : undefined;
  useEffect(() => {
    if (focusedReminderLead == null || focusedDepartureAt == null) return;
    if (focusedDepartureAt === departureAt) return;
    void setReminder(focusedReminderLead, buildText(focusedReminderLead));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departureAt, focusedReminderLead, focusedDepartureAt]);
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/DepartureReminder.tsx src/components/TripDetailContent.tsx
git commit -m "feat(focus): rework reminder control into Go + reminder sub-option"
```

---

### Task D2: `FocusedTripCard` pinned on the home screen

**Files:**
- Create: `src/components/FocusedTripCard.tsx`
- Modify: `src/components/TrainScheduleApp.tsx`

- [ ] **Step 1: Implement the card**

```tsx
// src/components/FocusedTripCard.tsx
import { useMemo } from "react";
import { Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { reconstructFocusedTrip } from "@/lib/focusedTrip";
import { TripCard } from "./TripCard";

interface FocusedTripCardProps {
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

/**
 * Pinned representation of the user's focused trip ("Go"), shown above the
 * schedule. Always rendered the same way regardless of the home screen's
 * current from/to — the trip is reconstructed from static schedule data via
 * its stored leg. Returns null when nothing is focused or the trip can no
 * longer be found in the schedule.
 */
export function FocusedTripCard({ currentTime, timeFormat }: FocusedTripCardProps) {
  const { t } = useTranslation();
  const { focusedTrip } = useStationSelection();

  const trip = useMemo(
    () => (focusedTrip ? reconstructFocusedTrip(focusedTrip) : null),
    [focusedTrip],
  );

  if (!focusedTrip || !trip) return null;

  const showFerry = false;
  return (
    <section aria-label={t("focusedTrip.pinnedLabel")} className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary uppercase tracking-wide">
        <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
        {t("focusedTrip.going")}
      </div>
      <TripCard
        trip={trip}
        isNextTrip={false}
        isPastTrip={false}
        showFerry={showFerry}
        timeFormat={timeFormat}
        lastUpdated={null}
        fromStation={focusedTrip.fromStation}
        toStation={focusedTrip.toStation}
        currentTime={currentTime}
        selectedTripNumber={null}
        onSelectTrip={() => undefined}
      />
    </section>
  );
}
```

NOTE: live realtime status for the pinned card is out of scope for v1 (the card shows static schedule times; `realtimeStatus` is left undefined). Fine-tuning to wire live status can follow after testing, per the spec's "fine-tune UI after testing" note.

- [ ] **Step 2: Render it on the home screen**

In `src/components/TrainScheduleApp.tsx`, import the card and the `currentTime`/`timeFormat` already in scope. Insert between `<ServiceAlert .../>` (line 201) and `<MapDiagramPreviewCard />` (line 204):

```tsx
import { FocusedTripCard } from "./FocusedTripCard";
// ...
        <FocusedTripCard currentTime={currentTime} timeFormat="12h" />
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/FocusedTripCard.tsx src/components/TrainScheduleApp.tsx
git commit -m "feat(focus): pin focused trip above the schedule on home"
```

---

### Task D3: Dedupe the focused trip's row from the schedule list

**Files:**
- Modify: `src/components/ScheduleResults.tsx`
- Modify: `src/components/TrainScheduleApp.tsx`

- [ ] **Step 1: Add a `hiddenTripNumber` prop to `ScheduleResults`**

In `ScheduleResultsProps` add:

```tsx
  /** A trip number to omit from the list (the focused trip, shown pinned
   *  above). Only applied when it belongs to the displayed leg. */
  hiddenTripNumber?: number | null;
```

Destructure it (default `null`) and filter `visibleTrips` after it's computed:

```tsx
  const dedupedTrips =
    hiddenTripNumber != null
      ? visibleTrips.filter((trip) => trip.trip !== hiddenTripNumber)
      : visibleTrips;
```

Then change the `.map` source from `visibleTrips` to `dedupedTrips`, and base `nextVisibleIndex` on `dedupedTrips`:

```tsx
  const nextVisibleIndex = dedupedTrips.findIndex(
    (trip) => !isTimeInPast(currentTime, trip.departureTime),
  );
```

- [ ] **Step 2: Pass the focused trip number from `TrainScheduleApp`**

In `TrainScheduleApp.tsx`, read `focusedTrip` from `useStationSelection()` (already destructured for other fields) and compute the hidden number only when the focused leg matches the displayed leg:

```tsx
  const hiddenTripNumber =
    focusedTrip &&
    focusedTrip.fromStation === fromStation &&
    focusedTrip.toStation === toStation
      ? focusedTrip.tripNumber
      : null;
```

Pass to `<ScheduleResults ... hiddenTripNumber={hiddenTripNumber} />`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScheduleResults.tsx src/components/TrainScheduleApp.tsx
git commit -m "feat(focus): hide focused trip's duplicate row from the schedule list"
```

---

### Task D4: i18n keys

**Files:**
- Modify: `src/lib/translations/en.json`
- Modify: `src/lib/translations/es.json`

- [ ] **Step 1: Add a `focusedTrip` block to `en.json`** (sibling of `departureReminder`):

```json
  "focusedTrip": {
    "go": "Go — I'm taking this",
    "going": "Going",
    "stop": "Stop",
    "pinnedLabel": "Your focused trip",
    "switchTitle": "Switch trains?",
    "switchBody": "You're set to take Train {{current}}. Switch to Train {{next}}?",
    "switchConfirm": "Switch",
    "switchCancel": "Cancel"
  },
```

- [ ] **Step 2: Add the matching `focusedTrip` block to `es.json`:**

```json
  "focusedTrip": {
    "go": "Voy — Tomaré este",
    "going": "En camino",
    "stop": "Detener",
    "pinnedLabel": "Tu viaje activo",
    "switchTitle": "¿Cambiar de tren?",
    "switchBody": "Vas a tomar el tren {{current}}. ¿Cambiar al tren {{next}}?",
    "switchConfirm": "Cambiar",
    "switchCancel": "Cancelar"
  },
```

- [ ] **Step 3: Verify both JSON files parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/lib/translations/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/lib/translations/es.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/translations/en.json src/lib/translations/es.json
git commit -m "feat(focus): add focused-trip i18n strings (en, es)"
```

---

## Phase E — Cutover & cleanup

### Task E1: Swap app boot rehydrate + run migration

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the boot call**

Find `rehydrateWebReminders()` in `src/App.tsx` (~line 43) and replace its import + call with a focused-trip boot routine. Add to `focusedTrip.ts`:

```ts
import { armWebTimer } from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";

let booted = false;
/** One-time boot: migrate legacy reminders, then re-arm the web timer for a
 *  surviving reminder (no-op on native — the OS owns scheduled notifications). */
export function bootFocusedTrip(): void {
  if (booted) return;
  booted = true;
  migrateLegacyReminders();
  const focused = loadFocusedTrip();
  if (!focused?.reminder) return;
  armWebTimer(
    {
      id: reminderIdFor(focused.tripNumber, focused.departureAt),
      title: focused.reminder.title,
      body: focused.reminder.body,
      at: focused.reminder.reminderAt,
    },
    () => {
      const after = loadFocusedTrip();
      if (after) saveFocusedTrip({ ...after, reminder: null });
    },
  );
}
```

In `src/App.tsx`, replace `rehydrateWebReminders()` usage with `bootFocusedTrip()` (update the import accordingly).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/lib/focusedTrip.ts
git commit -m "feat(focus): boot migration + web-reminder rehydrate on app start"
```

---

### Task E2: Delete the dead legacy modules

**Files:**
- Delete: `src/hooks/useDepartureReminder.ts`
- Delete: `src/lib/departureReminder.ts`
- Delete: `src/lib/departureReminder.test.ts` (if present)

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "useDepartureReminder\|departureReminder\"" src --include="*.ts" --include="*.tsx" | grep -v notificationScheduler`
Expected: no results referencing the deleted modules (only `notificationScheduler`/`focusedTrip`/`notificationId` remain). If `DepartureReminder.tsx` still imports `isReminderSupported`/`isIOSWebBrowser`, point those imports at `@/lib/notificationScheduler`.

- [ ] **Step 2: Delete the files**

```bash
git rm src/hooks/useDepartureReminder.ts src/lib/departureReminder.ts
git rm src/lib/departureReminder.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Full verification**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run && npx vite build`
Expected: typecheck clean, all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(focus): remove legacy per-trip reminder modules"
```

---

### Task E3: Manual verification

- [ ] **Step 1: Run the app**

Run: `npm run dev-vercel` (or `USE_SAMPLE_DATA=true npm run dev`).

- [ ] **Step 2: Walk the flow**

Verify in the browser:
- Open a trip → tap **Go** → trip appears pinned above the schedule; its row is gone from the list below.
- Within the focused trip, set a reminder → "Remind at X" shows; reload the page → pinned card + reminder persist.
- Open a *different* trip → tap **Go** → "Switch trains?" confirm appears; confirm → pin updates to the new trip.
- Change the home pickers to a different leg → the pinned card still shows the focused trip (reconstructed).
- **Stop** → pin disappears, the trip returns to the schedule list.
- Set `?devTrip=` / use a near-departure fixture if available to confirm the card clears after the (live-aware) arrival time passes.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/go-focused-trip
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Go control (D1), single record + replace (B1/C1), switch confirm (D1), pinned always-visible card via reconstruction (B3/D2), dedupe row (D3), arm/disarm reminder reused via extracted scheduler (A1/C1), arrival auto-clear (B1/C2), live drift (D1 step 4 + C1), migration (B2/E1), deep-link untouched (no change to `selectedTripNumber`), iOS-web degradation (capability checks preserved in A1, used in D1), `source` seam (B1). ✔
- **Placeholder scan:** none — every code step has concrete content. The one acknowledged v1 limitation (no live realtime status on the pinned card) is called out explicitly in D2, matching the spec's "fine-tune UI after testing." ✔
- **Type consistency:** `reminderIdFor(tripNumber, departureAtMs)` is epoch-keyed in `notificationId.ts` and called identically in C1 + E1. `ScheduledNotification {id,title,body,at}` consistent across A1/C1/E1. `FocusedTrip`/`FocusedTripReminder` consistent across B1/C1/D2. `focusTrip`/`setReminder`/`clearFocusedTrip` signatures match between C1, the context interface (C2), and D1. ✔
