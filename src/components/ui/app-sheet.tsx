/**
 * AppSheet — shared chrome for content sheets across the app.
 *
 * Renders one of two presentations depending on viewport:
 *
 *   - **Mobile** (`useIsMobile()`): bottom sheet with backdrop + swipe-to-
 *     dismiss. Body scroll is locked while open. The drag handle is
 *     rendered by this component; pass `handleSlot` to customize its band
 *     (e.g. a colored header for trip sheets).
 *   - **Desktop**: Radix Dialog (centered modal).
 *
 * Both forms render the same `children` block, so consuming sheets only
 * need to worry about their own content and a11y label.
 */

import {
  useEffect,
  useRef,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { SHEET_EASING, SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export interface AppSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Used as the dialog's accessible label on both presentations. */
  ariaLabel: string;
  /** Custom drag-handle band on mobile. Defaults to a neutral handle on a
   *  card background; pass JSX to override (e.g. a colored header). */
  handleSlot?: ReactNode;
  /** Tailwind class applied to the desktop dialog container. */
  desktopMaxWidthClassName?: string;
  children: ReactNode;
}

const DEFAULT_DESKTOP_MAX_W = "max-w-lg w-[calc(100vw-2rem)]";

/** Default neutral drag handle. Matches the look StationInfoSheet had. */
function DefaultHandle() {
  return (
    <div className="flex justify-center pt-3 pb-1 shrink-0">
      <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
    </div>
  );
}

export function AppSheet({
  isOpen,
  onClose,
  ariaLabel,
  handleSlot,
  desktopMaxWidthClassName = DEFAULT_DESKTOP_MAX_W,
  children,
}: AppSheetProps) {
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Body scroll lock — mobile only; desktop Dialog handles its own.
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, isMobile]);

  // ── Swipe-to-dismiss (mobile bottom sheet) ────────────────────────────
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

  const handleTouchStart = (e: ReactTouchEvent) => {
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

  const handleTouchMove = (e: ReactTouchEvent) => {
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
          // Restart the sheet drag from this handoff point so we don't
          // replay the inner scroller's finger travel.
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

  // ── Desktop dialog ────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent
          className={cn(
            desktopMaxWidthClassName,
            "p-0 overflow-hidden max-h-[85vh] flex flex-col",
            // Hide Radix's default top-right close button — sheet content
            // provides its own (placed in the colored header band, etc.).
            "[&>button.absolute]:hidden",
          )}
        >
          <DialogTitle className="sr-only">{ariaLabel}</DialogTitle>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Mobile bottom sheet ───────────────────────────────────────────────
  return createPortal(
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-background/40 dark:bg-background/50 transition-opacity",
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        style={{ transitionDuration: `${SHEET_TRANSITION_MS}ms` }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={ariaLabel}
        aria-modal="true"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50",
          "bg-card rounded-t-2xl overflow-hidden",
          "[box-shadow:0_0_8px_rgba(0,0,0,0.35)]",
          "max-h-[92dvh] flex flex-col",
          "transition-transform",
          isOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          transitionDuration: `${SHEET_TRANSITION_MS}ms`,
          transitionTimingFunction: SHEET_EASING,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {handleSlot ?? <DefaultHandle />}
        {children}
      </div>
    </>,
    document.body,
  );
}
