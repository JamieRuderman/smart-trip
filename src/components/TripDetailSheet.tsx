import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useStopInference } from "@/hooks/useStopInference";
import { useVehiclePositionForTrip } from "@/hooks/useVehiclePositions";
import { stateBg } from "@/lib/tripTheme";
import {
  getDistanceToStationKm,
  stationIndexMap,
} from "@/lib/stationUtils";
import { isNearSelectedRoute, selectNextStopTarget } from "@/lib/tripProgress";
import { computeMinutesUntil } from "@/lib/timeUtils";
import { SHEET_EASING, SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import { TripDetailContent } from "./TripDetailContent";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus, VehiclePositionMatch } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { TRIP_ENDED_THRESHOLD_MIN } from "@/lib/tripConstants";

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
  const {
    lat,
    lng,
    accuracy,
    speedMps,
    timestampMs,
    loading: locationLoading,
    requestLocation,
  } = useGeolocation({
    watch: isOpen,
    autoRequestOnNative: false,
  });

  // Minutes since arrival — positive means the trip has ended.
  const arrivalTime = rest.realtimeStatus?.liveArrivalTime ?? rest.trip.arrivalTime;
  const minutesAfterArrival = -(computeMinutesUntil(rest.currentTime, arrivalTime));

  const isEnded = minutesAfterArrival > TRIP_ENDED_THRESHOLD_MIN;

  // ── Vehicle position matching ─────────────────────────────────────────────
  // Derive the trip's origin departure time (same logic as useTripRealtimeStatusMap).
  // directionId: 0 = southbound (Windsor → Larkspur), 1 = northbound.
  const fromIdx = stationIndexMap[rest.fromStation] ?? 0;
  const toIdx = stationIndexMap[rest.toStation] ?? 0;
  const isSouthbound = fromIdx < toIdx;
  const originStartTime = isSouthbound
    ? rest.trip.times[0]?.slice(0, 5)        // "HH:MM" of first stop
    : rest.trip.times[rest.trip.times.length - 1]?.slice(0, 5);
  const tripDirectionId = isSouthbound ? 0 : 1;
  // Today's date in YYYYMMDD format (local time).
  const todayYYYYMMDD = (() => {
    const d = rest.currentTime;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  })();

  const liveVehiclePosition = useVehiclePositionForTrip(
    originStartTime,
    todayYYYYMMDD,
    tripDirectionId
  );
  // Dev fixtures can inject a vehiclePosition override; live hook result used otherwise.
  const vehiclePosition = rest.vehiclePositionOverride !== undefined
    ? rest.vehiclePositionOverride
    : liveVehiclePosition;

  const progressHint =
    vehiclePosition?.currentStation != null
      ? {
          source: "vehicle" as const,
          station: vehiclePosition.currentStation,
          status: vehiclePosition.currentStatus,
        }
      : null;

  // Single source of truth for the coloured header band used by both the
  // drag handle (here) and TripDetailContent's header.
  const { currentAccent, hasStarted, displayStops, currentIndex } = useStopInference({
    trip: rest.trip,
    fromStation: rest.fromStation,
    toStation: rest.toStation,
    currentTime: rest.currentTime,
    realtimeStatus: rest.realtimeStatus,
    progressHint,
  });



  const gpsAgeMs = timestampMs == null ? Infinity : Date.now() - timestampMs;
  const hasReliableGps =
    lat != null &&
    lng != null &&
    accuracy != null &&
    accuracy <= 65 &&
    gpsAgeMs <= 20_000;

  const nearestOnRoute =
    hasReliableGps && displayStops.length > 0
      ? displayStops.reduce(
          (best, station, index) => {
            const km = getDistanceToStationKm(lat!, lng!, station);
            return km < best.km ? { station, index, km } : best;
          },
          { station: displayStops[0], index: 0, km: Number.POSITIVE_INFINITY },
        )
      : null;

  const routeDistanceKm = nearestOnRoute?.km ?? Number.POSITIVE_INFINITY;
  const isNearRoute = isNearSelectedRoute(routeDistanceKm);
  // Phone GPS on-train inference is only used when vehicle position feed has no match.
  const inferredOnTrain =
    vehiclePosition == null &&
    hasReliableGps &&
    isNearRoute &&
    speedMps != null &&
    speedMps >= 5.5 &&
    speedMps <= 45;

  const useGpsForProgress =
    vehiclePosition == null && hasReliableGps && (inferredOnTrain || routeDistanceKm <= 0.35);

  // Which source is actively driving the progress indicator.
  const activeProgressSource: "vehicle" | "gps" | "schedule" =
    vehiclePosition?.currentStation != null && displayStops.includes(vehiclePosition.currentStation)
      ? "vehicle"
      : useGpsForProgress
      ? "gps"
      : "schedule";

  // Ended trips always go grey.
  // "future" (not yet started) goes green when this is the next trip, neutral otherwise.
  const headerBg = isEnded
    ? "bg-smart-neutral"
    : stateBg[currentAccent === "future" && rest.isNextTrip ? "ontime" : currentAccent];

  // Distance to the next upcoming stop (mi), shown when GPS is available.
  // Before departure: distance to the origin station (useful when walking to the platform).
  // After departure:  distance to the current highlighted stop (the green one = where you're heading).
  const nextStop =
    lat == null || lng == null
      ? null
      : selectNextStopTarget({
          displayStops,
          currentIndex,
          nearestOnRouteIndex: nearestOnRoute?.index ?? null,
          useGpsForProgress,
        });
  const distanceToNextStopMi =
    nextStop != null && lat != null && lng != null
      ? getDistanceToStationKm(lat, lng, nextStop) * 0.621371
      : null;

  // Distance from user's phone to the train's GPS position (when both are available).
  const distanceToTrainMi =
    lat != null && lng != null && vehiclePosition != null
      ? Math.sqrt(
          Math.pow((lat - vehiclePosition.position.latitude) * 111, 2) +
          Math.pow((lng - vehiclePosition.position.longitude) * 111 * Math.cos(lat * Math.PI / 180), 2)
        ) * 0.621371
      : null;

  // Prevent body scroll when sheet is open on mobile.
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, isMobile]);

  // ── Swipe-to-dismiss ──────────────────────────────────────────────────────
  const touchStartY = useRef<number | null>(null);
  const currentTranslateY = useRef(0);
  const activeScrollAreaRef = useRef<HTMLElement | null>(null);
  const dragEnabledRef = useRef(false);
  const DISMISS_TRANSITION = `transform ${SHEET_TRANSITION_MS}ms ${SHEET_EASING}`;

  const disableScrollArea = (scrollArea: HTMLElement | null) => {
    if (!scrollArea) return;
    scrollArea.style.overflowY = "hidden";
    scrollArea.style.touchAction = "none";
  };

  const restoreScrollArea = (scrollArea: HTMLElement | null) => {
    if (!scrollArea) return;
    scrollArea.style.overflowY = "";
    scrollArea.style.touchAction = "";
  };

  const findScrollArea = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest("[data-sheet-scroll-area='true']");
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;
    restoreScrollArea(activeScrollAreaRef.current);
    activeScrollAreaRef.current = findScrollArea(e.target);
    dragEnabledRef.current = activeScrollAreaRef.current == null;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = "translateY(0)";
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || !sheetRef.current) return;
    const currentY = e.touches[0].clientY;
    let delta = currentY - touchStartY.current;
    const scrollArea = activeScrollAreaRef.current;

    if (scrollArea) {
      const atTop = scrollArea.scrollTop <= 0;
      const maxScrollTop = scrollArea.scrollHeight - scrollArea.clientHeight;
      const atBottom = scrollArea.scrollTop >= maxScrollTop - 1;

      if (!dragEnabledRef.current) {
        if ((delta > 0 && atTop) || (delta < 0 && atBottom)) {
          dragEnabledRef.current = true;
          disableScrollArea(scrollArea);
          // Start the sheet drag from the handoff point instead of replaying
          // the full finger travel from when the inner scroller was moving.
          touchStartY.current = currentY;
          delta = 0;
        } else {
          return;
        }
      }
    }

    if (!dragEnabledRef.current) return;
    e.preventDefault();

    if (delta < 0) {
      currentTranslateY.current = delta * 0.18;
      sheetRef.current.style.transform = `translateY(${currentTranslateY.current}px)`;
      return;
    }

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
    restoreScrollArea(activeScrollAreaRef.current);
    touchStartY.current = null;
    currentTranslateY.current = 0;
    activeScrollAreaRef.current = null;
    dragEnabledRef.current = false;
  };

  // ── Shared content props ──────────────────────────────────────────────────
  const contentProps = {
    ...rest,
    onClose,
    headerBg,
    minutesAfterArrival,
    hasStarted,
    nextStop,
    distanceToNextStopMi,
    lat,
    lng,
    locationLoading,
    requestLocation,
    hasReliableGps,
    isOnTrain: inferredOnTrain,
    vehiclePosition,
    activeProgressSource,
    distanceToTrainMi,
    progressHint,
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
