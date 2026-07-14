import { useTranslation } from "react-i18next";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { TripState } from "@/lib/tripTheme";

/**
 * Derives all status flags and the display label from realtime data.
 * Single source of truth used by both TripCard (pill) and TripDetailContent (header badge).
 *
 * "On time" is shown for the full duration of the trip whenever realtime data
 * confirms no delay — not just while it is the immediate next departure.
 */
export function useTripStatus(
  realtimeStatus: TripRealtimeStatus | null | undefined,
) {
  const { t } = useTranslation();

  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isOriginSkipped = realtimeStatus?.isOriginSkipped ?? false;
  const isCanceledOrSkipped = isCanceled || isOriginSkipped;
  // A trip is delayed when it left its origin late (delayMinutes) OR fell
  // behind en route so its destination arrival is late (arrivalDelayMinutes)
  // — a train can depart on time and still arrive well behind schedule, and
  // it must not read "On time" while its live arrival slips.
  const displayDelayMinutes =
    realtimeStatus?.delayMinutes ?? realtimeStatus?.arrivalDelayMinutes;
  const isDelayed = !isCanceledOrSkipped && displayDelayMinutes != null;
  const isOnTime = realtimeStatus != null && !isCanceledOrSkipped && !isDelayed;

  const delayDisplay =
    displayDelayMinutes === 0 ? "<1" : String(displayDelayMinutes ?? "");

  const statusLabel: string | null = isCanceled
    ? t("tripCard.canceled")
    : isOriginSkipped
    ? t("tripCard.stopSkipped")
    : isDelayed
    ? t("tripCard.delayed", { minutes: delayDisplay })
    : isOnTime
    ? t("tripCard.onTime")
    : null;

  const statusColor: TripState | null =
    isCanceledOrSkipped ? "canceled"
    : isDelayed ? "delayed"
    : isOnTime ? "ontime"
    : null;

  return {
    isCanceled,
    isOriginSkipped,
    isCanceledOrSkipped,
    isDelayed,
    statusLabel,
    statusColor,
  };
}
