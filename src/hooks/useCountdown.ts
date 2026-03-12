import { useEffect, useState } from "react";
import { computeMinutesUntil } from "@/lib/timeUtils";

/**
 * Tracks minutes remaining until a departure, updating every 10 seconds.
 * Returns a negative number once the train has departed.
 */
export function useCountdown(
  departureTimeStr: string,
  liveDepTime: string | undefined,
  currentTime: Date
): number {
  const [minutesUntil, setMinutesUntil] = useState(() =>
    computeMinutesUntil(currentTime, departureTimeStr, liveDepTime)
  );

  useEffect(() => {
    setMinutesUntil(computeMinutesUntil(currentTime, departureTimeStr, liveDepTime));
    const id = setInterval(() => {
      setMinutesUntil(computeMinutesUntil(currentTime, departureTimeStr, liveDepTime));
    }, 10000);
    return () => clearInterval(id);
  }, [currentTime, departureTimeStr, liveDepTime]);

  return minutesUntil;
}
