import type { ReactNode } from "react";
import { MapHeader } from "./MapHeader";

interface MapDiagramFrameProps {
  /** Live train count for the header badge. Omit/null for the loading shell so
   *  no stale "0 trains" flashes before the real data arrives. */
  trainsCount?: number | null;
  /** Background-tap handler for the scroll container (clears train selection).
   *  Absent on the shell, which has nothing to deselect. */
  onBackground?: () => void;
  children?: ReactNode;
}

/**
 * The static frame of the line-diagram page — the green header + the scroll
 * container. Deliberately lives in the MAIN bundle (no heavy diagram/hook
 * imports) so it can render INSTANTLY as the lazy /map-diagram route's Suspense
 * fallback: the green top bar and blank page appear the moment you navigate,
 * while the code chunk loads. {@link MapDiagram} reuses the exact same frame,
 * so it stays pixel-stable across the fallback → mounted swap — only the
 * diagram fades into the container, making the load read as intentional.
 */
export function MapDiagramFrame({
  trainsCount = null,
  onBackground,
  children,
}: MapDiagramFrameProps) {
  return (
    <div className="relative w-full h-screen overflow-hidden bg-background flex flex-col">
      <MapHeader view="line" trainsCount={trainsCount} />

      {/* Background tap clears the train selection; inner station/train clicks
          stopPropagation so they don't also clear it. pb-safe reserves the iOS
          home-indicator space so the diagram's bottom (ferry label) clears it. */}
      <div
        className="flex-1 min-h-0 overflow-auto pb-safe"
        onClick={onBackground}
      >
        {children}
      </div>
    </div>
  );
}
