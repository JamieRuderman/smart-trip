import {
  isFocusedTripToday,
  loadFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";

/** Route of the full-page My Trip view. */
export const TRIP_VIEW_PATH = "/trip";

/**
 * Whether a launch should open straight into the trip view instead of the
 * schedule: a link to one train (`?trip=`), or a focused trip running today
 * when the launch isn't a dev fixture. A focus on a later day (e.g. Saturday's
 * train picked on Thursday) stays on the schedule, where the in-progress bar
 * still links to it.
 */
export function shouldOpenTripViewOnLaunch(
  focused: FocusedTrip | null,
  search: string,
  now: Date,
): boolean {
  const params = new URLSearchParams(search);
  if (params.has("devTrip")) return false;
  if (params.has("trip")) return true;
  return focused != null && isFocusedTripToday(focused, now);
}

let launchedIntoTripView = false;

/**
 * Call once, before the router mounts: when the app launches at the home route
 * and {@link shouldOpenTripViewOnLaunch} agrees, push the My Trip view over the
 * home entry. The router then starts on the trip view — nothing renders (or
 * syncs its URL against) the schedule first — and "back" lands on the
 * schedule. Later visits to the schedule in the same session stay on it.
 */
export function openTripViewOnLaunch(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (pathname !== "/") return;
  if (!shouldOpenTripViewOnLaunch(loadFocusedTrip(), search, new Date())) {
    return;
  }
  window.history.pushState(null, "", `${TRIP_VIEW_PATH}${search}${hash}`);
  launchedIntoTripView = true;
}

/**
 * Whether going back from the current entry stays inside the app. React Router
 * numbers its entries in `history.state.idx` from 0, and unlike the location
 * key that index survives a `replace` of the first entry. The launch-time trip
 * view above is entry 0 to the router but sits on top of the app's own home
 * entry.
 */
export function hasInAppHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  return idx > 0 || launchedIntoTripView;
}
