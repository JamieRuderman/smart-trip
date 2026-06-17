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
  // Largest lead whose fire time (departure − lead) still lands a full
  // REMINDER_FIRE_BUFFER_MS ahead of "now". This raw value can drop below
  // MIN_LEAD_MINUTES (even negative) as departure nears; the slider max is
  // floored at the minimum for a usable control, but `tooLate` is judged on the
  // raw value so a single-point (MIN_LEAD) slider is still allowed.
  const maxLeadRaw = Math.floor(
    (departureAt - now - REMINDER_FIRE_BUFFER_MS) / 60_000,
  );
  const maxLeadMinutes = Math.max(
    MIN_LEAD_MINUTES,
    Math.min(MAX_LEAD_MINUTES, maxLeadRaw),
  );
  return {
    minutesUntilDeparture,
    maxLeadMinutes,
    // Too late only once even a MIN_LEAD_MINUTES reminder would fire inside the
    // near-now buffer. Clears at departure ≥ MIN_LEAD_MINUTES + the fire buffer
    // (= 2 min with a 1-min lead floor + 1-min buffer), so the soonest alarm we
    // schedule still lands ~1 min out. Callers gate the picker out and the modal
    // disables "Set" here.
    tooLate: maxLeadRaw < MIN_LEAD_MINUTES,
  };
}
