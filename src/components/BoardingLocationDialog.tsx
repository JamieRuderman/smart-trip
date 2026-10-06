import { ConfirmDialog } from "./ConfirmDialog";
import type { BoardingLocationWarning } from "@/lib/boardingLocation";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

interface BoardingLocationDialogProps {
  warning: BoardingLocationWarning;
  fromStation: Station;
  toStation: Station;
  /** Fix the trip instead: swap the stations (`nearDestination`) or leave
   *  from the station the rider is at (`atOtherStation`). */
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
  const copy =
    warning.kind === "nearDestination"
      ? {
          title: t("boardingCheck.reversedTitle"),
          description: t("boardingCheck.reversedBody", {
            from: fromStation,
            to: toStation,
          }),
          fix: t("boardingCheck.swap"),
        }
      : {
          title: t("boardingCheck.otherStationTitle", { from: fromStation }),
          description: t("boardingCheck.otherStationBody", {
            from: fromStation,
            station: warning.station,
          }),
          fix: t("boardingCheck.leaveFrom", { station: warning.station }),
        };

  return (
    <ConfirmDialog
      title={copy.title}
      description={copy.description}
      secondaryLabel={t("boardingCheck.takeAnyway")}
      onSecondary={onContinue}
      primaryLabel={copy.fix}
      onPrimary={onFix}
      onDismiss={onCancel}
    />
  );
}
