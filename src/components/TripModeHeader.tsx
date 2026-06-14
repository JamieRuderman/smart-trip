import { useEffect, useRef } from "react";
import smartLogo from "@/assets/smart-logo.svg";
import { FocusedTripCard } from "./FocusedTripCard";

interface TripModeHeaderProps {
  currentTime: Date;
  timeFormat: "12h" | "24h";
  /** Reports the fixed header's EXPANDED height (incl. safe-area inset) so the
   *  page can reserve matching top padding. The on-scroll collapse shrinks the
   *  element within that reserved space, so content scrolls up beneath it. */
  onHeightChange: (height: number) => void;
}

/**
 * Fixed "trip mode" header shown in place of the planner once a trip is focused:
 * a SMART logo strip over the pinned {@link FocusedTripCard} (which carries its
 * own Cancel → returns to the planner).
 *
 * Scroll-collapse mirrors the planner header: each `[data-collapse]` section
 * (logo, then the card's eyebrow/route/add-reminder, in `data-order`) shrinks
 * 1px per scrolled px, sequentially, so the chrome "rolls up" with the scroll
 * and only ever one section is mid-clip. Heights are driven by CSS vars set on
 * the container, so the card re-rendering (live countdown) can't clobber them.
 */
export function TripModeHeader({
  currentTime,
  timeFormat,
  onHeightChange,
}: TripModeHeaderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const naturalHeights = useRef<number[]>([]);
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const sections = () =>
      [...container.querySelectorAll<HTMLElement>("[data-collapse]")].sort(
        (a, b) => Number(a.dataset.order) - Number(b.dataset.order),
      );

    // Distribute the scrolled distance across sections in order: each absorbs up
    // to its full height before the next starts, so they collapse sequentially.
    const apply = () => {
      const els = sections();
      const heights = naturalHeights.current;
      const total = heights.reduce((sum, h) => sum + h, 0);
      let scrolled = Math.max(0, Math.min(window.scrollY, total));
      els.forEach((el, i) => {
        const h = heights[i] ?? el.offsetHeight;
        const shrink = Math.max(0, Math.min(scrolled, h));
        container.style.setProperty(
          `--trip-col-${el.dataset.order}`,
          `${h - shrink}px`,
        );
        scrolled -= shrink;
      });
    };

    // Re-measure natural section heights (and the expanded header height for the
    // page padding) with the collapse vars cleared, then re-apply for the
    // current scroll. Clearing + re-applying in one tick paints no intermediate.
    const measure = () => {
      const els = sections();
      els.forEach((el) =>
        container.style.removeProperty(`--trip-col-${el.dataset.order}`),
      );
      naturalHeights.current = els.map((el) => el.offsetHeight);
      onHeightChange(container.offsetHeight);
      apply();
    };
    measureRef.current = measure;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        apply();
        ticking = false;
      });
    };

    measure();
    // Re-measure after first paint — the logo SVG often hasn't laid out yet on
    // the synchronous pass, which would cache a too-small natural height.
    requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [onHeightChange]);

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 top-0 z-30"
      style={{ overflowAnchor: "none" }}
    >
      {/* Logo strip — collapses first (data-order 1), gone when fully scrolled.
          pt-safe stays on the header so the safe-area inset survives. */}
      <header
        className="bg-smart-train-green container max-w-screen-xl mx-auto px-4 pt-safe flex flex-col items-center"
        role="banner"
      >
        <div
          data-collapse
          data-order="1"
          className="overflow-hidden"
          style={{ height: "var(--trip-col-1, auto)" }}
        >
          <img
            src={smartLogo}
            alt="Sonoma-Marin Area Rail Transit Logo"
            className="h-auto w-40 sm:w-48 max-w-full my-2"
            onLoad={() => measureRef.current()}
          />
        </div>
      </header>

      {/* Pinned trip card on the layered green band (mirrors the planner card). */}
      <div className="container mx-auto px-4 max-w-screen-xl relative pb-2">
        <div
          className="absolute inset-x-0 top-0 h-[50%] bg-smart-train-green xl:rounded-b-[2rem] pointer-events-none"
          aria-hidden="true"
        />
        <div className="max-w-4xl mx-auto relative z-1">
          <FocusedTripCard currentTime={currentTime} timeFormat={timeFormat} />
        </div>
      </div>
    </div>
  );
}
