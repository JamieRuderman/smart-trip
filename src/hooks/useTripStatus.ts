import { useTranslation } from "react-i18next";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

/**
 * Derives all status flags and the header colour from realtime data.
 * Single source of truth shared by SheetContent and TripDetailSheet.
 */
export function useTripStatus(
  realtimeStatus: TripRealtimeStatus | null | undefined,
  isNextTrip: boolean
) {
  const { t } = useTranslation();

  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isOriginSkipped = realtimeStatus?.isOriginSkipped ?? false;
  const isCanceledOrSkipped = isCanceled || isOriginSkipped;
  const isDelayed = !isCanceledOrSkipped && realtimeStatus?.delayMinutes != null;
  const delayDisplay =
    realtimeStatus?.delayMinutes === 0
      ? "<1"
      : String(realtimeStatus?.delayMinutes ?? "");
  const showOnTimeBadge = isNextTrip && !isCanceledOrSkipped && !isDelayed;

  const headerBg = isCanceledOrSkipped
    ? "bg-destructive"
    : isDelayed
    ? "bg-smart-gold"
    : isNextTrip
    ? "bg-smart-train-green"
    : "bg-smart-neutral";

  const statusLabel = isCanceled
    ? t("tripCard.canceled")
    : isOriginSkipped
    ? t("tripCard.stopSkipped")
    : isDelayed
    ? t("tripCard.delayed", { minutes: delayDisplay })
    : showOnTimeBadge
    ? t("tripCard.onTime")
    : null;

  return {
    isCanceled,
    isOriginSkipped,
    isCanceledOrSkipped,
    isDelayed,
    headerBg,
    statusLabel,
  };
}
