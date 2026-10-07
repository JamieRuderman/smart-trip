import { ConfirmDialog } from "./ConfirmDialog";
import type { BoardingLocationWarning } from "@/lib/boardingLocation";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

interface BoardingLocationDialogProps {
  warning: BoardingLocationWarning;
  fromStation: Station;
  toStation: Station;
  /** Switch to the warning's suggested leg instead. */
  onFix: () => void;
  /** Take the train as planned. */
  onContinue: () => void;
  /** Dismissed — do nothing. */
  onCancel: () => void;
}

/**
 * Shown when "Take this train" is tapped but the rider's location says they
 * aren't leaving from the trip's departure station — most often a ride home
 * planned without swapping the morning's stations.
 */
export function BoardingLocationDialog({
  warning,
  fromStation,
  toStation,
  onFix,
  onContinue,
  onCancel,
}: BoardingLocationDialogProps) {
  const { t } = useTranslation();
  const { reversed } = warning;
  const station = warning.suggested.from;
  // A reversed trip suggested from the destination itself is a plain swap.
  const swap = reversed && station === toStation;
  const description = !reversed
    ? t("boardingCheck.otherStationBody", { from: fromStation, station })
    : swap
      ? t("boardingCheck.reversedBody", { from: fromStation, to: toStation })
      : t("boardingCheck.reversedAtStationBody", { from: fromStation, station });

  return (
    <ConfirmDialog
      title={
        reversed
          ? t("boardingCheck.reversedTitle")
          : t("boardingCheck.otherStationTitle", { from: fromStation })
      }
      description={description}
      secondaryLabel={t("boardingCheck.takeAnyway")}
      onSecondary={onContinue}
      primaryLabel={
        swap ? t("boardingCheck.swap") : t("boardingCheck.leaveFrom", { station })
      }
      onPrimary={onFix}
      onDismiss={onCancel}
    />
  );
}
