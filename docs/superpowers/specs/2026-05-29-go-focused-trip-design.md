# Design: "Go" — a single user-focused trip

**Date:** 2026-05-29
**Status:** Approved (design); implementation pending
**Scope:** Spec #1 of 2. The riding-detector ↔ focused-trip integration is deferred to a follow-up spec (#2).

## Problem

Today, departure reminders are **trip-scoped and unbounded**: a user can set one reminder per trip from inside each trip's detail sheet, stored as an array. There is no home-screen visibility — you only see a reminder by reopening that specific trip. There is also no concept of "the trip I'm taking"; the only trip-the-user-cares-about signal is the fully-automatic riding detector (`useUserRiding`), which the user cannot influence.

We want:

1. A single, global, user-indicated **focused trip** ("I'm taking this train"), set via a **Go** button.
2. That focused trip **always visible on the home screen**, pinned above the schedule.
3. The reminder demoted to a **sub-option** of the focused trip (opt-in, not forced).
4. A data model that **leaves a seam** for the riding detector to later contribute to / confirm the focused trip — without building that integration now.

## Non-goals (deferred to spec #2)

- Wiring the riding detector to set, confirm, or override the focused trip.
- Conflict resolution between a user-set focus and a riding-detected train.
- Live trip-progress UI hanging off the focused trip.

## Concept

A trip becomes **focused** when the user taps **Go** in the trip detail sheet. At most **one** trip is focused at a time. The focused trip:

- Renders as a **pinned card at the top of the home screen**, always, in one consistent presentation regardless of whether its leg matches the currently-selected stations.
- Carries an **optional reminder** (lead-time notification), off by default.
- **Auto-clears when the train arrives** at the focused destination (its live-aware arrival time passes) — so the trip stays focused for the whole journey, not just up to boarding. This aligns the focused-trip window with the ride itself (and with the riding-detection window the deferred spec will hook into).

The reminder is no longer the headline feature — it is one capability of the focused trip.

## Architecture

### Provider — same provider, separate facet

Extend the existing `StationSelectionProvider` (`src/contexts/StationSelectionContext.tsx`) to hold the focused-trip facet **alongside** `selectedTripNumber`. They share the provider but remain **distinct values with distinct lifecycles**:

| Concern | `selectedTripNumber` (existing) | `focusedTrip` (new) |
| --- | --- | --- |
| Meaning | which trip detail sheet is open | the trip the user is taking |
| Set by | tapping a trip card / deep link | tapping **Go** |
| Cleared by | closing the sheet → `null` | un-focus, or train departs |
| URL-synced | yes (`?trip=&type=`, shareable) | no |
| Expiry | 24h (native persist) | until departure |
| Deep link `?trip=` | opens the sheet | does **not** focus |

Combining them into one value was explicitly rejected: closing a sheet would cancel the reminder, and sharing a `?trip=` link would arm a reminder on the recipient's device.

### Data model

```ts
type FocusedTrip = {
  source: "user";                    // seam: future "riding"
  tripNumber: number;
  fromStation: Station;              // the focused leg — independent of the
  toStation: Station;                //   home screen's current from/to
  scheduleType: "weekday" | "weekend"; // so the static lookup picks the right day
  departureAt: number;               // live-aware epoch ms (departure from fromStation)
  arrivalAt: number;                 // live-aware epoch ms (arrival at toStation) — drives auto-clear
  reminder: {                        // null = focused, no reminder armed
    leadMinutes: number;
    reminderAt: number;              // epoch ms the notification fires
    title: string;
    body: string;
  } | null;
};
```

The `source` field is the only concession to the deferred riding integration: it is always `"user"` in this spec, but its presence means spec #2 can add `"riding"` without a schema migration.

### Context API (added to the provider value)

- `focusedTrip: FocusedTrip | null`
- `setFocusedTrip(trip: { tripNumber; fromStation; toStation; scheduleType; departureAt; arrivalAt }): void`
  — focuses a trip with no reminder. Silent when nothing is focused or when re-focusing the same trip. **Callers are responsible for confirming a switch** when a *different* trip is already focused (see UI).
- `setReminder(leadMinutes: number | null): void` — arms (number) or disarms (`null`) the reminder on the currently-focused trip. No-op if nothing is focused.
- `clearFocusedTrip(): void` — un-focuses and cancels any armed reminder.

### Persistence

- Single-object localStorage key (e.g. `"smart-train-focused-trip"`), replacing the old array key `"smart-train-departure-reminders"`.
- **Migration** (one-time, on first load): if the old array key exists, promote the most-recent entry whose departure is still in the future to a `FocusedTrip` (preserving its reminder), discard the rest, and delete the old key.

### Scheduling layer — reused unchanged

`src/lib/departureReminder.ts` already handles native (`@capacitor/local-notifications`), web (`setTimeout` + Notification API), cancellation, and boot-time rehydration. This spec **does not change how notifications fire** — only the `reminder` sub-object drives those existing functions:

- `setReminder(n)` → cancel any existing, compute `reminderAt`, schedule.
- `setReminder(null)` / `clearFocusedTrip()` → cancel.

**Live drift:** the current `useDepartureReminder` hook recomputes `reminderAt` and reschedules when a trip's live departure time changes. That behavior must be preserved when the hook's logic moves into the provider: as the focused trip's live-aware times drift (delay/recovery), recompute `departureAt`, `arrivalAt`, and `reminder.reminderAt` and reschedule the notification. Auto-clear keys off the live-aware `arrivalAt`, so a delayed train stays focused until its actual arrival.

## UI behavior

### Trip detail sheet (refactor of `DepartureReminder.tsx`)

- **This trip not focused:** a **Go** button ("I'm taking this train").
- **This trip focused:** a "Going" state showing the lead-time reminder slider as a sub-control (off by default) plus a **Stop** (un-focus) affordance.
- **A different trip focused:** Go still shows; tapping it opens a **confirmation** — _"You're set to take Train {n}. Switch to Train {m}?"_ → **Switch** / **Cancel**. Only a genuine switch prompts; first focus and re-tapping the focused trip do not.

### Home screen — `FocusedTripCard`

- Rendered **pinned at the top** of the schedule area, between `ServiceAlert` and `MapDiagramPreviewCard` (`TrainScheduleApp.tsx` ~line 201–204).
- Reuses `TripCard` with a "focused" treatment (e.g. ring + "Going" badge) and a reminder-status line ("remind 12 min before" / "no reminder").
- **Always shown the same way**, regardless of leg. Because the focused leg may differ from the home screen's current from/to, the card's `ProcessedTrip` is **reconstructed from static schedule data** via the stored leg:
  `getFilteredTrips(focused.fromStation, focused.toStation, focused.scheduleType).find(t => t.trip === focused.tripNumber)`.
  Live status is keyed by departure time and re-fetched as elsewhere. Always-pinning dissolves the cross-leg visibility problem — no separate chip is needed.
- Tapping the card opens the trip detail sheet (Go/Stop + reminder controls).

### Schedule list (`ScheduleResults`)

- When the focused trip is on the **currently-displayed leg**, **hide its normal chronological row** so the train isn't shown twice (the pinned card is its one representation).
- Injection logic mirroring the existing `selectedTripNumber` handling (`ScheduleResults.tsx:75-83`) is not needed for the focused card itself (it's pinned separately), but the dedupe filter is.

## Lifecycle

- A trip stays focused from **Go** through the whole ride. The provider runs a minute-interval that calls `clearFocusedTrip()` once `focusedTrip.arrivalAt <= Date.now()` (live-aware). At that point the pinned card disappears.
- Pre-departure, the focused trip is deduped out of the schedule list (its row is hidden under the pinned card). Post-departure it naturally falls out of the "upcoming from origin" list anyway, so the pinned card becomes its sole on-screen representation for the duration of the ride.
- **Stop** (manual un-focus) is available throughout — including if the user tapped Go but never boarded; otherwise the focus self-clears at `arrivalAt`.
- Boot rehydration of web reminder timers continues via the existing `rehydrateWebReminders()` path.

## Edge cases

- **No from/to selected:** the pinned card still shows (focus is independent of selection).
- **iOS web (no notifications):** Go/focus works everywhere; the reminder sub-control degrades to the existing App Store CTA (commit `8fed9b8`).
- **Day rollover with app left open:** the minute-interval clears the focused trip once its departure passes; a new day's focus is set fresh by the user.
- **Deep link `?trip=`:** sets `selectedTripNumber` only — never focuses.

## Testing

- Unit: migration from old array key → single focused trip (most-recent-future wins; old key deleted).
- Unit: `setFocusedTrip` replace semantics; `setReminder(n|null)` arms/cancels via the scheduling layer (mock `departureReminder.ts`).
- Unit: auto-clear when `arrivalAt` passes (and *not* at `departureAt`); delayed-arrival keeps it focused longer via live drift.
- Unit: `FocusedTripCard` reconstruction picks the correct `ProcessedTrip` for a cross-leg focus.
- Unit: `ScheduleResults` hides the focused trip's row only when on the matching leg.
- Component/interaction: switch-confirmation appears only on a genuine train change.

## Open seams for spec #2 (riding integration)

- `FocusedTrip.source` gains `"riding"`.
- Define precedence when a user focus and a riding latch disagree (who wins, auto-promote, confirm).
- Potentially feed a user focus into `useUserRiding` as a prior to bias/seed the latch.
