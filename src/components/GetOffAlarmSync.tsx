import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { focusedTripKey, type FocusedTrip } from "@/lib/focusedTrip";
import {
  buildGetOffAlarmText,
  getOffAlarmTiming,
  rescheduleGetOffAlarm,
} from "@/lib/getOffAlarm";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import { useNow } from "@/hooks/useNow";

/** Keeps an armed get-off alarm on the live arrival, whatever view is open. */
export function GetOffAlarmSync() {
  const { focusedTrip } = useStationSelection();
  if (!focusedTrip?.getOffAlarm) return null;
  return <GetOffAlarmSyncInner key={focusedTripKey(focusedTrip)} focusedTrip={focusedTrip} />;
}

function GetOffAlarmSyncInner({ focusedTrip }: { focusedTrip: FocusedTrip }) {
  const { t, i18n } = useTranslation();
  const now = useNow(30_000) * 1000;
  const { live } = useFocusedTripLive(focusedTrip, now);
  // Only a live prediction moves the alarm: before the feed loads, or while a
  // late train drops out of it, falling back to the timetable would ring early.
  const timing = live?.liveArrivalTime ? getOffAlarmTiming(focusedTrip, live) : null;
  const fireAt = timing?.fireAt ?? null;
  const arrivalAt = timing?.arrivalAt ?? null;

  useEffect(() => {
    if (fireAt == null || arrivalAt == null) return;
    void rescheduleGetOffAlarm(
      focusedTrip,
      fireAt,
      buildGetOffAlarmText(t, i18n.language, {
        toStation: focusedTrip.toStation,
        tripNumber: focusedTrip.tripNumber,
        arrivalAt,
      }),
    );
  }, [focusedTrip, fireAt, arrivalAt, t, i18n.language]);

  return null;
}
