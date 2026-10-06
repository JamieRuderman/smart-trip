import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const reversed = warning.kind === "nearDestination";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>
            {reversed
              ? t("boardingCheck.reversedTitle")
              : t("boardingCheck.otherStationTitle", { from: fromStation })}
          </DialogTitle>
          <DialogDescription>
            {reversed
              ? t("boardingCheck.reversedBody", {
                  from: fromStation,
                  to: toStation,
                })
              : t("boardingCheck.otherStationBody", {
                  from: fromStation,
                  station: warning.station,
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onContinue}>
            {t("boardingCheck.takeAnyway")}
          </Button>
          <Button
            onClick={onFix}
            className="bg-my-trip-background text-white hover:bg-my-trip-background/90"
          >
            {reversed
              ? t("boardingCheck.swap")
              : t("boardingCheck.leaveFrom", { station: warning.station })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
