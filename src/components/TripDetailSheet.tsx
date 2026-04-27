import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTripProgress } from "@/hooks/useTripProgress";
import { TripDetailContent } from "./TripDetailContent";
import { AppSheet } from "@/components/ui/app-sheet";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus, VehiclePositionMatch } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

export interface TripDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  lastUpdated: Date | null;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  isNextTrip: boolean;
  showFerry: boolean;
  /** Dev-only: override the live vehicle position hook result (used by devFixtures). */
  vehiclePositionOverride?: VehiclePositionMatch | null;
}

/**
 * TripDetailSheet — wires trip-progress and renders TripDetailContent inside
 * the shared {@link AppSheet} chrome (desktop dialog / mobile bottom sheet
 * with swipe-to-dismiss). The colored drag-handle band uses the live
 * `headerBg` so handle and content header stay in sync.
 */
export function TripDetailSheet({
  isOpen,
  onClose,
  ...rest
}: TripDetailSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // Single hook for all trip progress logic: geolocation, vehicle matching,
  // GPS inference, stop inference, distance calculations, and derived state.
  const progress = useTripProgress({
    trip: rest.trip,
    fromStation: rest.fromStation,
    toStation: rest.toStation,
    currentTime: rest.currentTime,
    realtimeStatus: rest.realtimeStatus,
    isNextTrip: rest.isNextTrip,
    isOpen,
    vehiclePositionOverride: rest.vehiclePositionOverride,
  });

  const ariaLabel = t("tracker.tripDetailsAria", { trip: rest.trip.trip });

  return (
    <AppSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={ariaLabel}
      handleSlot={
        // Colored drag-handle band keyed off the same headerBg as
        // TripDetailContent's header row, so the two read as one band.
        <div
          className={cn(
            "flex justify-center pt-3 pb-1 shrink-0",
            progress.headerBg,
          )}
        >
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>
      }
    >
      <TripDetailContent
        {...rest}
        onClose={onClose}
        progress={progress}
        showCloseButton={!isMobile}
      />
    </AppSheet>
  );
}
