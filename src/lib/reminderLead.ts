import { REMINDER_FIRE_BUFFER_MS } from "./focusedTrip";

/** Default lead time pre-selected when the reminder picker opens. */
export const DEFAULT_LEAD_MINUTES = 15;
/** Slider floor — the soonest lead we ever offer. */
export const MIN_LEAD_MINUTES = 1;
/** Slider ceiling — a full day of lead is plenty. */
export const MAX_LEAD_MINUTES = 1440;

export interface ReminderLeadRange {
  /** Whole minutes between now and departure (negative once past). */
  minutesUntilDeparture: number;
  /** Largest lead the slider may offer without scheduling in the past. Held
   *  REMINDER_FIRE_BUFFER_MS short of "now" so the soonest reminder is still a
   *  valid future fire time. Floored at {@link MIN_LEAD_MINUTES}. */
  maxLeadMinutes: number;
  /** True when there's too little lead left to schedule a useful reminder. */
  tooLate: boolean;
}

/**
 * Compute the selectable reminder lead-time range for a departure instant.
 * Shared by the inline "Take this train" control and the reminder modal so the
 * gating math (and its off-by-one guards) stays in one place.
 */
export function reminderLeadRange(
  departureAt: number,
  now: number,
): ReminderLeadRange {
  // Strict ms delta floored to minutes — a minute-diff would overcount when the
  // current second is past :00 and let the slider schedule in the past.
  const minutesUntilDeparture = Math.floor((departureAt - now) / 60_000);
  const maxLeadMinutes = Math.max(
    MIN_LEAD_MINUTES,
    Math.min(
      MAX_LEAD_MINUTES,
      Math.floor((departureAt - now - REMINDER_FIRE_BUFFER_MS) / 60_000),
    ),
  );
  return {
    minutesUntilDeparture,
    maxLeadMinutes,
    // Degenerate when the max can't rise above the 1-min floor: the only
    // selectable "reminder" would fire ~at departure (inside the fire buffer),
    // so the slider would be a single fixed point. Needs ≥3 min of real lead to
    // clear. Callers gate the picker out and the modal disables "Set" here.
    tooLate: maxLeadMinutes <= MIN_LEAD_MINUTES,
  };
}
