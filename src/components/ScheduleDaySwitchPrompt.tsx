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
import { getTodayScheduleType } from "@/lib/scheduleUtils";

/** Offers today's schedule when the day's type changes while the app stays open;
 *  only a fresh load picks it automatically. */
export function ScheduleDaySwitchPrompt({ currentTime }: { currentTime: Date }) {
  const { t } = useTranslation();
  const { scheduleType, scheduleDay, setScheduleType, acknowledgeScheduleDay } =
    useStationSelection();
  const today = getTodayScheduleType(currentTime);
  if (today === scheduleDay || scheduleType === today) return null;

  const weekend = today === "weekend";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) acknowledgeScheduleDay(today);
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
          <Button variant="outline" onClick={() => acknowledgeScheduleDay(today)}>
            {t("scheduleDaySwitch.keep")}
          </Button>
          <Button
            onClick={() => {
              setScheduleType(today);
              acknowledgeScheduleDay(today);
            }}
          >
            {t("scheduleDaySwitch.switch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
