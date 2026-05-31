/**
 * Stable 32-bit notification id from trip number + minute-of-day of departure.
 * Minute-of-day (not full date) keeps the id stable when a late train's
 * departure drifts across midnight, so drift reschedules reuse the same id.
 */
export function reminderIdFor(tripNumber: number, departureAtMs: number): number {
  const d = new Date(departureAtMs);
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  return minuteOfDay * 100_000 + (tripNumber % 100_000);
}
