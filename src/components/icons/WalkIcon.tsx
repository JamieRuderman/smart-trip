import type * as React from "react";
import { cn } from "@/lib/utils";

type WalkIconProps = Omit<React.SVGProps<SVGSVGElement>, "strokeWidth"> & {
  strokeWidth?: number;
};

/**
 * A walking-person glyph for the "time to leave" countdown stage — distinct
 * from the reminder bell so the leave countdown never doubles up on the bell
 * icon. Geometry is Tabler Icons' `walk` (MIT): a small head circle over
 * striding legs + arms. lucide-react ships no walking figure, so this is a
 * custom icon in the same stroked, 24×24 lucide style as the rest of the set.
 *
 * The SwiftUI widget redraws the SAME geometry in `WalkIconShape`
 * (ios/App/SmartTripWidget/TripActivityWidget.swift) — keep the two in lockstep
 * if this artwork ever changes.
 */
export function WalkIcon({
  className,
  strokeWidth = 2,
  ...props
}: WalkIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("inline-block", className)}
      {...props}
    >
      <circle cx="13" cy="4" r="1" />
      <path d="M7 21l3 -4" />
      <path d="M16 21l-2 -4l-3 -3l1 -6" />
      <path d="M6 12l2 -3l4 -1l3 3l3 1" />
    </svg>
  );
}
