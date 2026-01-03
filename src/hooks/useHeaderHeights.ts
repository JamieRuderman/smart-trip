import type { RefObject } from "react";
import { useEffect, useRef } from "react";

// Configuration - adjust these to match actual rendered heights
export const HEADER_HEIGHTS = {
  title: 40, // Height of "Plan Your Journey" title
  logo: 88, // Height of SMART logo
  tabs: 56, // Height of Weekday/Weekend tabs
};

const SCROLL_START = 0; // Start shrinking immediately
const TOTAL_DISTANCE =
  HEADER_HEIGHTS.title + HEADER_HEIGHTS.logo + HEADER_HEIGHTS.tabs;

const setHeaderHeights = (
  container: HTMLElement,
  scrolledPixels: number
) => {
  // Sequential shrinking: Title → Logo → Tabs
  const titleHeight = Math.max(
    0,
    Math.round(HEADER_HEIGHTS.title - scrolledPixels)
  );
  const logoHeight = Math.max(
    0,
    Math.round(
      HEADER_HEIGHTS.logo - Math.max(0, scrolledPixels - HEADER_HEIGHTS.title)
    )
  );
  const tabsHeight = Math.max(
    0,
    Math.round(
      HEADER_HEIGHTS.tabs -
        Math.max(0, scrolledPixels - HEADER_HEIGHTS.title - HEADER_HEIGHTS.logo)
    )
  );

  container.style.setProperty("--header-title-height", `${titleHeight}px`);
  container.style.setProperty("--header-logo-height", `${logoHeight}px`);
  container.style.setProperty("--header-tabs-height", `${tabsHeight}px`);
};

export function useStickyHeaderCollapse(
  containerRef: RefObject<HTMLElement>
) {
  const ticking = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScrollState = () => {
      const currentScrollY = window.scrollY;

      // Calculate progress based on scroll position
      let progress = 0;

      if (currentScrollY <= SCROLL_START) {
        // Before scroll start - fully expanded
        progress = 0;
      } else if (currentScrollY >= SCROLL_START + TOTAL_DISTANCE) {
        // After scroll end - fully collapsed
        progress = 1;
      } else {
        // In between - interpolate
        progress = (currentScrollY - SCROLL_START) / TOTAL_DISTANCE;
      }
      const scrolledPixels = progress * TOTAL_DISTANCE;
      setHeaderHeights(container, scrolledPixels);
    };

    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          updateScrollState();
          ticking.current = false;
        });

        ticking.current = true;
      }
    };

    // Set initial state
    updateScrollState();

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [containerRef]);
}
