import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

// Configuration - adjust these to match actual rendered heights
export const HEADER_HEIGHTS = {
  title: 40, // Height of "Plan Your Trip" title
  logo: {
    small: 88,
    large: 130,
  },
  tabs: 56, // Height of Weekday/Weekend tabs
  fixed: 150, // Height of fixed elements
};
export const HEADER_MAX_HEIGHTS = {
  small:
    HEADER_HEIGHTS.title +
    HEADER_HEIGHTS.logo.small +
    HEADER_HEIGHTS.tabs +
    HEADER_HEIGHTS.fixed,
  large:
    HEADER_HEIGHTS.title +
    HEADER_HEIGHTS.logo.large +
    HEADER_HEIGHTS.tabs +
    HEADER_HEIGHTS.fixed,
};

const SCROLL_START = 0; // Start shrinking immediately

export type HeaderHeights = {
  title: number;
  logo: number;
  tabs: number;
  total: number;
};

const setHeaderHeights = (
  container: HTMLElement,
  heights: HeaderHeights,
  scrolledPixels: number
) => {
  // Sequential shrinking: Title → Logo → Tabs
  const titleHeight = Math.max(0, Math.round(heights.title - scrolledPixels));
  const logoHeight = Math.max(
    0,
    Math.round(heights.logo - Math.max(0, scrolledPixels - heights.title))
  );
  const tabsHeight = Math.max(
    0,
    Math.round(
      heights.tabs - Math.max(0, scrolledPixels - heights.title - heights.logo)
    )
  );

  container.style.setProperty("--header-title-height", `${titleHeight}px`);
  container.style.setProperty("--header-logo-height", `${logoHeight}px`);
  container.style.setProperty("--header-tabs-height", `${tabsHeight}px`);
};

export function useResponsiveHeaderHeights(): HeaderHeights {
  const [isLargeLogo, setIsLargeLogo] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const updateMatch = () => setIsLargeLogo(mediaQuery.matches);

    updateMatch();
    mediaQuery.addEventListener("change", updateMatch);

    return () => {
      mediaQuery.removeEventListener("change", updateMatch);
    };
  }, []);

  return useMemo(() => {
    const logo = isLargeLogo
      ? HEADER_HEIGHTS.logo.large
      : HEADER_HEIGHTS.logo.small;
    const total = HEADER_HEIGHTS.title + logo + HEADER_HEIGHTS.tabs;

    return {
      title: HEADER_HEIGHTS.title,
      logo,
      tabs: HEADER_HEIGHTS.tabs,
      total,
    };
  }, [isLargeLogo]);
}

export function useStickyHeaderCollapse(
  containerRef: RefObject<HTMLElement>,
  heights: HeaderHeights
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
      } else if (currentScrollY >= SCROLL_START + heights.total) {
        // After scroll end - fully collapsed
        progress = 1;
      } else {
        // In between - interpolate
        progress = (currentScrollY - SCROLL_START) / heights.total;
      }
      const scrolledPixels = progress * heights.total;
      setHeaderHeights(container, heights, scrolledPixels);
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
  }, [containerRef, heights]);
}
