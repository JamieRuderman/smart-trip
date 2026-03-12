import { cn } from "@/lib/utils";
import { TimeDisplay } from "./TimeDisplay";

/** Departure → Arrival time pair, optionally struck through. */
export function TimePair({
  departure,
  arrival,
  format,
  strikethrough = false,
  className,
}: {
  departure: string;
  arrival: string;
  format: "12h" | "24h";
  strikethrough?: boolean;
  className?: string;
}) {
  const lineThrough = strikethrough ? "line-through" : "";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <TimeDisplay time={departure} format={format} className={lineThrough} />
      <span className="font-normal opacity-60">→</span>
      <TimeDisplay time={arrival} format={format} className={lineThrough} />
    </div>
  );
}
