import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { TimePair } from "./TimePair";

/**
 * A trip's live-aware departure → arrival, sized for a coloured trip header
 * band, with the scheduled times struck through beneath — only the column(s)
 * that actually have a live value, so an arrival-only delay doesn't show an
 * unchanged departure struck through beside it.
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
  const hasLiveDeparture = realtimeStatus?.liveDepartureTime != null;
  const hasLiveArrival = realtimeStatus?.liveArrivalTime != null;
  return (
    <>
      <TimePair
        departure={realtimeStatus?.liveDepartureTime ?? trip.departureTime}
        arrival={realtimeStatus?.liveArrivalTime ?? trip.arrivalTime}
        format={format}
        strikethrough={canceled}
        className="text-2xl font-semibold text-white"
      />
      {(hasLiveDeparture || hasLiveArrival) && (
        <TimePair
          departure={trip.departureTime}
          arrival={trip.arrivalTime}
          format={format}
          className="text-xs mt-0.5 text-white/50"
          strikethrough
          showDeparture={hasLiveDeparture}
          showArrival={hasLiveArrival}
        />
      )}
    </>
  );
}
