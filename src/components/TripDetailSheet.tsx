import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTripProgress } from "@/hooks/useTripProgress";
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
 *  - Lifting useTripProgress so the mobile drag handle and TripDetailContent
 *    share exactly the same headerBg colour and stop inference results.
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
    progress,
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

  // ── Mobile bottom sheet ─────────────────────────────────────────────────
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
        <div className={cn("flex justify-center pt-3 pb-1 shrink-0", progress.headerBg)}>
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>

        <TripDetailContent {...contentProps} showCloseButton={false} />
      </div>
    </>,
    document.body
  );
}
