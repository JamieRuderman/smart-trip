/**
 * Single source of truth for all semantic trip-state colours.
 *
 * Use these maps wherever a component needs to colour itself based on
 * trip/stop state. Adding or tweaking a colour here propagates everywhere.
 *
 * Semantic states:
 *   ontime   — next trip or en-route with no reported delay
 *   delayed  — trip is running late
 *   canceled — trip or origin stop is canceled / skipped
 *   past     — stop or trip has already passed
 *   future   — not yet active, no special status
 */
export type TripState = "ontime" | "delayed" | "canceled" | "past" | "future";

/** Primary text colour for stop labels, time text, and badge text. */
export const stateText: Record<TripState, string> = {
  ontime:   "text-smart-train-green",
  delayed:  "text-smart-gold",
  canceled: "text-destructive",
  past:     "text-muted-foreground/50",
  future:   "text-foreground",
};

/**
 * Icon and connector text — matches the primary text colour so that
 * circles, lines, and labels feel cohesive within each state.
 * Past icons are slightly dimmer than past text to preserve hierarchy.
 */
export const stateIconText: Record<TripState, string> = {
  ontime:   "text-smart-train-green",
  delayed:  "text-smart-gold",
  canceled: "text-destructive",
  past:     "text-muted-foreground/30",
  future:   "text-foreground/50",
};

/** Solid background used for the sheet header band. */
export const stateBg: Record<TripState, string> = {
  ontime:   "bg-smart-train-green",
  delayed:  "bg-smart-gold",
  canceled: "bg-destructive",
  past:     "bg-smart-neutral",
  future:   "bg-smart-neutral",
};

/**
 * Subtle tint for the current-stop row highlight in the timeline.
 * Empty string = no highlight (past / future rows are not highlighted).
 */
export const stateTint: Record<TripState, string> = {
  ontime:   "bg-smart-train-green/10",
  delayed:  "bg-smart-gold/10",
  canceled: "bg-destructive/5",
  past:     "",
  future:   "",
};

/** Vertical connector line colour between stops in the timeline. */
export const stateLineColor: Record<TripState, string> = {
  ontime:   "bg-muted-foreground/30",
  delayed:  "bg-muted-foreground/30",
  canceled: "bg-muted-foreground/30",
  past:     "bg-muted-foreground/30",
  future:   "bg-foreground/65",
};

/**
 * Full card style: background + border + hover + focus ring/shadow.
 * Applied to TripCard as a single class string.
 */
export const stateCardStyle: Record<TripState, string> = {
  ontime:   "bg-smart-train-green/5 border-smart-train-green/30 hover:bg-smart-train-green/10 focus:border-smart-train-green/80 focus:shadow-[0_0_0_1px_hsl(var(--smart-train-green)/0.8)]",
  delayed:  "bg-smart-gold/5 border-smart-gold/30 hover:bg-smart-gold/10 focus:border-smart-gold/80 focus:shadow-[0_0_0_1px_hsl(var(--smart-gold)/0.8)]",
  canceled: "bg-destructive/5 border-destructive/30 hover:bg-destructive/10 focus:border-destructive/75 focus:shadow-[0_0_0_1px_hsl(var(--destructive)/0.75)]",
  past:     "bg-gradient-card border-border hover:bg-muted/50 focus:border-foreground/45 focus:shadow-[0_0_0_1px_hsl(var(--foreground)/0.45)]",
  future:   "bg-gradient-card border-border hover:bg-muted/50 focus:border-foreground/45 focus:shadow-[0_0_0_1px_hsl(var(--foreground)/0.45)]",
};

/**
 * Derives a card's TripState from the realtime boolean flags, in priority order.
 * Used by TripCard, TrainBadge, and anywhere else that maps raw flags to a
 * single semantic state for visual styling.
 */
export function cardTripState(flags: {
  isCanceledOrSkipped: boolean;
  isDelayed: boolean;
  isNextTrip: boolean;
  isPastTrip: boolean;
}): TripState {
  if (flags.isCanceledOrSkipped) return "canceled";
  if (flags.isDelayed) return "delayed";
  if (flags.isNextTrip) return "ontime";
  if (flags.isPastTrip) return "past";
  return "future";
}
