import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  anchorLiveTime,
  focusedDepartureInstant,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import { useNow } from "@/hooks/useNow";
import { formatClockTime } from "@/lib/timeUtils";

/**
 * Invisible app-level worker that keeps an ARMED leave-reminder aligned with
 * realtime departure drift. Lives at the root (like {@link LiveActivitySync})
 * because the only other reschedule path — DepartureReminder's drift effect —
 * exists solely inside the trip detail sheet: with the sheet closed, a train
 * could slip 20 minutes and the OS alarm would still fire at the original,
 * pre-delay time, telling the rider to leave far too early. Runs on every
 * platform (web timers, Android alarms, iOS AlarmKit alike).
 *
 * Reschedules through the context's idempotent `rescheduleReminder` (no-op
 * when the fire time and text are unchanged; same-id re-arm, so a failed
 * reschedule degrades to "fires at the old time" rather than vanishing).
 *
 * IMPORTANT: this must compute the same departure instant as
 * DepartureReminder's in-sheet drift effect in every feed state (live
 * present → anchored live; absent → static). Any divergence — e.g. holding a
 * last-seen live value here — would make the two effects re-arm the alarm
 * back and forth while the sheet is open during a feed hiccup.
 */
export function ReminderDriftSync() {
  const { focusedTrip } = useStationSelection();
  if (!focusedTrip?.reminder) return null;
  const key = `${focusedTrip.tripNumber}-${focusedTrip.serviceDate}-${focusedTrip.fromStation}-${focusedTrip.toStation}`;
  return <ReminderDriftSyncInner key={key} focusedTrip={focusedTrip} />;
}

function ReminderDriftSyncInner({ focusedTrip }: { focusedTrip: FocusedTrip }) {
  const { rescheduleReminder } = useStationSelection();
  const { t, i18n } = useTranslation();
  // 30s tick between realtime polls, matching the other root workers.
  const nowSeconds = useNow(30_000);
  const now = nowSeconds * 1000;

  // Shared focused-trip realtime derivation (same lookup as the pinned card
  // and LiveActivitySync, so all surfaces track the same live departure).
  const { live } = useFocusedTripLive(focusedTrip, now);

  const staticDepartureAt = useMemo(
    () => focusedDepartureInstant(focusedTrip),
    [focusedTrip],
  );
  // live ?? static — mirrors DepartureReminder exactly (see doc comment).
  const departureAt =
    staticDepartureAt != null && live?.liveDepartureTime
      ? anchorLiveTime(staticDepartureAt, live.liveDepartureTime)
      : staticDepartureAt;

  const reminder = focusedTrip.reminder;
  const reminderAt = reminder?.reminderAt ?? null;
  const leadMinutes = reminder?.leadMinutes ?? null;

  useEffect(() => {
    if (departureAt == null || reminderAt == null || leadMinutes == null) {
      return;
    }
    // Unclamped, matching DepartureReminder's drift short-circuit and
    // setReminder's stored value — a Date.now() clamp here would make the
    // comparison non-deterministic and spin a re-arm loop.
    const expected = departureAt - leadMinutes * 60_000;
    if (expected === reminderAt) return;
    void rescheduleReminder(departureAt, {
      title: t("departureReminder.notificationTitle", {
        station: focusedTrip.fromStation,
      }),
      body: t("departureReminder.notificationBody", {
        leadMinutes,
        station: focusedTrip.fromStation,
        // The app renders 12h everywhere today (see TrainScheduleApp).
        time: formatClockTime(departureAt, "12h", i18n.language),
        trip: focusedTrip.tripNumber,
      }),
    });
  }, [
    departureAt,
    reminderAt,
    leadMinutes,
    focusedTrip.fromStation,
    focusedTrip.tripNumber,
    rescheduleReminder,
    t,
    i18n.language,
  ]);

  return null;
}
