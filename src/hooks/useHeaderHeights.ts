import { useState, useEffect, useRef } from "react";

// Configuration - adjust these to match actual rendered heights
export const HEADER_HEIGHTS = {
  title: 40, // Height of "Plan Your Journey" title
  logo: 88, // Height of SMART logo
  tabs: 56, // Height of Weekday/Weekend tabs
};

const SCROLL_START = 0; // Start shrinking immediately
const TOTAL_DISTANCE =
  HEADER_HEIGHTS.title + HEADER_HEIGHTS.logo + HEADER_HEIGHTS.tabs;

export function useStickyHeaderCollapse() {
  const [scrollProgress, setScrollProgress] = useState(0); // 0 = fully expanded, 1 = fully collapsed
  const ticking = useRef(false);

  useEffect(() => {
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

      setScrollProgress((prev) => {
        // Avoid extra renders when progress hasn't meaningfully changed
        if (Math.abs(prev - progress) < 0.001) return prev;
        return progress;
      });
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
  }, []);

  // Calculate scrolled pixels from progress
  const scrolledPixels = scrollProgress * TOTAL_DISTANCE;

  // Sequential shrinking: Title → Logo → Tabs

  // 1. Title shrinks first (0 → TITLE_HEIGHT)
  const titleHeight = Math.max(0, HEADER_HEIGHTS.title - scrolledPixels);

  // 2. Logo shrinks second (TITLE_HEIGHT → TITLE_HEIGHT + LOGO_HEIGHT)
  const logoHeight = Math.max(
    0,
    HEADER_HEIGHTS.logo - Math.max(0, scrolledPixels - HEADER_HEIGHTS.title)
  );

  // 3. Tabs shrink last (TITLE_HEIGHT + LOGO_HEIGHT → TOTAL_DISTANCE)
  const tabsHeight = Math.max(
    0,
    HEADER_HEIGHTS.tabs -
      Math.max(0, scrolledPixels - HEADER_HEIGHTS.title - HEADER_HEIGHTS.logo)
  );

  return {
    titleHeight,
    logoHeight,
    tabsHeight,
  };
}
