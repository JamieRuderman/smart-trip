/**
 * Stable notification id from trip number + service date. There is only ever
 * one focused reminder at a time, so this just needs to be deterministic for a
 * given (trip, day) and fit in a 32-bit int. It is stored on the reminder and
 * reused for schedule/cancel/reschedule — fully decoupled from the (drifting)
 * departure/arrival times.
 */
export function reminderIdFor(tripNumber: number, serviceDate: string): number {
  const [y, m, d] = serviceDate.split("-").map(Number);
  const dayNum = ((y || 2020) - 2020) * 372 + ((m || 1) - 1) * 31 + (d || 1);
  return (dayNum * 100000 + (tripNumber % 100000)) % 2147483647;
}
