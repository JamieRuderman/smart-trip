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
