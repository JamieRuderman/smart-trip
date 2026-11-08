import { tripEnds, type ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { TimePair } from "./TimePair";

/**
 * A trip's live-aware departure → arrival, sized for a coloured trip header
 * band, with the scheduled times struck through beneath — only the column(s)
 * that actually have a live value, so an arrival-only delay doesn't show an
 * unchanged departure struck through beside it. A trip starting or ending with
 * the SF ferry shows the ferry's time at that end; the ferry has no live feed.
 */
export function LiveTimePair({
  trip,
  realtimeStatus,
  canceled,
  format,
}: {
  trip: ProcessedTrip;
  realtimeStatus?: TripRealtimeStatus | null;
  /** Strike the live times through (cancelled or skipped). */
  canceled: boolean;
  format: "12h" | "24h";
}) {
  const live = tripEnds(trip, realtimeStatus);
  const scheduled = tripEnds(trip);
  return (
    <>
      <TimePair
        departure={live.start}
        arrival={live.end}
        format={format}
        strikethrough={canceled}
        className="text-2xl font-semibold text-white"
      />
      {(live.liveStart || live.liveEnd) && (
        <TimePair
          departure={scheduled.start}
          arrival={scheduled.end}
          format={format}
          className="text-xs mt-0.5 text-white/50"
          strikethrough
          showDeparture={live.liveStart}
          showArrival={live.liveEnd}
        />
      )}
    </>
  );
}
