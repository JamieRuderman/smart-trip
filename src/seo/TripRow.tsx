// Visual row for a single trip on a station / route page. Mirrors the SPA's
// TripCard layout (train icon + large trip number + monospace times) but is
// presentation-only — no state, no interaction.
//
// Train SVG path mirrored from src/components/icons/TripIcon.tsx so we
// don't need to import the SPA's React component.

import React from "react";
void React; // tsx (classic JSX) needs React in scope; tsc would flag unused.

const TRIP_ICON_PATH =
  "M185.985 327.015H162.647M326.015 327.015H349.353M162.647 420.368L115.97 490.383M349.353 420.368L396.03 490.383M69.2939 239.496V303.677C69.2939 369.024 120.638 420.368 185.985 420.368H326.015C391.362 420.368 442.706 369.024 442.706 303.677V239.496M69.2939 239.496V210.324C69.2939 160.806 88.9647 113.317 123.979 78.3024C135.618 66.6635 148.635 56.72 162.647 48.6308M69.2939 239.496H162.647M442.706 239.496V210.324C442.706 160.806 423.035 113.317 388.021 78.3024C376.382 66.6635 363.365 56.72 349.353 48.6308M442.706 239.496H349.353M162.647 239.496V48.6308M162.647 239.496H349.353M162.647 48.6308C190.789 32.3844 222.942 23.6174 256 23.6174C289.058 23.6174 321.212 32.3844 349.353 48.6308M349.353 239.496V48.6308";

function TripIcon({ className }: { className?: string }) {
  // strokeWidth of 2 in a 24-viewbox icon scales to ~42.67 in our 512 viewbox.
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      className={["inline-block", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <path
        d={TRIP_ICON_PATH}
        strokeWidth={42.67}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Lucide ArrowUp / ArrowDown paths (v0.462). Inlined so the directional
// arrow stays visible next to every row even on mobile where columns
// stack and the "Northbound / Southbound" heading scrolls off-screen.
function DirectionArrow({
  direction,
  className,
}: {
  direction: "north" | "south";
  className?: string;
}) {
  const paths =
    direction === "north"
      ? ["M12 19V5", "m5 12 7-7 7 7"]
      : ["M12 5v14", "m19 12-7 7-7-7"];
  const label = direction === "north" ? "Northbound" : "Southbound";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["inline-block", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const cn = (...parts: Array<string | false | undefined | null>): string =>
  parts.filter(Boolean).join(" ");

interface TripRowProps {
  tripNumber: number;
  /** Primary time. Always shown. */
  time: string;
  /** Secondary time, shown after an arrow (for route-pair pages). */
  arriveTime?: string;
  /** Optional right-aligned content, e.g. trip duration. */
  trailing?: string;
  /** Apply muted styling — e.g. when no service in that direction. */
  muted?: boolean;
  /**
   * Optional direction indicator. Shows a small up/down arrow before the
   * trip number so the direction stays visible per-row even after the
   * column heading scrolls off-screen on mobile.
   */
  direction?: "north" | "south";
}

export function TripRow({
  tripNumber,
  time,
  arriveTime,
  trailing,
  muted = false,
  direction,
}: TripRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg border bg-card",
        muted && "opacity-50",
      )}
    >
      {direction ? (
        <DirectionArrow
          direction={direction}
          className="h-4 w-4 text-muted-foreground shrink-0"
        />
      ) : null}
      <div className="flex items-center gap-1.5 text-smart-train-green shrink-0">
        <TripIcon className="h-5 w-5" aria-hidden="true" />
        <span className="text-xl font-semibold tabular-nums">{tripNumber}</span>
      </div>
      {/* Times right-aligned via ml-auto so the column reads as a vertical
          stack of monospace times regardless of the row's left content. */}
      <div className="ml-auto flex items-center gap-2 font-mono text-sm tabular-nums">
        <span>{time}</span>
        {arriveTime ? (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              →
            </span>
            <span>{arriveTime}</span>
          </>
        ) : null}
      </div>
      {trailing ? (
        <span className="text-xs text-muted-foreground shrink-0">{trailing}</span>
      ) : null}
    </div>
  );
}
