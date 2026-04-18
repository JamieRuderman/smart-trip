import type * as React from "react";
import { cn } from "@/lib/utils";

type TripIconProps = Omit<React.SVGProps<SVGSVGElement>, "strokeWidth"> & {
  strokeWidth?: number;
};

const VIEWBOX_SIZE = 512;
const LUCIDE_VIEWBOX = 24;

/** SVG path data for the SMART train icon (front view). Shared with raw-DOM
 *  consumers that can't render React (e.g. Mapbox marker elements). */
export const TRIP_ICON_PATH =
  "M185.985 327.015H162.647M326.015 327.015H349.353M162.647 420.368L115.97 490.383M349.353 420.368L396.03 490.383M69.2939 239.496V303.677C69.2939 369.024 120.638 420.368 185.985 420.368H326.015C391.362 420.368 442.706 369.024 442.706 303.677V239.496M69.2939 239.496V210.324C69.2939 160.806 88.9647 113.317 123.979 78.3024C135.618 66.6635 148.635 56.72 162.647 48.6308M69.2939 239.496H162.647M442.706 239.496V210.324C442.706 160.806 423.035 113.317 388.021 78.3024C376.382 66.6635 363.365 56.72 349.353 48.6308M442.706 239.496H349.353M162.647 239.496V48.6308M162.647 239.496H349.353M162.647 48.6308C190.789 32.3844 222.942 23.6174 256 23.6174C289.058 23.6174 321.212 32.3844 349.353 48.6308M349.353 239.496V48.6308";

export function TripIcon({
  className,
  strokeWidth = 2,
  ...props
}: TripIconProps) {
  const normalizedStrokeWidth = strokeWidth * (VIEWBOX_SIZE / LUCIDE_VIEWBOX);

  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      className={cn("inline-block", className)}
      {...props}
    >
      <path
        d={TRIP_ICON_PATH}
        strokeWidth={normalizedStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
