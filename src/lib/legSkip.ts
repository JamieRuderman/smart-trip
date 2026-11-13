import type { TripRealtimeStatus } from "@/types/gtfsRt";

/** Whether the run passes the leg's boarding or destination station without
 *  stopping, judged for whichever leg the caller shows. */
export function isLegSkipped(
  status: Pick<TripRealtimeStatus, "skippedStations"> | null | undefined,
  fromStation: string,
  toStation: string,
): boolean {
  const skipped = status?.skippedStations;
  return skipped != null && (skipped.includes(fromStation) || skipped.includes(toStation));
}
