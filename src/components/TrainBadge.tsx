import { cn } from "@/lib/utils";
import { TripIcon } from "@/components/icons/TripIcon";

interface TrainBadgeProps {
  tripNumber: number;
  isNextTrip?: boolean;
  isPastTrip?: boolean;
  showAllTrips?: boolean;
}

export function TrainBadge({
  tripNumber,
  isNextTrip = false,
  isPastTrip = false,
  showAllTrips = false,
}: TrainBadgeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 w-[5rem]",
        isNextTrip && "text-smart-train-green",
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
