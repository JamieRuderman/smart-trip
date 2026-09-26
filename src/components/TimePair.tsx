import { cn } from "@/lib/utils";
import { TimeDisplay } from "./TimeDisplay";

/** Departure → Arrival time pair, optionally struck through. `showDeparture`/
 *  `showArrival` let a caller render only the column that actually has a
 *  changed (e.g. live-delayed) value to compare against — showing both when
 *  only one shifted would imply the other changed too. */
export function TimePair({
  departure,
  arrival,
  format,
  strikethrough = false,
  showDeparture = true,
  showArrival = true,
  className,
}: {
  departure: string;
  arrival: string;
  format: "12h" | "24h";
  strikethrough?: boolean;
  showDeparture?: boolean;
  showArrival?: boolean;
  className?: string;
}) {
  const lineThrough = strikethrough ? "line-through" : "";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showDeparture && (
        <TimeDisplay time={departure} format={format} className={lineThrough} />
      )}
      {showDeparture && showArrival && (
        <span className="font-normal opacity-60">→</span>
      )}
      {showArrival && (
        <TimeDisplay time={arrival} format={format} className={lineThrough} />
      )}
    </div>
  );
}
