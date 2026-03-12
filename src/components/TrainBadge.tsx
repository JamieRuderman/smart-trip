import { cn } from "@/lib/utils";
import { TripIcon } from "@/components/icons/TripIcon";
import { stateText } from "@/lib/tripTheme";

interface TrainBadgeProps {
  tripNumber: number;
  isNextTrip?: boolean;
  isPastTrip?: boolean;
  showAllTrips?: boolean;
  isCanceled?: boolean;
  isSkipped?: boolean;
  isDelayed?: boolean;
  onColoredBg?: boolean;
}

export function TrainBadge({
  tripNumber,
  isNextTrip = false,
  isPastTrip = false,
  showAllTrips = false,
  isCanceled = false,
  isSkipped = false,
  isDelayed = false,
  onColoredBg = false,
}: TrainBadgeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 w-[5rem]",
        onColoredBg
          ? "text-white"
          : isCanceled || isSkipped
          ? stateText["canceled"]
          : isDelayed
          ? stateText["delayed"]
          : isNextTrip
          ? stateText["ontime"]
          : undefined,
        isPastTrip && showAllTrips && "text-muted-foreground/60"
      )}
    >
      <TripIcon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <span className="text-2xl font-semibold min-w-[1.5rem]">
        {tripNumber}
      </span>
    </div>
  );
}
