import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useStopInference } from "@/hooks/useStopInference";
import { useTripStatus } from "@/hooks/useTripStatus";
import { computeMinutesUntil } from "@/lib/timeUtils";
import { SHEET_EASING, SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import { TripDetailContent } from "./TripDetailContent";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

export interface TripDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  isNextTrip: boolean;
  showFerry: boolean;
}

/** How long after arrival before the sheet goes grey ("Ended X ago"). */
const ENDED_THRESHOLD_MIN = 30;

/**
 * TripDetailSheet — layout-only wrapper.
 *
 * Responsible for:
 *  - Lifting useGeolocation and useStopInference so the mobile drag handle
 *    and TripDetailContent share exactly the same headerBg colour.
 *  - Rendering the mobile bottom-sheet (portal + swipe-to-dismiss) or the
 *    desktop Dialog.
 *
 * All trip content is delegated to TripDetailContent.
 */
export function TripDetailSheet({
  isOpen,
  onClose,
  ...rest
}: TripDetailSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Geolocation is lifted here so the drag handle (rendered in this component)
  // can share the same position data used by TripDetailContent for the header colour.
  const { lat, lng, loading: locationLoading, requestLocation } = useGeolocation({
    watch: isOpen,
    autoRequestOnNative: false,
  });

  // Minutes since arrival — positive means the trip has ended.
  const arrivalTime = rest.realtimeStatus?.liveArrivalTime ?? rest.trip.arrivalTime;
  const minutesAfterArrival = -(computeMinutesUntil(rest.currentTime, arrivalTime));

  const isEnded = minutesAfterArrival > ENDED_THRESHOLD_MIN;

  // Single source of truth for the coloured header band used by both the
  // drag handle (here) and TripDetailContent's header.
  const { currentAccent, hasStarted } = useStopInference({
    trip: rest.trip,
    fromStation: rest.fromStation,
    toStation: rest.toStation,
    currentTime: rest.currentTime,
    realtimeStatus: rest.realtimeStatus,
    currentLat: lat,
    currentLng: lng,
  });

  const { headerBg: tripStatusBg } = useTripStatus(rest.realtimeStatus, rest.isNextTrip);

  const accentBg = {
    destructive: "bg-destructive",
    gold: "bg-smart-gold",
    green: rest.isNextTrip || hasStarted ? "bg-smart-train-green" : "bg-smart-neutral",
    muted: "bg-smart-neutral",
    default: "bg-smart-neutral",
  } as const;

  // Ended trips always go grey; otherwise use the accent-matched colour.
  const headerBg = isEnded ? "bg-smart-neutral" : (accentBg[currentAccent] ?? tripStatusBg);

  // Prevent body scroll when sheet is open on mobile.
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, isMobile]);

  // ── Swipe-to-dismiss ──────────────────────────────────────────────────────
  const touchStartY = useRef<number | null>(null);
  const currentTranslateY = useRef(0);
  const DISMISS_TRANSITION = `transform ${SHEET_TRANSITION_MS}ms ${SHEET_EASING}`;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = "translateY(0)";
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || !sheetRef.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta < 0) return;
    currentTranslateY.current = delta;
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  };

  const handleTouchEnd = () => {
    if (!sheetRef.current) return;
    const el = sheetRef.current;
    if (currentTranslateY.current > 100) {
      onClose();
      el.style.transition = DISMISS_TRANSITION;
      el.style.transform = "translateY(110%)";
      setTimeout(() => {
        el.style.transform = "";
        el.style.transition = "";
      }, SHEET_TRANSITION_MS);
    } else {
      el.style.transition = DISMISS_TRANSITION;
      el.style.transform = "translateY(0)";
      setTimeout(() => {
        el.style.transform = "";
        el.style.transition = "";
      }, SHEET_TRANSITION_MS);
    }
    touchStartY.current = null;
    currentTranslateY.current = 0;
  };

  // ── Shared content props ──────────────────────────────────────────────────
  const contentProps = {
    ...rest,
    onClose,
    headerBg,
    minutesAfterArrival,
    lat,
    lng,
    locationLoading,
    requestLocation,
  };

  // ── Desktop dialog ────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg w-[calc(100vw-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col [&>button.absolute]:hidden">
          <DialogTitle className="sr-only">
            {t("tracker.tripDetailsAria", { trip: rest.trip.trip })}
          </DialogTitle>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <TripDetailContent {...contentProps} showCloseButton />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Mobile bottom sheet ───────────────────────────────────────────────────
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-background/40 dark:bg-background/50 backdrop-blur-[8px] transition-opacity",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        style={{ transitionDuration: `${SHEET_TRANSITION_MS}ms` }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={t("tracker.tripDetailsAria", { trip: rest.trip.trip })}
        aria-modal="true"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50",
          "bg-card rounded-t-2xl overflow-hidden",
          "[box-shadow:0_0_8px_rgba(0,0,0,0.35)]",
          "max-h-[92dvh] flex flex-col",
          "transition-transform",
          isOpen ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          transitionDuration: `${SHEET_TRANSITION_MS}ms`,
          transitionTimingFunction: SHEET_EASING,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle — same headerBg as TripDetailContent's header band */}
        <div className={cn("flex justify-center pt-3 pb-1 shrink-0", headerBg)}>
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>

        <TripDetailContent {...contentProps} showCloseButton={false} />
      </div>
    </>,
    document.body
  );
}
