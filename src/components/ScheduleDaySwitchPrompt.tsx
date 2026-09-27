import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStationSelection } from "@/contexts/stationSelection";
import { scheduleSwitchOffer } from "@/lib/scheduleUtils";
import { toLocalDateKey } from "@/lib/timeUtils";

/** Offers today's schedule on a new day while the app stays open; only a fresh
 *  load picks it automatically. */
export function ScheduleDaySwitchPrompt({ currentTime }: { currentTime: Date }) {
  const { t } = useTranslation();
  const { scheduleType, scheduleCheckedOn, setScheduleType, confirmScheduleCheckedOn } =
    useStationSelection();
  const today = scheduleSwitchOffer(scheduleType, scheduleCheckedOn, currentTime);
  if (today == null) return null;

  const dismiss = () => confirmScheduleCheckedOn(toLocalDateKey(currentTime));
  const weekend = today === "weekend";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>
            {t(weekend ? "scheduleDaySwitch.titleWeekend" : "scheduleDaySwitch.titleWeekday")}
          </DialogTitle>
          <DialogDescription>
            {t(weekend ? "scheduleDaySwitch.bodyWeekend" : "scheduleDaySwitch.bodyWeekday")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={dismiss}>
            {t("scheduleDaySwitch.keep")}
          </Button>
          <Button onClick={() => setScheduleType(today)}>
            {t("scheduleDaySwitch.switch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
