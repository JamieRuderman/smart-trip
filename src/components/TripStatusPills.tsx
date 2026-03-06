import { useTranslation } from "react-i18next";
import { PillBadge } from "./PillBadge";

interface TripStatusPillsProps {
  isCanceled: boolean;
  isOriginSkipped: boolean;
  isDelayed: boolean;
  showOnTimeBadge: boolean;
  delayDisplay: string;
}

export function TripStatusPills({
  isCanceled,
  isOriginSkipped,
  isDelayed,
  showOnTimeBadge,
  delayDisplay,
}: TripStatusPillsProps) {
  const { t } = useTranslation();

  return (
    <>
      {isCanceled && (
        <PillBadge
          label={t("tripCard.canceled")}
          color="gold"
          className="bg-destructive"
        />
      )}
      {isOriginSkipped && !isCanceled && (
        <PillBadge
          label={t("tripCard.stopSkipped")}
          color="gold"
          className="bg-destructive"
        />
      )}
      {isDelayed && !isCanceled && !isOriginSkipped && (
        <PillBadge
          label={t("tripCard.delayed", { minutes: delayDisplay })}
          color="gold"
        />
      )}
      {showOnTimeBadge && (
        <PillBadge
          label={t("tripCard.onTime")}
          color="green"
        />
      )}
    </>
  );
}
