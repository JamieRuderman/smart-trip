import { useMemo, useState } from "react";
import { Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { reconstructFocusedTrip, type FocusedTrip } from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { TripCard } from "./TripCard";

interface FocusedTripCardProps {
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

/**
 * Pinned representation of the user's focused trip ("Go"), shown above the
 * schedule. Always rendered the same way regardless of the home screen's
 * current from/to — reconstructed from static schedule, with live realtime
 * status overlaid. Returns null when nothing is focused or the trip can no
 * longer be found in the schedule.
 */
export function FocusedTripCard({ currentTime, timeFormat }: FocusedTripCardProps) {
  const { focusedTrip } = useStationSelection();
  const trip = useMemo(
    () => (focusedTrip ? reconstructFocusedTrip(focusedTrip) : null),
    [focusedTrip],
  );
  if (!focusedTrip || !trip) return null;
  return (
    <FocusedTripCardInner
      focusedTrip={focusedTrip}
      trip={trip}
      currentTime={currentTime}
      timeFormat={timeFormat}
    />
  );
}

function FocusedTripCardInner({
  focusedTrip,
  trip,
  currentTime,
  timeFormat,
}: {
  focusedTrip: FocusedTrip;
  trip: ProcessedTrip;
  currentTime: Date;
  timeFormat: "12h" | "24h";
}) {
  const { t } = useTranslation();
  // The focused trip's row is hidden from the schedule list (deduped), so this
  // pinned card is the place to open its detail and manage it (reminder, Stop).
  // TripCard drives its detail sheet off selectedTripNumber, so hold that here.
  const [detailOpen, setDetailOpen] = useState(false);
  const trips = useMemo(() => [trip], [trip]);
  const { statusMap, canceledByStartTime, lastUpdated } = useTripRealtimeStatusMap(
    focusedTrip.fromStation,
    focusedTrip.toStation,
    trips,
  );

  const realtimeStatus = useMemo(() => {
    const primary = statusMap.get(trip.departureTime);
    if (primary) return primary;
    if (canceledByStartTime.size > 0) {
      for (const time of trip.times) {
        const secondary = canceledByStartTime.get(time);
        if (secondary) return secondary;
      }
    }
    return null;
  }, [statusMap, canceledByStartTime, trip]);

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
        showFerry={false}
        timeFormat={timeFormat}
        realtimeStatus={realtimeStatus}
        lastUpdated={lastUpdated}
        fromStation={focusedTrip.fromStation}
        toStation={focusedTrip.toStation}
        currentTime={currentTime}
        selectedTripNumber={detailOpen ? trip.trip : null}
        onSelectTrip={(n) => setDetailOpen(n === trip.trip)}
      />
    </section>
  );
}
