import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TripRowProps {
  /** State style from tripTheme: stateCardStyle[state] or myTripCardStyle. */
  tone: string;
  onClick?: () => void;
  ariaLabel?: string;
  children: ReactNode;
}

/** One train (or ferry) in a list: the home schedule's and a station's. */
export function TripRow({ tone, onClick, ariaLabel, children }: TripRowProps) {
  return (
    <div
      role="listitem"
      aria-label={ariaLabel}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick &&
        ((e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        })
      }
      className={cn(
        "relative flex items-center px-4 py-2 rounded-lg transition-all touch-manipulation outline-none",
        onClick && "cursor-pointer",
        tone,
      )}
    >
      {children}
    </div>
  );
}
