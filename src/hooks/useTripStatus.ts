import { useTranslation } from "react-i18next";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

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
  const isDelayed = !isCanceledOrSkipped && realtimeStatus?.delayMinutes != null;
  const isOnTime = realtimeStatus != null && !isCanceledOrSkipped && !isDelayed;

  const delayDisplay =
    realtimeStatus?.delayMinutes === 0
      ? "<1"
      : String(realtimeStatus?.delayMinutes ?? "");

  const statusLabel: string | null = isCanceled
    ? t("tripCard.canceled")
    : isOriginSkipped
    ? t("tripCard.stopSkipped")
    : isDelayed
    ? t("tripCard.delayed", { minutes: delayDisplay })
    : isOnTime
    ? t("tripCard.onTime")
    : null;

  const statusColor: "green" | "gold" | "destructive" | null =
    isCanceledOrSkipped ? "destructive"
    : isDelayed ? "gold"
    : isOnTime ? "green"
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
