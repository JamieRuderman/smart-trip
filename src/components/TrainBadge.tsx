import { cn } from "@/lib/utils";
import { TripIcon } from "@/components/icons/TripIcon";
import { cardTripState, stateText } from "@/lib/tripTheme";

interface TrainBadgeProps {
  tripNumber: number;
  isNextTrip?: boolean;
  isPastTrip?: boolean;
  isCanceled?: boolean;
  isSkipped?: boolean;
  isDelayed?: boolean;
  onColoredBg?: boolean;
}

export function TrainBadge({
  tripNumber,
  isNextTrip = false,
  isPastTrip = false,
  isCanceled = false,
  isSkipped = false,
  isDelayed = false,
  onColoredBg = false,
}: TrainBadgeProps) {
  // Match the trip card's state priority (delayed before past) so a
  // departed-but-delayed trip still reads gold rather than muted gray.
  const state = cardTripState({
    isCanceledOrSkipped: isCanceled || isSkipped,
    isDelayed,
    isNextTrip,
    isPastTrip,
  });
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 w-[5rem]",
        onColoredBg ? "text-white" : stateText[state],
      )}
    >
      <TripIcon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <span className="text-2xl font-semibold min-w-[1.5rem]">
        {tripNumber}
      </span>
    </div>
  );
}
