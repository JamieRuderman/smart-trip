import { useState } from "react";
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
import type { ScheduleType } from "@/data/trainSchedules";
import { getTodayScheduleType, scheduleSwitchOffer } from "@/lib/scheduleUtils";

/**
 * Offers to switch schedules when today's type changes while the app is open.
 * A fresh load already starts on today's schedule, but a resumed app keeps
 * the one it opened with: Friday's weekday trains on Saturday morning.
 */
export function ScheduleDaySwitchPrompt({
  currentTime,
  scheduleType,
  onSwitch,
}: {
  currentTime: Date;
  scheduleType: ScheduleType;
  onSwitch: (type: ScheduleType) => void;
}) {
  const { t } = useTranslation();
  const today = getTodayScheduleType(currentTime);
  const [seenToday, setSeenToday] = useState(today);
  const [offer, setOffer] = useState<ScheduleType | null>(null);
  if (today !== seenToday) {
    setSeenToday(today);
    setOffer(scheduleSwitchOffer(seenToday, today, scheduleType));
  }
  if (offer == null || offer === scheduleType) return null;

  const weekend = offer === "weekend";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setOffer(null);
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
          <Button variant="outline" onClick={() => setOffer(null)}>
            {t("scheduleDaySwitch.keep")}
          </Button>
          <Button
            onClick={() => {
              setOffer(null);
              onSwitch(offer);
            }}
          >
            {t("scheduleDaySwitch.switch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
