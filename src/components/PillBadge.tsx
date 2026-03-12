import { cn } from "@/lib/utils";
import type { TripState } from "@/lib/tripTheme";

export function PillBadge({
  label,
  color = "ontime",
  className,
}: {
  label: string;
  color?: TripState | "neutral";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs px-2 py-0.5 rounded-md font-medium whitespace-nowrap border",
        color === "ontime"     && "bg-primary text-primary-foreground border-transparent",
        color === "delayed"    && "bg-smart-gold text-white border-transparent",
        color === "canceled"   && "bg-destructive text-white border-transparent",
        color === "neutral"    && "bg-foreground text-background border-transparent",
        (color === "past" || color === "future") && "bg-muted text-muted-foreground border-transparent",
        className,
      )}
    >
      {label}
    </span>
  );
}
