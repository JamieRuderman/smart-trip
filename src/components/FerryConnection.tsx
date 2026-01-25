import type { FerryConnection as FerryConnectionType } from "@/types/smartSchedule";
import { TimeDisplay } from "./TimeDisplay";
import { APP_CONSTANTS, FARE_CONSTANTS } from "@/lib/fareConstants";
import { Ship, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface FerryConnectionProps {
  ferry: FerryConnectionType;
  trainArrivalTime?: string; // for outbound (train -> ferry)
  trainDepartureTime?: string; // for inbound (ferry -> train)
  isMobile?: boolean;
  timeFormat?: "12h" | "24h";
  inbound?: boolean; // when true, show ferry arrival then train departure
}

export function FerryConnection({
  ferry,
  trainArrivalTime,
  trainDepartureTime,
  isMobile = false,
  timeFormat = APP_CONSTANTS.DEFAULT_TIME_FORMAT,
  inbound = false,
}: FerryConnectionProps) {
  const { t } = useTranslation();

  // Calculate transfer time in minutes
  const calculateDelta = (a: string, b: string): number => {
    const clean = (t: string) => t.replace(/[*~]/g, "");
    const parseTime = (timeStr: string): number => {
      const [hours, minutes] = timeStr.split(":").map(Number);
      return hours * 60 + minutes;
    };
    const delta = parseTime(clean(b)) - parseTime(clean(a));
    return delta;
  };

  let transferTime = 0;

  if (inbound) {
    if (trainDepartureTime) {
      transferTime = calculateDelta(ferry.arrive, trainDepartureTime);
    }
  } else {
    if (trainArrivalTime) {
      transferTime = calculateDelta(trainArrivalTime, ferry.depart);
    }
  }

  const isShortConnection =
    transferTime < FARE_CONSTANTS.QUICK_CONNECTION_THRESHOLD;

  const displayLabel = inbound ? t("ferry.arrives") : t("ferry.departs");
  const displayTime = inbound ? ferry.arrive : ferry.depart;

  return (
    <div
      className={cn(
        "flex-grow flex items-center justify-end gap-3 text-muted-foreground",
        isMobile && "flex-row-reverse items-start pt-2"
      )}
    >
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1 text-sm flex-end">
          <span className="text-muted-foreground text-sm">{displayLabel}</span>
          <TimeDisplay time={displayTime} format={timeFormat} />
        </div>
        <div
          className={cn(
            "flex items-center gap-2 text-xs leading-none",
            isShortConnection && "text-smart-gold font-medium"
          )}
        >
          {isShortConnection ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <Clock className="h-3 w-3" />
          )}
          {transferTime} {t("ferry.minTransfer")}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-col justify-center items-center gap-1",
          isMobile ? "border-r pr-4 mr-1" : "border-l pl-4 ml-1"
        )}
      >
        <Ship className="h-5 w-5" />
        <span className="text-[10px] uppercase">
          {inbound ? t("ferry.inbound") : t("ferry.outbound")}
        </span>
      </div>
    </div>
  );
}
